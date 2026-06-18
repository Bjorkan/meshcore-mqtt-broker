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

export function formatBrokerLog(level: string, args: unknown[], date = new Date()): string {
  const message = format(...args);
  const time = stockholmLogTime(date);
  const prefixMatch = message.match(/^\[([^\]]+)\]\s*(.*)$/s);
  const severity = level === 'INFO' ? '' : `${level} `;

  if (prefixMatch) {
    const [, label, rest] = prefixMatch;
    return `[${formatLogLabel(label)} ${time}] ${severity}${rest}`;
  }

  return `[Broker ${time}] ${severity}${message}`;
}

export function installBrokerConsoleLogger(): void {
  if (installed) {
    return;
  }

  installed = true;

  // Central svensk tidsstämpel för alla brokerloggar, även äldre kod som använder console direkt.
  console.log = (...args: unknown[]) => originalConsole.log(formatBrokerLog('INFO', args));
  console.info = (...args: unknown[]) => originalConsole.info(formatBrokerLog('INFO', args));
  console.warn = (...args: unknown[]) => originalConsole.warn(formatBrokerLog('WARN', args));
  console.error = (...args: unknown[]) => originalConsole.error(formatBrokerLog('ERROR', args));
  console.debug = (...args: unknown[]) => originalConsole.debug(formatBrokerLog('DEBUG', args));
}
