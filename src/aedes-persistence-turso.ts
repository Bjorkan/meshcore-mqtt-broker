import { deserialize, serialize } from "node:v8";
import { Readable } from "node:stream";
import type { Aedes, Brokers, Client, Subscription } from "aedes";
import type { AedesPacket } from "aedes-packet";
import type { ApplicationDatabase } from "./database.js";

interface PersistedSubscription {
  clientId: string;
  topic: string;
  qos: number;
  rh?: number;
  rap?: number;
  nl?: number;
}

interface OutgoingRow {
  id: number;
  packet: Uint8Array;
}

interface PacketRow {
  id: number;
  packet: Uint8Array;
}

type StoredPacket = AedesPacket & {
  topic?: string;
  payload?: Buffer;
  messageId?: number;
  brokerId?: string;
  brokerCounter?: number;
  cmd?: string;
  writeCallback?: unknown;
};

type StoredSubscription = Subscription & {
  subscriptionIdentifier?: number;
};

const PAGE_SIZE = 500;

function packetBytes(packet: unknown): Buffer {
  if (!packet || typeof packet !== "object") return serialize(packet);
  const serializable = { ...packet } as Record<string, unknown>;
  for (const [key, value] of Object.entries(serializable)) {
    if (typeof value === "function") delete serializable[key];
  }
  return serialize(serializable);
}

function readPacket(value: Uint8Array): AedesPacket {
  return deserialize(Buffer.from(value)) as AedesPacket;
}

function isNeighborTopic(topic: string): boolean {
  const parts = topic.split("/");
  return (
    parts.length === 4 &&
    parts[0] === "meshcore" &&
    parts[3].toLowerCase() === "neighbors"
  );
}

export function mqttTopicMatches(filter: string, topic: string): boolean {
  const filterLevels = filter.split("/");
  const topicLevels = topic.split("/");
  for (let index = 0; index < filterLevels.length; index += 1) {
    const filterLevel = filterLevels[index];
    if (filterLevel === "#") {
      return index === filterLevels.length - 1;
    }
    if (index >= topicLevels.length) {
      return false;
    }
    if (filterLevel !== "+" && filterLevel !== topicLevels[index]) {
      return false;
    }
  }
  return filterLevels.length === topicLevels.length;
}

export class TursoAedesPersistence {
  private broker?: Aedes;
  private destroyed = false;
  private incomingDuplicateHandler?: (
    client: Client,
    packet: AedesPacket,
  ) => void;

  constructor(private readonly database: ApplicationDatabase) {}

  async setup(broker: Aedes): Promise<void> {
    this.broker = broker;
    await Promise.resolve();
  }

  setIncomingDuplicateHandler(
    handler: (client: Client, packet: AedesPacket) => void,
  ): void {
    this.incomingDuplicateHandler = handler;
  }

  async storeRetained(packet: AedesPacket): Promise<void> {
    const retained = packet as StoredPacket;
    if (!retained.topic || !retained.payload) {
      throw new Error("retained packet must be a publish packet");
    }
    if (retained.payload.length === 0) {
      await this.database.run(
        "DELETE FROM retained_packets WHERE topic = ?",
        retained.topic,
      );
      return;
    }
    const now = Date.now();
    const expiresAt = isNeighborTopic(retained.topic)
      ? now + 48 * 60 * 60 * 1_000
      : null;
    await this.database.run(
      `INSERT INTO retained_packets(topic, packet, stored_at_ms, expires_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(topic) DO UPDATE SET
         packet = excluded.packet,
         stored_at_ms = excluded.stored_at_ms,
         expires_at_ms = excluded.expires_at_ms`,
      retained.topic,
      packetBytes(packet),
      now,
      expiresAt,
    );
  }

  createRetainedStream(pattern: string): Readable {
    return this.createRetainedStreamCombi([pattern]);
  }

