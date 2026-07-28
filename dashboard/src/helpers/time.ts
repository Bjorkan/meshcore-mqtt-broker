export const numberFormat = new Intl.NumberFormat("en-GB");

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Stockholm",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const headerTimeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Stockholm",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const headerDateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Stockholm",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const shortTimeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Stockholm",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function isValidTimestamp(timestamp: number): boolean {
  return (
    Number.isFinite(timestamp) && !Number.isNaN(new Date(timestamp).getTime())
  );
}

export function age(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  if (ms < 1000) return "just now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function stockholmTime(timestamp: number): string {
  if (!isValidTimestamp(timestamp)) return "-";
  return `${timeFormat.format(new Date(timestamp))} (Stockholm)`;
}

export function stockholmShortTime(timestamp: number): string {
  if (!isValidTimestamp(timestamp)) return "-";
  return shortTimeFormat.format(new Date(timestamp));
}

export function stockholmEventTime(timestamp: number): string {
  if (!isValidTimestamp(timestamp)) return "-";
  return `${headerDateFormat.format(new Date(timestamp))} · ${stockholmShortTime(timestamp)}`;
}

export function optionalStockholmShortTime(
  timestamp: number | undefined,
): string {
  if (
    timestamp === undefined ||
    timestamp === 0 ||
    !Number.isFinite(timestamp)
  ) {
    return "-";
  }
  return stockholmShortTime(timestamp);
}

export function optionalStockholmTime(timestamp: number | undefined): string {
  if (
    timestamp === undefined ||
    timestamp === 0 ||
    !Number.isFinite(timestamp)
  ) {
    return "-";
  }
  return stockholmTime(timestamp);
}

export function shortKey(publicKey: string): string {
  return publicKey.length > 18
    ? `${publicKey.slice(0, 10)}...${publicKey.slice(-6)}`
    : publicKey;
}

export function headerTime(date: Date): string {
  return headerTimeFormat.format(date);
}

export function headerDate(date: Date): string {
  return headerDateFormat.format(date);
}
