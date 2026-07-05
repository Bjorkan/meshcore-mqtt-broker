import { createRequire } from 'module';
import { randomUUID } from 'crypto';
import { Redis, type RedisOptions } from 'ioredis';
import type { AedesOptions } from 'aedes';

const require = createRequire(import.meta.url);
const aedesPersistenceRedis = require('aedes-persistence-redis') as (options: Record<string, unknown>) => unknown;
const mqemitterRedis = require('mqemitter-redis') as {
  MQEmitterRedisPrefix: new (prefix: string, options: Record<string, unknown>) => unknown;
};

export interface OrchestrationConfig {
  kvUrl: string;
  namespace: string;
  instanceId: string;
}

interface RegisteredConnection {
  key: string;
  member: string;
}

const CONNECTION_TTL_MS = 90_000;
const CONNECTION_REFRESH_MS = 30_000;
const VALKEY_CONNECT_TIMEOUT_MS = 5_000;
const TRUST_STATE_LOCK_TTL_MS = 5_000;
const TRUST_STATE_LOCK_WAIT_MS = 2_000;

function valkeyRedisOptions(): RedisOptions {
  return {
    enableAutoPipelining: true,
    connectTimeout: VALKEY_CONNECT_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      return times > 3 ? null : Math.min(times * 250, 1_000);
    },
  };
}

function valkeyAdapterOptions(kvUrl: string): RedisOptions & { connectionString: string } {
  return {
    ...valkeyRedisOptions(),
    connectionString: kvUrl,
  };
}

function valkeyPersistenceConnection(kvUrl: string, namespace: string): Redis {
  return new Redis(kvUrl, {
    ...valkeyRedisOptions(),
    keyPrefix: `${namespace}:aedes:`,
  });
}

function normalizeNamespace(namespace: string): string {
  return namespace
    .trim()
    .replace(/[^A-Za-z0-9:_-]/g, '-')
    .replace(/:+$/g, '') || 'meshcore-mqtt-broker';
}

