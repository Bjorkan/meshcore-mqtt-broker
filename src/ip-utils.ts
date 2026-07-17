import type { IncomingMessage } from "http";
import { isIP } from "net";
import { configBool, configString } from "./config.js";

const LOOPBACK_PROXY_CIDRS = ["127.0.0.1/32", "::1/128"];

function getFirstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeIP(value: string | undefined): string | undefined {
  const ip = value?.trim();
  if (!ip) {
    return undefined;
  }

  if (ip.toLowerCase().startsWith("::ffff:")) {
    const ipv4 = ip.substring(7);
    return isIP(ipv4) === 4 ? ipv4 : undefined;
  }

  return isIP(ip) ? ip : undefined;
}

function ipv4ToBigInt(ip: string): bigint {
  return ip
    .split(".")
    .reduce((acc, part) => (acc << 8n) + BigInt(Number(part)), 0n);
}

function ipv6Parts(value: string): string[] {
  return value
    .split(":")
    .filter(Boolean)
    .flatMap((part) => {
      if (!part.includes(".")) {
        return [part];
      }

      const ipv4 = ipv4ToBigInt(part);
      return [
        Number((ipv4 >> 16n) & 0xffffn).toString(16),
        Number(ipv4 & 0xffffn).toString(16),
      ];
    });
}

function ipv6ToBigInt(ip: string): bigint {
  const [headRaw, tailRaw = ""] = ip.toLowerCase().split("::", 2);
  const head = ipv6Parts(headRaw);
  const tail = ipv6Parts(tailRaw);
  const missing = 8 - head.length - tail.length;
  const groups = [
    ...head,
    ...new Array<string>(Math.max(missing, 0)).fill("0"),
    ...tail,
  ];

  return groups.reduce(
    (acc, group) => (acc << 16n) + BigInt(Number.parseInt(group || "0", 16)),
    0n,
  );
}

function ipToBigInt(ip: string): bigint | undefined {
  const normalized = normalizeIP(ip);
  if (!normalized) {
    return undefined;
  }

  const version = isIP(normalized);
  return version === 4 ? ipv4ToBigInt(normalized) : ipv6ToBigInt(normalized);
}

function cidrContains(ip: string, cidr: string): boolean {
  const [rangeRaw, prefixRaw] = cidr.trim().split("/");
  const range = normalizeIP(rangeRaw);
  if (!range || !prefixRaw) {
    return false;
  }

  const ipVersion = isIP(ip);
  const rangeVersion = isIP(range);
  if (ipVersion === 0 || ipVersion !== rangeVersion) {
    return false;
  }

  const bits = ipVersion === 4 ? 32 : 128;
  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) {
    return false;
  }

  const ipNumber = ipToBigInt(ip);
  const rangeNumber = ipToBigInt(range);
  if (ipNumber === undefined || rangeNumber === undefined) {
    return false;
  }

  const hostBits = BigInt(bits - prefix);
  const mask =
    prefix === 0 ? 0n : ((1n << BigInt(bits)) - 1n) ^ ((1n << hostBits) - 1n);
  return (ipNumber & mask) === (rangeNumber & mask);
}

function configuredTrustedProxyCidrs(): string[] {
  const configured = configString(["proxy", "trusted_proxy_cidrs"])
    .split(",")
    .map((cidr) => cidr.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : LOOPBACK_PROXY_CIDRS;
}

function isTrustedProxy(remoteAddress: string | undefined): boolean {
  if (!configBool(["proxy", "trust_proxy"], false)) {
    return false;
  }

  const remoteIP = normalizeIP(remoteAddress);
  return remoteIP
    ? configuredTrustedProxyCidrs().some((cidr) => cidrContains(remoteIP, cidr))
    : false;
}

function getTrustedProxyHeaderIP(req: IncomingMessage): string | undefined {
  const cfConnectingIP = normalizeIP(
    getFirstHeaderValue(req.headers["cf-connecting-ip"]),
  );
  if (cfConnectingIP) {
    return cfConnectingIP;
  }

  const xForwardedFor = getFirstHeaderValue(req.headers["x-forwarded-for"]);
  const forwardedIP = normalizeIP(xForwardedFor?.split(",")[0]);
  if (forwardedIP) {
    return forwardedIP;
  }

  return normalizeIP(getFirstHeaderValue(req.headers["x-real-ip"]));
}

/**
 * Extract the client IP from an HTTP request.
 *
 * Proxy headers are trusted only when explicitly enabled and the socket peer is
 * a configured trusted proxy. Direct clients must not be able to spoof their IP.
 */
export function getClientIP(req: IncomingMessage): string {
  if (isTrustedProxy(req.socket.remoteAddress)) {
    const headerIP = getTrustedProxyHeaderIP(req);
    if (headerIP) {
      return headerIP;
    }
  }

  return (
    normalizeIP(req.socket.remoteAddress) ||
    req.socket.remoteAddress ||
    "unknown"
  );
}
