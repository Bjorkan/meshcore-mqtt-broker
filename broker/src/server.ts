import { Aedes, type PublishPacket } from 'aedes';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { Duplex } from 'stream';
import { pathToFileURL } from 'url';
import { verifyAuthToken } from '@michaelhart/meshcore-decoder';
import { RateLimiter } from './rate-limiter.js';
import { getClientIP } from './ip-utils.js';
import { AbuseDetector } from './abuse-detector.js';
import { loadMqttConfig, loadAbuseConfig, loadSubscriberConfig } from './config.js';

export interface BrokerServerRuntime {
  aedes: Aedes;
  httpServer: ReturnType<typeof createServer>;
  wsServer: WebSocketServer;
  port: number;
  stop: () => Promise<void>;
}

export async function startBrokerServer(): Promise<BrokerServerRuntime> {
// Load and validate configuration
const mqttConfig = loadMqttConfig();
const abuseConfig = loadAbuseConfig();
const subscriberConfig = loadSubscriberConfig();

const WS_PORT = mqttConfig.wsPort;
const HOST = mqttConfig.host;
const EXPECTED_AUDIENCE = mqttConfig.expectedAudience;
const ALLOWED_REGIONS = mqttConfig.allowedRegions;

// Client types
enum ClientType {
  SUBSCRIBER = 'subscriber',
  PUBLISHER = 'publisher'
}

// Subscriber roles
enum SubscriberRole {
  ADMIN = 1,           // Full access + can delete retained messages
  FULL_ACCESS = 2,     // Full access, no hidden data
  LIMITED = 3          // All access but with hidden/sensitive data filtered
}

// Load subscriber users from environment variables
// Format: SUBSCRIBER_1=username:password:role:maxConnections, SUBSCRIBER_2=username:password:role:maxConnections, etc.
// Role: 1=admin (full+delete), 2=full_access (no hidden data), 3=limited (filtered data)
// maxConnections: number for override, D or omit to use default
const subscriberUsers = new Map<string, string>();
const subscriberRoles = new Map<string, SubscriberRole>();
const subscriberMaxConnections = new Map<string, number>();

// Track active connections per subscriber username
const subscriberActiveConnections = new Map<string, Set<string>>();

let subscriberIndex = 1;
while (true) {
  const subscriberEnvVar = process.env[`SUBSCRIBER_${subscriberIndex}`];
  if (!subscriberEnvVar) {
    break;
  }
  
  const parts = subscriberEnvVar.split(':').map(s => s.trim());
  const username = parts[0];
  const password = parts[1];
  const roleStr = parts[2];
  const maxConnStr = parts[3];
  
  if (username && password) {
    subscriberUsers.set(username, password);
    
    // Parse and store role (default to LIMITED if not specified or invalid)
    let role = SubscriberRole.LIMITED;
    if (roleStr) {
      const roleNum = parseInt(roleStr);
      if (roleNum === 1 || roleNum === 2 || roleNum === 3) {
        role = roleNum as SubscriberRole;
      }
    }
    subscriberRoles.set(username, role);
    
    // Parse and store max connections (D or empty = default, number = override)
    let maxConn = subscriberConfig.defaultMaxConnections;
    if (maxConnStr && maxConnStr.toUpperCase() !== 'D') {
      const parsedMax = parseInt(maxConnStr);
      if (!isNaN(parsedMax) && parsedMax > 0) {
        maxConn = parsedMax;
      }
    }
    subscriberMaxConnections.set(username, maxConn);
    
    // Initialize active connections set for this user
    subscriberActiveConnections.set(username, new Set());
    
    const roleNames = {
      [SubscriberRole.ADMIN]: 'admin',
      [SubscriberRole.FULL_ACCESS]: 'full åtkomst',
      [SubscriberRole.LIMITED]: 'begränsad'
    };
    console.log(`[KONFIG] Prenumerant laddad: ${username} (roll: ${roleNames[role]}, maxanslutningar: ${maxConn})`);
  } else {
    console.warn(`[KONFIG] Ogiltigt format för SUBSCRIBER_${subscriberIndex}: ${subscriberEnvVar}`);
  }
  
  subscriberIndex++;
}

if (subscriberUsers.size === 0) {
  console.log('[KONFIG] Inga prenumeranter är konfigurerade');
} else {
  console.log(`[KONFIG] Standardgräns för anslutningar per prenumerant: ${subscriberConfig.defaultMaxConnections}`);
}

if (ALLOWED_REGIONS.length === 0) {
  console.warn('[KONFIG] Inga tillåtna regioner hittades i allowed_regions.yaml eller ALLOWED_REGIONS. Publicering till regioner kommer att nekas.');
} else {
  const sources = mqttConfig.allowedRegionSources.length > 0 ? mqttConfig.allowedRegionSources.join(', ') : 'okänd källa';
  console.log(`[KONFIG] Tillåtna regioner laddade (${ALLOWED_REGIONS.length}) från ${sources}: ${ALLOWED_REGIONS.join(', ')}`);
}

// Create Aedes MQTT broker
const aedes = new Aedes();

// Rate limiting for failed connections
const rateLimiter = new RateLimiter(60000, 10, 300000);

// Abuse detection
const abuseDetector = new AbuseDetector(abuseConfig);

// Helper to get client identifier for logging
function getClientLogPrefix(client: any): string {
  if (!client) return '[OKÄND]';
  
  const clientType = client.clientType;
  if (clientType === ClientType.PUBLISHER && client.publicKey) {
    return `[O:${client.publicKey.substring(0, 8)}]`;
  } else if (clientType === ClientType.SUBSCRIBER && client.username) {
    return `[S:${client.username}]`;
  }
  return `[C:${client.id}]`;
}

// Authentication handler
aedes.authenticate = async (client, username, password, callback) => {
  const logPrefix = `[C:${client.id}]`;
  console.log(`${logPrefix} [AUTENTISERING] Autentiseringsförsök - användarnamn: ${username}`);

  try {
    const usernameStr = username?.toString() || '';
    const passwordStr = password?.toString() || '';

    // Check if this is a subscriber login
    if (subscriberUsers.has(usernameStr)) {
      const expectedPassword = subscriberUsers.get(usernameStr);
      if (passwordStr === expectedPassword) {
        // Check connection limit before allowing
        const maxConn = subscriberMaxConnections.get(usernameStr) || subscriberConfig.defaultMaxConnections;
        const activeConns = subscriberActiveConnections.get(usernameStr) || new Set();
        
        if (activeConns.size >= maxConn) {
          console.log(`${logPrefix} [AUTENTISERING] ✗ Prenumerantens anslutningsgräns överskreds (${usernameStr}, ${activeConns.size}/${maxConn})`);
          callback(null, false);
          return;
        }
        
        // Track this connection
        activeConns.add(client.id);
        subscriberActiveConnections.set(usernameStr, activeConns);
        
        const role = subscriberRoles.get(usernameStr) || SubscriberRole.LIMITED;
        console.log(`${logPrefix} [AUTENTISERING] ✓ Prenumerant autentiserad (${usernameStr}, roll: ${role}, anslutningar: ${activeConns.size}/${maxConn})`);
        (client as any).clientType = ClientType.SUBSCRIBER;
        (client as any).username = usernameStr;
        (client as any).role = role;
        
        // Mark stream as authenticated
        const stream = (client as any).conn;
        if (stream && stream.clientIP) {
          stream.authenticated = true;
        }
        
        callback(null, true);
      } else {
        console.log(`${logPrefix} [AUTENTISERING] ✗ Prenumerantens autentisering misslyckades - ogiltigt lösenord`);
        callback(null, false);
      }
      return;
    }

    // Otherwise, check for JWT-based publisher authentication
    // Username format: v1_{UPPERCASE_PUBLIC_KEY}
    if (!usernameStr.startsWith('v1_')) {
      console.log(`${logPrefix} [AUTENTISERING] ✗ Ogiltigt användarnamnsformat: ${usernameStr}`);
      callback(null, false);
      return;
    }

    const publicKey = usernameStr.substring(3).toUpperCase().trim();
    
    // Validate public key format (should be 64 hex characters)
    if (!/^[0-9A-F]{64}$/i.test(publicKey)) {
      console.log(`${logPrefix} [AUTENTISERING] ✗ Ogiltigt format på publik nyckel: ${publicKey}`);
      console.log(`${logPrefix} [AUTENTISERING] Publik nyckellängd: ${publicKey.length}, hex-dump: ${Buffer.from(publicKey).toString('hex')}`);
      callback(null, false);
      return;
    }

    if (!passwordStr || passwordStr.length === 0) {
      console.log(`${logPrefix} [AUTENTISERING] ✗ Inget lösenord skickades`);
      callback(null, false);
      return;
    }

    // Verify the auth token using meshcore-decoder
    const tokenPayload = await verifyAuthToken(passwordStr, publicKey);

    if (!tokenPayload) {
      console.log(`${logPrefix} [AUTENTISERING] ✗ Ogiltig tokensignatur`);
      console.debug(`${logPrefix} [AUTENTISERING] Publik nyckel: ${publicKey}`);
      callback(null, false);
      return;
    }
    
    // Validate audience claim if configured
    if (EXPECTED_AUDIENCE && tokenPayload.aud !== EXPECTED_AUDIENCE) {
      console.log(`${logPrefix} [AUTENTISERING] ✗ Ogiltig audience: ${tokenPayload.aud} (förväntad: ${EXPECTED_AUDIENCE})`);
      callback(null, false);
      return;
    }
    
    const shortKey = publicKey.substring(0, 8);
    console.log(`[O:${shortKey}] [AUTENTISERING] ✓ Publicerare autentiserad${tokenPayload.aud ? ` [audience: ${tokenPayload.aud}]` : ''}`);
    // Store the public key and client type with the client for later use
    (client as any).publicKey = publicKey;
    (client as any).tokenPayload = tokenPayload;
    (client as any).clientType = ClientType.PUBLISHER;
    
    // Mark stream as authenticated
    const stream = (client as any).conn;
    if (stream && stream.clientIP) {
      stream.authenticated = true;
    }
    
    // Initialize abuse detection tracking
    const clientIP = stream?.clientIP;
    abuseDetector.initializeClient(publicKey, `v1_${publicKey}`, clientIP);
    
    callback(null, true);
  } catch (error) {
    console.error(`${logPrefix} [AUTENTISERING] Fel under autentisering:`, error);
    callback(null, false);
  }
};

// Authorization handler (control topic access)
aedes.authorizePublish = (client, packet, callback) => {
  if (!client) {
    callback(new Error('No client'));
    return;
  }
  
  const logPrefix = getClientLogPrefix(client);
  const clientType = (client as any).clientType;
  
  // Important: Strip retain flag from /status messages to prevent stale data on ingestor restart
  // LWT (offline) messages are also STATUS messages and should NOT be retained
  if (packet.topic.endsWith('/status') && packet.retain) {
    console.log(`${logPrefix} [BEHÖRIGHET] Tar bort retain-flagga från statusmeddelande -> ${packet.topic}`);
    packet.retain = false;
  }
  
  // Subscriber clients cannot publish (subscribe-only)
  if (clientType === ClientType.SUBSCRIBER) {
    const role = (client as any).role || SubscriberRole.LIMITED;
    
    // Admin subscribers (role 1) can publish empty retained messages to delete them
    if (role === SubscriberRole.ADMIN && packet.retain && packet.payload.length === 0) {
      console.log(`${logPrefix} [BEHÖRIGHET] ✓ Adminradering godkänd -> ${packet.topic}`);
      callback(null);
      return;
    }
    
    // Admin subscribers (role 1) can publish to serial/commands topics for remote serial access
    // Topic format: meshcore/{IATA}/{PUBLIC_KEY}/serial/commands
    if (role === SubscriberRole.ADMIN && packet.topic.endsWith('/serial/commands')) {
      const parts = packet.topic.split('/');
      // Validate: meshcore / IATA / PUBLIC_KEY / serial / commands (5 parts)
      if (parts.length === 5 && parts[0] === 'meshcore' && parts[3] === 'serial') {
        const iata = parts[1];
        const publicKey = parts[2];
        // Basic format validation (real validation happens at meshcoretomqtt via JWT)
        const isValidIata = /^[A-Z]{3}$/i.test(iata) || iata.toLowerCase() === 'test';
        const isValidPubKey = /^[0-9A-Fa-f]{64}$/.test(publicKey);
        if (isValidIata && isValidPubKey) {
          console.log(`${logPrefix} [BEHÖRIGHET] ✓ Seriellt adminkommando godkänt -> ${packet.topic}`);
          callback(null);
          return;
        }
      }
      console.log(`${logPrefix} [BEHÖRIGHET] ✗ Seriellt kommando nekat (ogiltigt ämnesformat) -> ${packet.topic}`);
      callback(new Error('Invalid serial/commands topic format'));
      return;
    }
    
    console.log(`${logPrefix} [BEHÖRIGHET] ✗ Publicering nekad (prenumerant) -> ${packet.topic}`);
    callback(new Error('Subscriber clients are subscribe-only'));
    return;
  }
  
  // Publisher clients can only publish to meshcore/* topics
  if (clientType === ClientType.PUBLISHER) {
    if (!packet.topic.startsWith('meshcore/')) {
      console.log(`${logPrefix} [BEHÖRIGHET] ✗ Publicering nekad -> ${packet.topic} (inte meshcore/*)`);
      callback(new Error('Publishers can only publish to meshcore/* topics'));
      return;
    }

    // Validate topic format
    // Required format: meshcore/{IATA}/{PUBLIC_KEY}/subtopic
    // Examples:
    //   meshcore/SEA/ABCD1234.../packets
    //   meshcore/SEA/ABCD1234.../status
    //   meshcore/SEA/ABCD1234.../internal (ADMIN only)
    const topicParts = packet.topic.split('/').map(part => part.trim());
    if (topicParts.length < 4) {
      console.log(`${logPrefix} [BEHÖRIGHET] ✗ Publicering nekad -> ${packet.topic} (måste följa formatet meshcore/IATA/PUBKEY/subtopic)`);
      callback(new Error('Topic must be meshcore/IATA/PUBKEY/subtopic format (4 parts required)'));
      return;
    }
    
    const locationCode = topicParts[1].trim();
    const iataRegex = /^[A-Z]{3}$/;
    
    // Reject XXX explicitly (default placeholder value)
    if (locationCode === 'XXX') {
      console.log(`${logPrefix} [BEHÖRIGHET] ✗ Publicering nekad -> ${packet.topic} (XXX är inte giltigt, konfigurera faktisk regionkod)`);
      console.log(`${logPrefix} [FRÅNKOPPLING] Stänger klient - ogiltig platskod: XXX`);
      console.log(`${logPrefix} [FRÅNKOPPLING] Hela ämnet: "${packet.topic}"`);
      callback(new Error('XXX is a placeholder - please configure your actual IATA location code'));
      client.close();
      return;
    }
    
    // Check if this is the special "test" region and normalize it to lowercase
    const isTestRegion = locationCode.toLowerCase() === 'test';
    
    if (isTestRegion) {
      console.log(`${logPrefix} [BEHÖRIGHET] ✓ Använder testregion -> ${packet.topic}`);
      // Continue to validation, don't return here
    } else {
      // First check format (must be 3 uppercase letters, no normalization)
      if (!iataRegex.test(locationCode)) {
        console.log(`${logPrefix} [BEHÖRIGHET] ✗ Publicering nekad -> ${packet.topic} (ogiltigt format)`);
        console.log(`${logPrefix} [FRÅNKOPPLING] Stänger klient - ogiltigt platsformat`);
        console.log(`${logPrefix} [FRÅNKOPPLING] Platskod: "${locationCode}" (längd: ${locationCode.length})`);
        console.log(`${logPrefix} [FRÅNKOPPLING] Platskod hex: ${Buffer.from(locationCode).toString('hex')}`);
        console.log(`${logPrefix} [FRÅNKOPPLING] Hela ämnet: "${packet.topic}"`);
        callback(new Error('Location must be exactly 3 uppercase letters (e.g., SEA, PDX, BOS) or "test"'));
        client.close();
        return;
      }
      
      // Then check if the location is explicitly allowed by file/env config.
      const normalizedRegion = locationCode.toUpperCase();
      if (!ALLOWED_REGIONS.includes(normalizedRegion)) {
        const allowedList = ALLOWED_REGIONS.length > 0 ? ALLOWED_REGIONS.join(', ') : 'tom lista';
        console.log(`${logPrefix} [BEHÖRIGHET] ✗ Publicering nekad -> ${packet.topic} (region ${normalizedRegion} saknas i tillåten lista: ${allowedList})`);
        callback(new Error(`Region ${normalizedRegion} is not allowed on this broker`));
        return;
      }
    }
    
    // Validate public key in topic (required - topicParts[2])
    const topicPublicKey = topicParts[2].trim().toUpperCase();
    
    // Validate it looks like a public key (64 hex chars)
    if (!/^[0-9A-F]{64}$/i.test(topicPublicKey)) {
      console.log(`${logPrefix} [BEHÖRIGHET] ✗ Publicering nekad -> ${packet.topic} (ogiltigt format på publik nyckel)`);
      console.log(`${logPrefix} [FRÅNKOPPLING] Stänger klient - ogiltigt format på publik nyckel i ämnet`);
      console.log(`${logPrefix} [FRÅNKOPPLING] Publik nyckel i ämne: "${topicPublicKey}" (längd: ${topicPublicKey.length})`);
      console.log(`${logPrefix} [FRÅNKOPPLING] Publik nyckel i ämne som hex: ${Buffer.from(topicPublicKey).toString('hex')}`);
      console.log(`${logPrefix} [FRÅNKOPPLING] Hela ämnet: "${packet.topic}"`);
      callback(new Error('Public key in topic must be 64 hex characters'));
      client.close();
      return;
    }
    
    // Validate topic public key matches authenticated client
    const clientPublicKey = (client as any).publicKey.toUpperCase();
    if (topicPublicKey !== clientPublicKey) {
      console.log(`${logPrefix} [BEHÖRIGHET] ✗ Publicering nekad -> ${packet.topic} (publik nyckel matchar inte)`);
      console.log(`${logPrefix} [FRÅNKOPPLING] Stänger klient - publik nyckel matchar inte`);
      console.log(`${logPrefix} [FRÅNKOPPLING] Publik nyckel i ämne:  "${topicPublicKey}"`);
      console.log(`${logPrefix} [FRÅNKOPPLING] Klientens publika nyckel: "${clientPublicKey}"`);
      console.log(`${logPrefix} [FRÅNKOPPLING] Hela ämnet: "${packet.topic}"`);
      callback(new Error('Public key in topic must match authenticated public key'));
      client.close();
      return;
    }

    // Normalize the topic to UPPERCASE for IATA codes and public key component
    // This prevents duplicate topics with different casing (e.g., 7553b337... vs 7553B337...)
    // For the test region, always normalize to lowercase "test"
    const normalizedLocation = isTestRegion ? 'test' : locationCode.toUpperCase();
    const normalizedTopic = `meshcore/${normalizedLocation}/${clientPublicKey}/${topicParts.slice(3).join('/')}`;
    
    // Update the packet topic to the normalized version
    if (packet.topic !== normalizedTopic) {
      console.log(`${logPrefix} [BEHÖRIGHET] Normaliserade ämnet: ${packet.topic} -> ${normalizedTopic}`);
      packet.topic = normalizedTopic;
    }

    // Special handling for serial/responses - payload is a JWT string, not JSON
    // Topic format: meshcore/{IATA}/{PUBLIC_KEY}/serial/responses
    const subtopic = topicParts.slice(3).join('/');
    if (subtopic === 'serial/responses') {
      const payload = packet.payload.toString('utf-8');
      // Validate it looks like a JWT (3 base64url parts separated by dots)
      const jwtParts = payload.split('.');
      if (jwtParts.length !== 3) {
        console.log(`${logPrefix} [BEHÖRIGHET] ✗ Publicering nekad -> ${packet.topic} (ogiltigt JWT-format)`);
        callback(new Error('serial/responses payload must be a valid JWT'));
        return;
      }
      // Basic JWT format check - each part should be base64url encoded
      const base64urlRegex = /^[A-Za-z0-9_-]+$/;
      if (!jwtParts.every(part => base64urlRegex.test(part))) {
        console.log(`${logPrefix} [BEHÖRIGHET] ✗ Publicering nekad -> ${packet.topic} (ogiltig JWT-kodning)`);
        callback(new Error('serial/responses payload must be a valid JWT'));
        return;
      }
      console.log(`${logPrefix} [BEHÖRIGHET] ✓ Publicering godkänd (seriellt svar) -> ${packet.topic}`);
      callback(null);
      return;
    }

    // Validate that the message contains origin_id matching the authenticated public key
    try {
      const payload = packet.payload.toString('utf-8');
      const message = JSON.parse(payload);
      
      if (!message.origin_id) {
        console.log(`${logPrefix} [BEHÖRIGHET] ✗ Publicering nekad -> ${packet.topic} (origin_id saknas)`);
        callback(new Error('Message must contain origin_id field'));
        return;
      }
      
      // Normalize both to uppercase for comparison
      const messageOriginId = message.origin_id.toUpperCase();
      const normalizedClientKey = clientPublicKey.toUpperCase();
      
      if (messageOriginId !== normalizedClientKey) {
        console.log(`${logPrefix} [BEHÖRIGHET] ✗ Publicering nekad -> ${packet.topic} (origin_id matchar inte)`);
        callback(new Error('origin_id must match authenticated public key'));
        return;
      }
      
      // Track with abuse detector (no enforcement, just tracking)
      // Use normalizedLocation to ensure consistent tracking regardless of case
      
      // Check IATA changes
      const publicKey = (client as any).publicKey;
      const trustState = abuseDetector.getClientStats(publicKey);
      if (trustState) {
        abuseDetector.checkIataChange(trustState, normalizedLocation);
        
        // Record packet
        abuseDetector.recordPacket(client, packet);
      }
      
      console.log(`${logPrefix} [BEHÖRIGHET] ✓ Publicering godkänd -> ${packet.topic}`);
      
      // Publish JWT payload to /internal topic (ADMIN-only, contains PII)
      const tokenPayload = (client as any).tokenPayload;
      if (tokenPayload) {
        // Use normalizedLocation to ensure consistent internal topic naming
        const internalTopic = `meshcore/${normalizedLocation}/${clientPublicKey}/internal`;
        
        // Get trust state for internal message
        const trustState = abuseDetector.getClientStats(clientPublicKey);
        let trustMetrics: any = null;
        
        if (trustState) {
          const clockQuality = trustState.clockTracking.erraticJumps.length === 0 ? 'stable' :
                             trustState.clockTracking.erraticJumps.length < 3 ? 'syncing' : 'erratic';
          
          trustMetrics = {
            status: trustState.status,
            enforcement_enabled: abuseConfig.enforcementEnabled,
            totalPacketsReceived: trustState.totalPacketsReceived,
            totalPacketsSilenced: trustState.totalPacketsSilenced,
            duplicateCount: trustState.duplicateCount,
            anomalyCount: trustState.anomalyCount,
            anomalies: trustState.anomalies.slice(0, 20).map(a => ({
              type: a.type,
              details: a.details,
              timestamp: a.timestamp,
            })),
            peakRateObserved: Math.round(trustState.peakRateObserved * 100) / 100,
            tokenBucket: {
              tokens: Math.round(trustState.tokenBucket.tokens * 10) / 10,
              capacity: trustState.tokenBucket.capacity,
            },
            iataTracking: {
              currentIata: trustState.currentIata,
              iataChangeCount24h: trustState.iataChangeCount24h,
              iataHistory: trustState.iataHistory.map(h => h.iata),
            },
            clockTracking: {
              estimatedOffset: trustState.clockTracking.estimatedOffset ? 
                Math.round(trustState.clockTracking.estimatedOffset / 1000) : undefined,
              erraticJumpCount: trustState.clockTracking.erraticJumps.length,
              lastDeviceTimestamp: trustState.clockTracking.lastDeviceTimestamp,
              clockQuality,
            },
            recentIPs: trustState.recentIPs.slice(0, 10).map(ip => ({
              ip: ip.ip,
              connectionCount: ip.connectionCount,
              lastSeen: ip.lastSeen,
            })),
          };
        }
        
        const internalMessage = {
          origin_id: clientPublicKey,
          timestamp: Date.now(),
          jwt_payload: tokenPayload,
          trust_state: trustMetrics,
        };
        
        // Publish to internal topic (retained so admins can see it later)
        aedes.publish({
          cmd: 'publish',
          topic: internalTopic,
          payload: Buffer.from(JSON.stringify(internalMessage)),
          qos: 0,
          dup: false,
          retain: true
        } as PublishPacket, (err) => {
          if (err) {
            console.error(`${logPrefix} [INTERNT] Kunde inte publicera JWT-innehåll:`, err);
          } else {
            console.log(`${logPrefix} [INTERNT] Publicerade JWT-innehåll -> ${internalTopic}`);
          }
        });
      }
      
      callback(null);
    } catch (error) {
      console.log(`${logPrefix} [BEHÖRIGHET] ✗ Publicering nekad -> ${packet.topic} (ogiltig JSON eller valideringsfel)`);
      callback(new Error('Invalid message format or origin_id validation failed'));
    }
    return;
  }
  
  // Unknown client type
  console.log(`${logPrefix} [BEHÖRIGHET] ✗ Publicering nekad -> ${packet.topic} (okänd klienttyp)`);
  callback(new Error('Unknown client type'));
};

aedes.authorizeSubscribe = (client, subscription, callback) => {
  if (!client) {
    callback(new Error('No client'));
    return;
  }
  
  const logPrefix = getClientLogPrefix(client);
  const clientType = (client as any).clientType;
  
  // Publisher clients cannot subscribe (publish-only) - EXCEPT their own serial/commands topic
  if (clientType === ClientType.PUBLISHER) {
    // Allow publishers to subscribe to their own serial/commands topic for remote serial access
    // Topic format: meshcore/{IATA}/{PUBLIC_KEY}/serial/commands
    if (subscription.topic.endsWith('/serial/commands')) {
      const parts = subscription.topic.split('/');
      if (parts.length === 5 && parts[0] === 'meshcore' && parts[3] === 'serial') {
        const topicPublicKey = parts[2].toUpperCase();
        const clientPublicKey = ((client as any).publicKey || '').toUpperCase();
        // Publisher can only subscribe to their OWN serial/commands topic
        if (topicPublicKey === clientPublicKey && clientPublicKey.length === 64) {
          console.log(`${logPrefix} [BEHÖRIGHET] ✓ Prenumeration godkänd (egna serial/commands) -> ${subscription.topic}`);
          callback(null, subscription);
          return;
        }
      }
    }
    console.log(`${logPrefix} [BEHÖRIGHET] ✗ Prenumeration nekad (publicerare) -> ${subscription.topic}`);
    console.log(`${logPrefix} [FRÅNKOPPLING] Stänger klient - publicerare får inte prenumerera`);
    callback(new Error('Publisher clients are publish-only'));
    client.close();
    return;
  }
  
  // Subscriber clients can subscribe to any topic (they're listeners)
  if (clientType === ClientType.SUBSCRIBER) {
    console.log(`${logPrefix} [BEHÖRIGHET] ✓ Prenumeration godkänd -> ${subscription.topic}`);
    callback(null, subscription);
    return;
  }
  
  // Unknown client type
  console.log(`${logPrefix} [BEHÖRIGHET] ✗ Prenumeration nekad -> ${subscription.topic} (okänd klienttyp)`);
  callback(new Error('Unknown client type'));
};

// Track last seen status timestamp per origin_id to prevent race conditions
const lastStatusTimestamps = new Map<string, number>();

// Authorization handler for forwarding messages to subscribers (filter sensitive data)
aedes.authorizeForward = (client, packet) => {
  if (!client) {
    return packet;
  }
  
  const clientType = (client as any).clientType;
  const role = (client as any).role;
  
  // Block $SYS/* messages for non-admin subscribers (only role 1 can see system topics)
  if (clientType === ClientType.SUBSCRIBER && role !== SubscriberRole.ADMIN) {
    if (packet.topic.startsWith('$SYS/')) {
      return null; // Block delivery of this message
    }
  }
  
  // Critical: Block /internal topics for non-admin subscribers (contains PII)
  if (clientType === ClientType.SUBSCRIBER && role !== SubscriberRole.ADMIN) {
    if (packet.topic.includes('/internal')) {
      return null; // Block delivery of this message
    }
  }
  
  // Block /serial/* topics for non-admin subscribers (remote serial access is admin-only)
  if (clientType === ClientType.SUBSCRIBER && role !== SubscriberRole.ADMIN) {
    if (packet.topic.includes('/serial/')) {
      return null; // Block delivery of this message
    }
  }
  
  // Prevent stale status messages from overwriting newer ones (LWT race condition)
  if (packet.topic.endsWith('/status') && packet.payload && packet.payload.length > 0) {
    try {
      const message = JSON.parse(packet.payload.toString());
      const originId = message.origin_id;
      const timestamp = message.timestamp ? new Date(message.timestamp).getTime() : 0;
      
      if (originId && timestamp) {
        const lastTimestamp = lastStatusTimestamps.get(originId) || 0;
        
        if (timestamp < lastTimestamp) {
          // This is a stale status message (probably a delayed LWT)
          console.log(`[FILTRERING] Blockerar gammalt statusmeddelande för ${originId.substring(0, 8)} (${new Date(timestamp).toISOString()} < ${new Date(lastTimestamp).toISOString()})`);
          return null; // Block this stale message
        }
        
        // Update the last seen timestamp
        lastStatusTimestamps.set(originId, timestamp);
      }
    } catch (error) {
      // If parsing fails, let it through (don't block non-JSON status messages)
      console.debug('[FILTRERING] Kunde inte tolka statusmeddelande för tidsstämpelkontroll:', error);
    }
  }
  
  // Only filter for LIMITED role subscribers (role 3)
  if (clientType === ClientType.SUBSCRIBER && role === SubscriberRole.LIMITED) {
    // Filter status messages (meshcore/*/status) to remove stats, model, and firmware_version
    if (packet.topic.endsWith('/status') && packet.payload && packet.payload.length > 0) {
      try {
        const message = JSON.parse(packet.payload.toString());
        
        // Track if we need to filter anything
        let filtered = false;
        
        // Remove the stats object if it exists
        if (message.stats) {
          delete message.stats;
          filtered = true;
        }
        
        // Remove model if it exists
        if (message.model !== undefined) {
          delete message.model;
          filtered = true;
        }
        
        // Remove firmware_version if it exists
        if (message.firmware_version !== undefined) {
          delete message.firmware_version;
          filtered = true;
        }
        
        // Only create new packet if we actually filtered something
        if (filtered) {
          return {
            ...packet,
            payload: Buffer.from(JSON.stringify(message))
          };
        }
      } catch (error) {
        // If JSON parsing fails, just return the original packet
        console.debug('[FILTRERING] Kunde inte tolka statusmeddelande för filtrering:', error);
      }
    }
    
    // Filter packet messages (meshcore/*/packets) to remove SNR, RSSI, score
    if (packet.topic.endsWith('/packets') && packet.payload && packet.payload.length > 0) {
      try {
        const message = JSON.parse(packet.payload.toString());
        
        // Remove radio metrics if they exist
        let filtered = false;
        if (message.SNR !== undefined) {
          delete message.SNR;
          filtered = true;
        }
        if (message.RSSI !== undefined) {
          delete message.RSSI;
          filtered = true;
        }
        if (message.score !== undefined) {
          delete message.score;
          filtered = true;
        }
        
        // Only create new packet if we actually filtered something
        if (filtered) {
          return {
            ...packet,
            payload: Buffer.from(JSON.stringify(message))
          };
        }
      } catch (error) {
        // If JSON parsing fails, just return the original packet
        console.debug('[FILTRERING] Kunde inte tolka paketmeddelande för filtrering:', error);
      }
    }
  }
  
  // No filtering needed - return original packet
  return packet;
};

// Event handlers
aedes.on('client', (client) => {
  // Link stream to client if available
  (client as any).stream = (client as any).conn;
  
  const logPrefix = getClientLogPrefix(client);
  console.log(`${logPrefix} [KLIENT] Ansluten`);
  console.log(`${logPrefix} [KLIENT] Anslutningsdetaljer - conn finns: ${!!(client as any).conn}, klient-IP: ${(client as any).conn?.clientIP}`);
  
  // Track when this client connected for disconnect timing
  (client as any).connectedAt = Date.now();
  
  // Hook into the client's stream close event to see WHO closed it
  const stream = (client as any).stream;
  if (stream) {
    const originalClose = stream.close?.bind(stream);
    const originalDestroy = stream.destroy?.bind(stream);
    
    (stream as any).close = function(...args: any[]) {
      console.log(`${logPrefix} [STRÖM] close() anropad (serverinitierad stängning)`);
      if (originalClose) originalClose(...args);
    };
    
    (stream as any).destroy = function(...args: any[]) {
      console.log(`${logPrefix} [STRÖM] destroy() anropad - fel: ${args[0]?.message || 'inget'}`);
      if (originalDestroy) originalDestroy(...args);
    };
  }
});

aedes.on('clientDisconnect', (client) => {
  const logPrefix = getClientLogPrefix(client);
  const connectedAt = (client as any).connectedAt;
  const duration = connectedAt ? Math.round((Date.now() - connectedAt) / 1000) : 'okänd';
  
  console.log(`${logPrefix} [KLIENT] Frånkopplad (ansluten i ${duration}s)`);
  
  // Log additional info to debug why this client disconnected
  if (client) {
    console.log(`${logPrefix} [KLIENT] Frånkopplingsdetaljer - klienttyp: ${(client as any).clientType}, publik nyckel: ${(client as any).publicKey?.substring(0, 8)}`);
    
    // Clean up subscriber connection tracking
    const clientType = (client as any).clientType;
    const username = (client as any).username;
    if (clientType === ClientType.SUBSCRIBER && username) {
      const activeConns = subscriberActiveConnections.get(username);
      if (activeConns) {
        activeConns.delete(client.id);
        const maxConn = subscriberMaxConnections.get(username) || subscriberConfig.defaultMaxConnections;
        console.log(`${logPrefix} [KLIENT] Prenumerantanslutning borttagen (${username}, anslutningar: ${activeConns.size}/${maxConn})`);
      }
    }
  }
});

aedes.on('publish', (packet, client) => {
  if (client) {
    const logPrefix = getClientLogPrefix(client);
    console.log(`${logPrefix} [PUBLICERING] ${packet.topic} (${packet.payload.length} byte)`);
  } else {
    console.log(`[PUBLICERING] Internt -> ${packet.topic} (${packet.payload.length} byte)`);
  }
});

aedes.on('subscribe', (subscriptions, client) => {
  const logPrefix = getClientLogPrefix(client);
  console.log(`${logPrefix} [PRENUMERATION] Försöker prenumerera på: ${subscriptions.map(s => s.topic).join(', ')}`);
});

// Log when client sends DISCONNECT packet (graceful disconnect)
aedes.on('clientError', (client, err) => {
  const logPrefix = getClientLogPrefix(client);
  console.log(`${logPrefix} [FEL] Klientfel: ${err.message}`);
});

// Create HTTP server for WebSocket
const httpServer = createServer((req, res) => {
  // If this is not a WebSocket upgrade request, redirect to analyzer
  if (!req.headers.upgrade || req.headers.upgrade.toLowerCase() !== 'websocket') {
    console.log(`[HTTP] Icke-WebSocket-förfrågan från ${getClientIP(req)}, omdirigerar till analysverktyget`);
    res.writeHead(301, { 'Location': 'https://analyzer.letsmesh.net/' });
    res.end();
    return;
  }
});

// Create WebSocket server
const wsServer = new WebSocketServer({ server: httpServer });

wsServer.on('connection', (ws, req) => {
  try {
    const clientIP = getClientIP(req);
    
    // Check if IP is blocked
    if (rateLimiter.isBlocked(clientIP)) {
      console.log(`[HASTIGHETSGRÄNS] Avvisar anslutning från blockerad IP: ${clientIP}`);
      // Terminate immediately without trying to send a close frame
      ws.terminate();
      return;
    }
    
    console.log(`[WEBSOCKET] Ny WebSocket-anslutning från ${clientIP}`);
  
  // Enable WebSocket ping/pong to keep connection alive
  ws.on('ping', (data) => {
    console.log(`[WEBSOCKET] Tog emot WebSocket PING från ${clientIP}, skickar PONG`);
    ws.pong(data);
  });
  
  ws.on('pong', () => {
    console.log(`[WEBSOCKET] Tog emot WebSocket PONG från ${clientIP}`);
  });
  
  // Handle WebSocket errors
  ws.on('error', (error) => {
    // Log other WebSocket errors
    console.error('[WEBSOCKET] Fel från %s: %s', clientIP, error.message);
  });
  
  // Create a duplex stream from the WebSocket
  const stream = new Duplex({
    read() {
      // No-op, data is pushed via ws.on('message')
    },
    write(chunk, encoding, callback) {
      if (ws.readyState === ws.OPEN) {
        // Log MQTT PINGRESP packets (0xD0 = PINGRESP)
        if (chunk instanceof Buffer && chunk.length >= 2 && chunk[0] === 0xD0) {
          const clientInfo = (stream as any).client;
          if (clientInfo) {
            const logPrefix = getClientLogPrefix(clientInfo);
            console.log(`${logPrefix} [MQTT] Skickar PINGRESP (PONG) till klient`);
          } else {
            console.log('[MQTT] Skickar PINGRESP (PONG) till oautentiserad klient');
          }
        }
        
        ws.send(chunk, (error) => {
          // Suppress EPIPE errors - they're expected when client disconnects
          if (error && (error as any).code !== 'EPIPE') {
            const clientInfo = (stream as any).client;
            if (clientInfo) {
              const logPrefix = getClientLogPrefix(clientInfo);
              console.error(`${logPrefix} [WEBSOCKET] Sändningsfel:`, error);
            } else {
              console.error('[WEBSOCKET] Sändningsfel:', error);
            }
          }
          callback(error);
        });
      } else {
        callback(new Error('WebSocket not open'));
      }
    }
  });

  // Forward WebSocket messages to the stream
  ws.on('message', (data) => {
    // Log MQTT PINGREQ packets (0xC0 = PINGREQ) with client identifier
    if (data instanceof Buffer && data.length >= 2 && data[0] === 0xC0) {
      const clientInfo = (stream as any).client;
      if (clientInfo) {
        const logPrefix = getClientLogPrefix(clientInfo);
        console.log(`${logPrefix} [MQTT] Tog emot PINGREQ (PING) från klient`);
      } else {
        console.log('[MQTT] Tog emot PINGREQ (PING) från oautentiserad klient');
      }
    }
    stream.push(data);
  });

  // Store client IP on stream for logging
  (stream as any).clientIP = clientIP;
  (stream as any).authenticated = false;
  
  // Handle WebSocket close
  ws.on('close', (code, reason) => {
    const clientInfo = (stream as any).client;
    const wasAuthenticated = (stream as any).authenticated;
    
    // Check if client properly authenticated (has clientType set)
    const hasValidAuth = clientInfo && (clientInfo as any).clientType;
    
    if (hasValidAuth) {
      const logPrefix = getClientLogPrefix(clientInfo);
      console.log(`${logPrefix} [WEBSOCKET] Anslutning stängd från ${clientIP} - kod: ${code}, orsak: ${reason.toString() || 'ingen'}`);
    } else {
      // Unauthenticated or invalid client - count as failed connection
      console.log(`[C:${clientInfo?.id || 'null'}] [WEBSOCKET] Anslutning stängd (oautentiserad) från ${clientIP} - kod: ${code}, orsak: ${reason.toString() || 'ingen'}`);
      
      if (!wasAuthenticated) {
        const blocked = rateLimiter.recordFailure(clientIP);
        if (blocked) {
          console.log(`[HASTIGHETSGRÄNS] IP ${clientIP} har blockerats`);
        }
      }
    }
    stream.push(null);
  });

  // Handle stream end
  stream.on('end', () => {
    const clientInfo = (stream as any).client;
    if (clientInfo) {
      const logPrefix = getClientLogPrefix(clientInfo);
      console.log(`${logPrefix} [STRÖM] Stream avslutad, stänger WebSocket`);
    } else {
      console.log('[STRÖM] Stream avslutad (oautentiserad), stänger WebSocket');
    }
    ws.close();
  });

  // Pass the stream to Aedes
  aedes.handle(stream);
  } catch (error) {
    console.error('[WEBSOCKET] Fel vid hantering av anslutning:', error);
    try {
      ws.terminate();
    } catch (e) {
      // Ignore errors when terminating
    }
  }
});

await aedes.listen();

await new Promise<void>((resolve) => {
httpServer.listen(WS_PORT, HOST, () => {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         MeshCore MQTT-broker (WebSocket)                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`WebSocket MQTT lyssnar på: ws://${HOST}:${WS_PORT}`);
  console.log('');
  console.log('Autentiseringslägen:');
  console.log(`  1. Prenumeranter (endast prenumeration): ${subscriberUsers.size} användare konfigurerade`);
  console.log('     Användarnamn:', Array.from(subscriberUsers.keys()).join(', '));
  console.log('');
  console.log('  2. Publicerare (endast publicering):');
  console.log('     Användarnamn: v1_{PUBLIC_KEY}');
  console.log('     Lösenord: JWT-token signerad med privat Ed25519-nyckel');
  console.log('     Validering:');
  console.log('       - origin_id måste matcha autentiserad publik nyckel');
  if (EXPECTED_AUDIENCE) {
    console.log(`       - Tokenens audience måste vara: ${EXPECTED_AUDIENCE}`);
  }
  console.log('');
  console.log('Redo att ta emot anslutningar...');
  resolve();
});
});

const address = httpServer.address();
const port = typeof address === 'object' && address ? address.port : WS_PORT;

async function stop(): Promise<void> {
  console.log('[NEDSTÄNGNING] Stänger MQTT-broker...');

  await new Promise<void>((resolve) => {
    wsServer.close(() => {
      httpServer.close(() => {
        aedes.close(() => {
          abuseDetector.shutdown();
          console.log('[NEDSTÄNGNING] Brokern stängd');
          resolve();
        });
      });
    });
  });
}

return {
  aedes,
  httpServer,
  wsServer,
  port,
  stop,
};
}

function isEntrypoint(): boolean {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

let runtime: BrokerServerRuntime | null = null;

async function shutdown() {
  if (!runtime) {
    process.exit(0);
  }

  await runtime.stop();
  process.exit(0);
}

if (isEntrypoint()) {
  runtime = await startBrokerServer();
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