function keyPart(value: string): string {
  return encodeURIComponent(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ClusterStateStore {
  private redis: Redis;
  private namespace: string;
  private instanceId: string;
  private refreshTimer?: NodeJS.Timeout;
  private registeredConnections = new Map<string, RegisteredConnection>();

  constructor(config: OrchestrationConfig) {
    this.namespace = normalizeNamespace(config.namespace);
    this.instanceId = config.instanceId;
    this.redis = new Redis(config.kvUrl, valkeyRedisOptions());

    this.redis.on('error', (error: Error) => {
      console.error('[ORKESTRERING] Valkey/Redis-fel:', error.message);
    });

    this.refreshTimer = setInterval(() => {
      this.refreshRegisteredConnections().catch((error) => {
        console.error('[ORKESTRERING] Kunde inte förnya klusteranslutningar:', error);
      });
    }, CONNECTION_REFRESH_MS);
  }

  async ready(): Promise<void> {
    await this.redis.ping();
  }

  private key(suffix: string): string {
    return `${this.namespace}:${suffix}`;
  }

  private subscriberConnectionsKey(username: string): string {
    return this.key(`subscribers:${keyPart(username)}:connections`);
  }

  private trustStateKey(publicKey: string): string {
    return this.key(`abuse:trust:${publicKey.toUpperCase()}`);
  }

  private trustStateLockKey(publicKey: string): string {
    return this.key(`locks:abuse:trust:${publicKey.toUpperCase()}`);
  }

  private connectionMember(clientId: string): string {
    return `${this.instanceId}:${clientId}`;
  }

  async tryRegisterSubscriberConnection(username: string, clientId: string, maxConnections: number): Promise<{ allowed: boolean; activeConnections: number }> {
    const key = this.subscriberConnectionsKey(username);
    const member = this.connectionMember(clientId);
    const now = Date.now();
    const staleBefore = now - CONNECTION_TTL_MS;

    const script = `
      redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
      local count = redis.call('ZCARD', KEYS[1])
      if count >= tonumber(ARGV[2]) then
        redis.call('PEXPIRE', KEYS[1], ARGV[5])
        return {0, count}
      end
      redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
      redis.call('PEXPIRE', KEYS[1], ARGV[5])
      return {1, count + 1}
    `;

    const result = await this.redis.eval(
      script,
      1,
      key,
      staleBefore,
      maxConnections,
      now,
      member,
      CONNECTION_TTL_MS
    ) as [number, number];

    const allowed = Number(result[0]) === 1;
    const activeConnections = Number(result[1]);

    if (allowed) {
      this.registeredConnections.set(`${username}:${clientId}`, { key, member });
    }

    return { allowed, activeConnections };
  }

  async releaseSubscriberConnection(username: string, clientId: string): Promise<void> {
    const registrationKey = `${username}:${clientId}`;
    const registered = this.registeredConnections.get(registrationKey);
    const key = registered?.key || this.subscriberConnectionsKey(username);
    const member = registered?.member || this.connectionMember(clientId);

    this.registeredConnections.delete(registrationKey);
    await this.redis.zrem(key, member);
  }

  async getTrustState(publicKey: string): Promise<string | null> {
    return this.redis.get(this.trustStateKey(publicKey));
  }

  async setTrustState(publicKey: string, stateJson: string): Promise<void> {
    await this.redis.set(this.trustStateKey(publicKey), stateJson);
  }

  async withTrustStateLock<T>(publicKey: string, operation: () => Promise<T>): Promise<T> {
    const key = this.trustStateLockKey(publicKey);
    const token = randomUUID();
    const deadline = Date.now() + TRUST_STATE_LOCK_WAIT_MS;

    while (true) {
      const acquired = await this.redis.set(key, token, 'PX', TRUST_STATE_LOCK_TTL_MS, 'NX');
      if (acquired === 'OK') {
        break;
      }

      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for trust-state lock for ${publicKey}`);
      }

      await sleep(25);
    }

    try {
      return await operation();
    } finally {
      const releaseScript = `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          return redis.call('DEL', KEYS[1])
        end
        return 0
      `;
      await this.redis.eval(releaseScript, 1, key, token);
    }
  }

  private async refreshRegisteredConnections(): Promise<void> {
    if (this.registeredConnections.size === 0) {
      return;
    }

    const now = Date.now();
    const pipeline = this.redis.pipeline();
    for (const { key, member } of this.registeredConnections.values()) {
      pipeline.zadd(key, now, member);
      pipeline.pexpire(key, CONNECTION_TTL_MS);
    }
    await pipeline.exec();
  }

  async close(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    const pipeline = this.redis.pipeline();
    for (const { key, member } of this.registeredConnections.values()) {
      pipeline.zrem(key, member);
    }
    this.registeredConnections.clear();
    await pipeline.exec();
    await this.redis.quit();
  }
}

export interface OrchestrationRuntime {
  aedesOptions: AedesOptions;
  clusterStateStore: ClusterStateStore;
  ready: () => Promise<void>;
  close: () => Promise<void>;
}

export function createOrchestrationRuntime(config: OrchestrationConfig): OrchestrationRuntime {
  const namespace = normalizeNamespace(config.namespace);
  const clusterStateStore = new ClusterStateStore({ ...config, namespace });
  const persistenceConnection = valkeyPersistenceConnection(config.kvUrl, namespace);

  console.log(`[ORKESTRERING] Valkey-läge aktiverat (${config.kvUrl}, namespace: ${namespace}, instance: ${config.instanceId})`);

  return {
    aedesOptions: {
      id: config.instanceId,
      mq: new mqemitterRedis.MQEmitterRedisPrefix(`${namespace}:mq:`, {
        ...valkeyAdapterOptions(config.kvUrl),
      }),
      persistence: aedesPersistenceRedis({
        conn: persistenceConnection,
      }),
    },
    clusterStateStore,
    ready: async () => {
      await clusterStateStore.ready();
    },
    close: async () => {
      await clusterStateStore.close();
      persistenceConnection.disconnect();
    },
  };
}