  createRetainedStreamCombi(patterns: string[]): Readable {
    const database = this.database;
    return Readable.from(
      (async function* () {
        const now = Date.now();
        for (const pattern of patterns) {
          let afterTopic = "";
          for (;;) {
            const rows = await database.all<{
              topic: string;
              packet: Uint8Array;
            }>(
              `SELECT topic, packet FROM retained_packets
               WHERE (expires_at_ms IS NULL OR expires_at_ms > ?) AND topic > ?
               ORDER BY topic ASC LIMIT ?`,
              now,
              afterTopic,
              PAGE_SIZE,
            );
            for (const row of rows) {
              if (mqttTopicMatches(pattern, row.topic)) {
                yield readPacket(row.packet);
              }
            }
            if (rows.length < PAGE_SIZE) break;
            afterTopic = rows[rows.length - 1].topic;
          }
        }
      })(),
      { objectMode: true },
    );
  }

  async addSubscriptions(client: Client, subscriptions: Subscription[]) {
    const apply = this.database.transaction(
      async (transaction, clientId: string, values: Subscription[]) => {
        const statement = await transaction.prepare(
          `INSERT INTO mqtt_subscriptions(client_id, topic, qos, rh, rap, nl, subscription_identifier)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(client_id, topic) DO UPDATE SET
             qos = excluded.qos, rh = excluded.rh, rap = excluded.rap,
             nl = excluded.nl, subscription_identifier = excluded.subscription_identifier`,
        );
        for (const subscription of values) {
          await statement.run(
            clientId,
            subscription.topic,
            subscription.qos,
            subscription.rh ?? null,
            subscription.rap === undefined ? null : Number(subscription.rap),
            subscription.nl === undefined ? null : Number(subscription.nl),
            (subscription as StoredSubscription).subscriptionIdentifier ?? null,
          );
        }
      },
    );
    await apply.immediate(client.id, subscriptions);
  }

  async removeSubscriptions(client: Client, topics: string[]) {
    const remove = this.database.transaction(
      async (transaction, clientId: string, values: string[]) => {
        const statement = await transaction.prepare(
          "DELETE FROM mqtt_subscriptions WHERE client_id = ? AND topic = ?",
        );
        for (const topic of values) await statement.run(clientId, topic);
      },
    );
    await remove.immediate(client.id, topics);
  }

  async subscriptionsByClient(client: Client): Promise<Subscription[]> {
    const subscriptions: Subscription[] = [];
    let afterTopic = "";
    for (;;) {
      const rows = await this.database.all<{
        topic: string;
        qos: number;
        rh: number | null;
        rap: number | null;
        nl: number | null;
        subscription_identifier: number | null;
      }>(
        `SELECT topic, qos, rh, rap, nl, subscription_identifier
         FROM mqtt_subscriptions
         WHERE client_id = ? AND topic > ? ORDER BY topic ASC LIMIT ?`,
        client.id,
        afterTopic,
        PAGE_SIZE,
      );
      subscriptions.push(
        ...rows.map((row) => ({
          topic: row.topic,
          qos: row.qos as Subscription["qos"],
          rh: row.rh ?? undefined,
          rap: row.rap === null ? undefined : Boolean(row.rap),
          nl: row.nl === null ? undefined : Boolean(row.nl),
          subscriptionIdentifier: row.subscription_identifier ?? undefined,
        })),
      );
      if (rows.length < PAGE_SIZE) return subscriptions;
      afterTopic = rows[rows.length - 1].topic;
    }
  }

