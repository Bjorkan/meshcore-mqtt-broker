import { format } from 'util';

const stockholmFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const stockholmTimeFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

let installed = false;
let brokerLogContext = '';

const RESET = '\x1b[0m';
const COLORS = {
  muted: '\x1b[90m',
  debug: '\x1b[90m',
  bridge: '\x1b[36m',
  broker: '\x1b[36m',
  config: '\x1b[92m',
  auth: '\x1b[33m',
  mqtt: '\x1b[94m',
  client: '\x1b[36m',
  permission: '\x1b[33m',
  disconnect: '\x1b[91m',
  abuse: '\x1b[31m',
  publish: '\x1b[32m',
  subscribe: '\x1b[36m',
  heartbeat: '\x1b[90m',
  filter: '\x1b[35m',
  internal: '\x1b[95m',
  websocket: '\x1b[36m',
  http: '\x1b[94m',
  rateLimit: '\x1b[91m',
  stream: '\x1b[95m',
  valkey: '\x1b[35m',
  error: '\x1b[91m',
  shutdown: '\x1b[90m',
  ok: '\x1b[32m',
  warn: '\x1b[33m',
  deny: '\x1b[31m',
  drop: '\x1b[91m',
  topic: '\x1b[96m',
  url: '\x1b[94m',
  clientName: '\x1b[36m',
  nodeId: '\x1b[95m',
  ip: '\x1b[95m',
  number: '\x1b[37m',
};

const CATEGORY_COLORS: Record<string, string> = {
  Broker: COLORS.broker,
  KONFIG: COLORS.config,
  AUTENTISERING: COLORS.auth,
  MQTT: COLORS.mqtt,
  KLIENT: COLORS.client,
  BEHÖRIGHET: COLORS.permission,
  FRÅNKOPPLING: COLORS.disconnect,
  MISSBRUK: COLORS.abuse,
  PUBLICERING: COLORS.publish,
  PRENUMERATION: COLORS.subscribe,
  HEARTBEAT: COLORS.heartbeat,
  Heartbeat: COLORS.heartbeat,
  'TARGET-BRIDGE': COLORS.bridge,
  FILTRERING: COLORS.filter,
  INTERNT: COLORS.internal,
  WEBSOCKET: COLORS.websocket,
  HTTP: COLORS.http,
  HASTIGHETSGRÄNS: COLORS.rateLimit,
  STRÖM: COLORS.stream,
  VALKEY: COLORS.valkey,
  FEL: COLORS.error,
  NEDSTÄNGNING: COLORS.shutdown,
};

function shouldColorizeLogs(): boolean {
  return process.env.NO_COLOR === undefined && process.env.LOG_COLOR !== 'false';
}

function categoryFromLabel(label: string): string {
  const timedLabel = label.match(/^(.+?)\s+\d{2}:\d{2}(?:\s|$)/);
  if (timedLabel) {
    return timedLabel[1].trimEnd();
  }

  return label.replace(/\d{2}:\d{2}$/, '').trimEnd();
}

function colorForLabel(label: string): string {
  return CATEGORY_COLORS[categoryFromLabel(label)] ?? COLORS.broker;
}

export function colorizeLogBrackets(message: string): string {
  if (!shouldColorizeLogs()) {
    return message;
  }

  return message.replace(/\[([^\]]+)\]/g, (_match, label: string) => {
    return `[${colorForLabel(label)}${label}${RESET}]`;
  });
}

function colorizeMatches(message: string, pattern: RegExp, color: string): string {
  const ansiCodes: string[] = [];
  const protectedMessage = message.replace(/\x1b\[[0-9;]+m/g, (match) => {
    const token = `\uE000${String.fromCharCode(0xE100 + ansiCodes.length)}\uE001`;
    ansiCodes.push(match);
    return token;
  });
  const colorized = protectedMessage.replace(pattern, (match) => `${color}${match}${RESET}`);
  return colorized.replace(/\uE000(.)\uE001/g, (_match, marker: string) => ansiCodes[marker.charCodeAt(0) - 0xE100] ?? '');
}

export function colorizeLogLine(message: string): string {
  if (!shouldColorizeLogs()) {
    return message;
  }

  const prefixMatch = message.match(/^(\[([^\]]+)\]\s?)(.*)$/s);
  const prefix = prefixMatch
    ? `[${colorForLabel(prefixMatch[2])}${prefixMatch[2]}${RESET}]${prefixMatch[1].endsWith(' ') ? ' ' : ''}`
    : '';
  let body = prefixMatch ? prefixMatch[3] : message;

  body = colorizeMatches(body, /\bDEBUG\b/g, COLORS.debug);
  body = colorizeMatches(body, /<[^>\s]*(?:fel|topic|internal topic|full public key|hex|key|username|värde|aud|orsak|detaljer|typ|svar från API)[^>]*>/gi, COLORS.muted);
  body = colorizeMatches(body, /\b(?:Kunde inte|Misslyckades|Klientfel|Sändningsfel|Source broker-fel|Target broker-fel|Fel vid hantering|Fel under autentisering)\b|destroy\(\).*fel/gi, COLORS.error);
  body = colorizeMatches(body, /\b(?:Nekar|nekad|nekats|nekat|Avvisar|Ogiltig|Ogiltigt|ogiltig|ogiltigt|inte giltigt|matchar inte|admin-only|okänd klienttyp|saknar giltigt|publicerare får inte)\b/gi, COLORS.deny);
  body = colorizeMatches(body, /\b(?:Släpper|släpper|Hoppar över|Blockerar|Droppar|Bearbetas redan|uppdaterats nyligen|kartkoordinater saknas|orimligt|Avstängt|frånkopplad|offline|Stänger|stänger)\b/gi, COLORS.warn);
  body = colorizeMatches(body, /\b(?:godkänd|godkänt|autentiserad|Ansluten|Redo|Publicerade|Forwarded|Brokern stängd|tillåten igen)\b/gi, COLORS.ok);
  body = colorizeMatches(body, /\b(?:PINGREQ|PINGRESP|PING|PONG|heartbeat|Hjärtslag)\b/gi, COLORS.muted);
  body = colorizeMatches(body, /\b[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, COLORS.url);
  body = colorizeMatches(body, /\b(?:meshcore\/[^\s")]+|mshse\/[^\s")]+|heartbeat\/|<topic>|<internal topic>)\b/g, COLORS.topic);
  body = colorizeMatches(body, /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, COLORS.ip);
  body = colorizeMatches(body, /\[[A-Fa-f0-9]{6,8}\]|\([A-Fa-f0-9]{6,8}\)|\b[A-Fa-f0-9]{6,8}\b/g, COLORS.nodeId);
  body = colorizeMatches(body, /\b[A-Z]{2}-[A-Z]{2,3}-[A-Z0-9-]+\b|\b(?:uptime-kuma|meshcore-uplink-source|meshcore-uplink-target)\b/g, COLORS.clientName);
  body = colorizeMatches(body, /\(\d+\s+byte\)|\b\d+\s+byte\b|\b\d+\s*ms\b|\b\d+s\b|\b\d+m\b|\b\d+\/\d+\b|\b\d+h\b/g, COLORS.number);

  return `${prefix}${body}`;
}

function partsValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find(part => part.type === type)?.value ?? '00';
}

export function stockholmTimestamp(date = new Date()): string {
  const parts = stockholmFormatter.formatToParts(date);
  const year = partsValue(parts, 'year');
  const month = partsValue(parts, 'month');
  const day = partsValue(parts, 'day');
  const hour = partsValue(parts, 'hour');
  const minute = partsValue(parts, 'minute');
  const second = partsValue(parts, 'second');
  const millisecond = String(date.getMilliseconds()).padStart(3, '0');

  return `${year}-${month}-${day} ${hour}:${minute}:${second}.${millisecond} Europe/Stockholm`;
}

export function stockholmLogTime(date = new Date()): string {
  return stockholmTimeFormatter.format(date);
}

function formatLogLabel(label: string): string {
  return label.length > 0 ? label : 'Broker';
}

function logContextSuffix(): string {
  return brokerLogContext ? ` ${brokerLogContext}` : '';
}

export function setBrokerLogContext(context: { instanceId?: string; namespace?: string } = {}): void {
  const parts = [
    context.instanceId ? `instans=${context.instanceId}` : undefined,
    context.namespace ? `ns=${context.namespace}` : undefined,
  ].filter(Boolean);

  brokerLogContext = parts.join(' ');
}

function attachLogActor(message: string, actor: string): string {
  if (message.includes('från klient')) {
    return message.replace('från klient', `från ${actor}`);
  }

  if (message.includes('till klient')) {
    return message.replace('till klient', `till ${actor}`);
  }

  if (message.includes('Stänger klient')) {
    return message.replace('Stänger klient', `Stänger ${actor}`);
  }

  return `${message} - ${actor}`;
}

function isHexShortKey(value: string): boolean {
  return /^[0-9A-F]{6,8}$/i.test(value);
}

export function formatBrokerLog(level: string, args: unknown[], date = new Date(), color = false): string {
  const message = format(...args);
  const time = stockholmLogTime(date);
  const clientPrefixMatch = message.match(/^\[([^\]]+)\]\s+\[([^\]]+)\]\s*(.*)$/s);
  const prefixMatch = message.match(/^\[([^\]]+)\]\s*(.*)$/s);
  const severity = level === 'INFO' ? '' : `${level} `;
  let formatted: string;

  if (clientPrefixMatch && !isHexShortKey(clientPrefixMatch[2])) {
    const [, actor, label, rest] = clientPrefixMatch;
    formatted = `[${formatLogLabel(label)} ${time}${logContextSuffix()}] ${severity}${attachLogActor(rest, actor)}`;
  } else if (prefixMatch) {
    const [, label, rest] = prefixMatch;
    formatted = `[${formatLogLabel(label)} ${time}${logContextSuffix()}] ${severity}${rest}`;
  } else {
    formatted = `[Broker ${time}${logContextSuffix()}] ${severity}${message}`;
  }

  return color ? colorizeLogLine(formatted) : formatted;
}

export function installBrokerConsoleLogger(): void {
  if (installed) {
    return;
  }

  installed = true;

  // Central svensk tidsstämpel för alla brokerloggar, även äldre kod som använder console direkt.
  console.log = (...args: unknown[]) => originalConsole.log(formatBrokerLog('INFO', args, new Date(), true));
  console.info = (...args: unknown[]) => originalConsole.info(formatBrokerLog('INFO', args, new Date(), true));
  console.warn = (...args: unknown[]) => originalConsole.warn(formatBrokerLog('WARN', args, new Date(), true));
  console.error = (...args: unknown[]) => originalConsole.error(formatBrokerLog('ERROR', args, new Date(), true));
  console.debug = (...args: unknown[]) => originalConsole.debug(formatBrokerLog('DEBUG', args, new Date(), true));
}