  async subscriptionsByTopic(topic: string): Promise<PersistedSubscription[]> {
    const subscriptions = new Map<string, PersistedSubscription>();
    let afterClientId = "";
    let afterTopic = "";
    for (;;) {
      const rows = await this.database.all<{
        client_id: string;
        topic: string;
        qos: number;
        rh: number | null;
        rap: number | null;
        nl: number | null;
      }>(
        `SELECT client_id, topic, qos, rh, rap, nl FROM mqtt_subscriptions
         WHERE qos > 0
           AND (client_id > ? OR (client_id = ? AND topic > ?))
         ORDER BY client_id ASC, topic ASC LIMIT ?`,
        afterClientId,
        afterClientId,
        afterTopic,
        PAGE_SIZE,
      );
      for (const row of rows) {
        if (mqttTopicMatches(row.topic, topic)) {
          const candidate = {
            clientId: row.client_id,
            topic: row.topic,
            qos: row.qos,
            rh: row.rh ?? undefined,
            rap: row.rap ?? undefined,
            nl: row.nl ?? undefined,
          };
          const existing = subscriptions.get(row.client_id);
          if (!existing || candidate.qos > existing.qos) {
            subscriptions.set(row.client_id, candidate);
          }
        }
      }
      if (rows.length < PAGE_SIZE) {
        return [...subscriptions.values()].sort((left, right) =>
          left.clientId.localeCompare(right.clientId),
        );
      }
      const last = rows[rows.length - 1];
      afterClientId = last.client_id;
      afterTopic = last.topic;
    }
  }

  async countOffline(): Promise<{ subsCount: number; clientsCount: number }> {
    const row = await this.database.get<{
      subs_count: number;
      clients_count: number;
    }>(
      `SELECT SUM(CASE WHEN qos > 0 THEN 1 ELSE 0 END) AS subs_count,
              COUNT(DISTINCT client_id) AS clients_count
       FROM mqtt_subscriptions`,
    );
    return {
      subsCount: Number(row?.subs_count ?? 0),
      clientsCount: Number(row?.clients_count ?? 0),
    };
  }

  async cleanSubscriptions(client: Client): Promise<void> {
    const clean = this.database.transaction(
      async (transaction, clientId: string) => {
        for (const table of [
          "mqtt_subscriptions",
          "mqtt_outgoing",
          "mqtt_incoming",
        ] as const) {
          await transaction.run(
            `DELETE FROM ${table} WHERE client_id = ?`,
            clientId,
          );
        }
      },
    );
    await clean.immediate(client.id);
  }

  private async enqueue(clientId: string, packet: AedesPacket): Promise<void> {
    await this.database.run(
      `INSERT INTO mqtt_outgoing(client_id, packet, broker_id, broker_counter, message_id, created_at_ms)
       VALUES (?, ?, ?, ?, NULL, ?)`,
      clientId,
      packetBytes({ ...packet, messageId: undefined }),
      packet.brokerId ?? null,
      packet.brokerCounter ?? null,
      Date.now(),
    );
  }

  outgoingEnqueue(
    subscription: { clientId: string },
    packet: AedesPacket,
  ): Promise<void> {
    return this.enqueue(subscription.clientId, packet);
  }

  async outgoingEnqueueCombi(
    subscriptions: Array<{ clientId: string }>,
    packet: AedesPacket,
  ): Promise<void> {
    const enqueue = this.database.transaction(
      async (
        transaction,
        values: Array<{ clientId: string }>,
        serialized: Buffer,
        brokerId: string | null,
        brokerCounter: number | null,
        now: number,
      ) => {
        const statement = await transaction.prepare(
          `INSERT INTO mqtt_outgoing(client_id, packet, broker_id, broker_counter, message_id, created_at_ms)
           VALUES (?, ?, ?, ?, NULL, ?)`,
        );
        for (const subscription of values) {
          await statement.run(
            subscription.clientId,
            serialized,
            brokerId,
            brokerCounter,
            now,
          );
        }
      },
    );
    await enqueue.immediate(
      subscriptions,
      packetBytes({ ...packet, messageId: undefined }),
      packet.brokerId ?? null,
      packet.brokerCounter ?? null,
      Date.now(),
    );
  }

  async outgoingUpdate(client: Client, packet: AedesPacket): Promise<void> {
    const existing =
      packet.cmd !== "pubrel" &&
      packet.brokerId !== undefined &&
      packet.brokerCounter !== undefined
        ? await this.database.get<OutgoingRow>(
            `SELECT id, packet FROM mqtt_outgoing
             WHERE client_id = ? AND broker_id = ? AND broker_counter = ?
             ORDER BY id ASC LIMIT 1`,
            client.id,
            packet.brokerId,
            packet.brokerCounter,
          )
        : await this.database.get<OutgoingRow>(
            `SELECT id, packet FROM mqtt_outgoing
             WHERE client_id = ? AND message_id = ? ORDER BY id ASC LIMIT 1`,
            client.id,
            packet.messageId,
          );
    if (!existing) throw new Error("no such packet");
    const stored = readPacket(existing.packet);
    const updated =
      packet.cmd === "pubrel"
        ? packet
        : { ...stored, messageId: packet.messageId };
    const storedUpdate = updated as StoredPacket;
    await this.database.run(
      `UPDATE mqtt_outgoing SET packet = ?, message_id = ?,
       broker_id = ?, broker_counter = ? WHERE id = ?`,
      packetBytes(updated),
      packet.messageId ?? null,
      storedUpdate.brokerId ?? null,
      storedUpdate.brokerCounter ?? null,
      existing.id,
    );
  }

  async outgoingClearMessageId(
    client: Client,
    packet: AedesPacket,
  ): Promise<AedesPacket | undefined> {
    const clear = this.database.transaction(
      async (transaction, clientId: string, messageId: number | undefined) => {
        const row = (await transaction.get(
          messageId === undefined
            ? `SELECT id, packet FROM mqtt_outgoing
               WHERE client_id = ? AND message_id IS NULL ORDER BY id ASC LIMIT 1`
            : `SELECT id, packet FROM mqtt_outgoing
               WHERE client_id = ? AND message_id = ? ORDER BY id ASC LIMIT 1`,
          ...(messageId === undefined ? [clientId] : [clientId, messageId]),
        )) as OutgoingRow | undefined;
        if (!row) return undefined;
        await transaction.run("DELETE FROM mqtt_outgoing WHERE id = ?", row.id);
        return readPacket(row.packet);
      },
    );
    return clear.immediate(client.id, packet.messageId);
  }

  outgoingStream(client: Client): Readable {
    const database = this.database;
    return Readable.from(
      (async function* () {
        let afterId = 0;
        for (;;) {
          const rows = await database.all<PacketRow>(
            `SELECT id, packet FROM mqtt_outgoing
             WHERE client_id = ? AND id > ? ORDER BY id ASC LIMIT ?`,
            client.id,
            afterId,
            PAGE_SIZE,
          );
          for (const row of rows) yield readPacket(row.packet);
          if (rows.length < PAGE_SIZE) return;
          afterId = rows[rows.length - 1].id;
        }
      })(),
      { objectMode: true },
    );
  }

  async incomingStorePacket(
    client: Client,
    packet: AedesPacket,
  ): Promise<void> {
    await this.database.run(
      `INSERT INTO mqtt_incoming(client_id, message_id, packet, created_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(client_id, message_id) DO UPDATE SET packet = excluded.packet`,
      client.id,
      packet.messageId,
      packetBytes(packet),
      Date.now(),
    );
  }

  async incomingGetPacket(
    client: Client,
    packet: AedesPacket,
  ): Promise<AedesPacket> {
    const row = await this.database.get<PacketRow>(
      "SELECT packet FROM mqtt_incoming WHERE client_id = ? AND message_id = ?",
      client.id,
      packet.messageId,
    );
    if (!row) throw new Error("no such packet");
    this.incomingDuplicateHandler?.(client, packet);
    return readPacket(row.packet);
  }

  async incomingDelPacket(client: Client, packet: AedesPacket): Promise<void> {
    const result = await this.database.run(
      "DELETE FROM mqtt_incoming WHERE client_id = ? AND message_id = ?",
      client.id,
      packet.messageId,
    );
    if (result.changes === 0) throw new Error("no such packet");
  }

  async putWill(client: Client, packet: AedesPacket): Promise<void> {
    const stored = {
      ...packet,
      clientId: client.id,
      brokerId: this.broker?.id ?? packet.brokerId,
    };
    await this.database.run(
      `INSERT INTO mqtt_wills(client_id, broker_id, packet, created_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(client_id) DO UPDATE SET
         broker_id = excluded.broker_id, packet = excluded.packet, created_at_ms = excluded.created_at_ms`,
      client.id,
      stored.brokerId,
      packetBytes(stored),
      Date.now(),
    );
  }

  async getWill(client: Client): Promise<AedesPacket | undefined> {
    const row = await this.database.get<PacketRow>(
      "SELECT packet FROM mqtt_wills WHERE client_id = ?",
      client.id,
    );
    return row ? readPacket(row.packet) : undefined;
  }

  async delWill(client: Client): Promise<AedesPacket | undefined> {
    const remove = this.database.transaction(
      async (transaction, clientId: string) => {
        const row = (await transaction.get(
          "SELECT packet FROM mqtt_wills WHERE client_id = ?",
          clientId,
        )) as PacketRow | undefined;
        if (row) {
          await transaction.run(
            "DELETE FROM mqtt_wills WHERE client_id = ?",
            clientId,
          );
        }
        return row ? readPacket(row.packet) : undefined;
      },
    );
    return remove.immediate(client.id);
  }

  streamWill(brokers: Brokers = {}): Readable {
    const database = this.database;
    return Readable.from(
      (async function* () {
        let afterCreatedAt = -1;
        let afterClientId = "";
        for (;;) {
          const rows = await database.all<{
            client_id: string;
            broker_id: string;
            packet: Uint8Array;
            created_at_ms: number;
          }>(
            `SELECT client_id, broker_id, packet, created_at_ms FROM mqtt_wills
             WHERE created_at_ms > ? OR (created_at_ms = ? AND client_id > ?)
             ORDER BY created_at_ms ASC, client_id ASC LIMIT ?`,
            afterCreatedAt,
            afterCreatedAt,
            afterClientId,
            PAGE_SIZE,
          );
          for (const row of rows) {
            if (!brokers[row.broker_id]) yield readPacket(row.packet);
          }
          if (rows.length < PAGE_SIZE) return;
          const last = rows[rows.length - 1];
          afterCreatedAt = Number(last.created_at_ms);
          afterClientId = last.client_id;
        }
      })(),
      { objectMode: true },
    );
  }

  getClientList(topic: string): Readable {
    const database = this.database;
    return Readable.from(
      (async function* () {
        let afterClientId = "";
        for (;;) {
          const rows = await database.all<{ client_id: string }>(
            `SELECT client_id FROM mqtt_subscriptions
             WHERE topic = ? AND client_id > ?
             ORDER BY client_id ASC LIMIT ?`,
            topic,
            afterClientId,
            PAGE_SIZE,
          );
          for (const row of rows) yield row.client_id;
          if (rows.length < PAGE_SIZE) return;
          afterClientId = rows[rows.length - 1].client_id;
        }
      })(),
      { objectMode: true },
    );
  }

  async cleanup(limit = 500): Promise<number> {
    const result = await this.database.run(
      `DELETE FROM retained_packets WHERE topic IN (
         SELECT topic FROM retained_packets
         WHERE expires_at_ms IS NOT NULL AND expires_at_ms <= ?
         ORDER BY expires_at_ms ASC LIMIT ?
       )`,
      Date.now(),
      limit,
    );
    return result.changes;
  }

  async destroy(): Promise<void> {
    if (this.destroyed) throw new Error("destroyed called twice!");
    this.destroyed = true;
    await Promise.resolve();
  }
}
