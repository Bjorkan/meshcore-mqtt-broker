import { Logger, type ILogObj } from "tslog";

const baseLogger = new Logger<ILogObj>({
  type: "pretty",
  name: "mc-mqtt",
  minLevel: 3,
  pretty: {
    style: Boolean(process.stdout.isTTY),
    timeZone: "local",
  },
  stack: { capture: "off" },
});

export const logger = baseLogger;

function sanitizeLogString(value: string): string {
  return value.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
    (ch) => {
      if (ch === "\n") return "\\n";
      if (ch === "\r") return "\\r";
      if (ch === "\t") return "\\t";
      return `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
    },
  );
}

function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return sanitizeLogString(value);
  if (value instanceof Error) {
    const clone = new Error(sanitizeLogString(value.message));
    clone.name = value.name;
    clone.stack = value.stack ? sanitizeLogString(value.stack) : undefined;
    return clone;
  }
  if (
    depth >= 6 ||
    value === null ||
    typeof value !== "object" ||
    value instanceof Date ||
    value instanceof Buffer
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = sanitizeLogValue(item, depth + 1);
  }
  return out;
}

export function setBrokerLogContext(
  context: { instanceId?: string } = {},
): void {
  const parts = [
    context.instanceId ? `instance=${context.instanceId}` : undefined,
  ].filter(Boolean);

  logger.settings.name =
    parts.length > 0 ? `meshcore:${parts.join(" ")}` : "meshcore";
}

export function getModuleLogger(name: string): Logger<ILogObj> {
  const sub = logger.getSubLogger({ name });

  function delegate(
    method: "warn" | "info" | "error" | "debug",
  ): (...args: unknown[]) => unknown {
    return (...args: unknown[]) => {
      const origName = logger.settings.name;
      logger.settings.name = sub.settings.name;
      try {
        const logMethod = logger[method].bind(logger) as (
          ...values: unknown[]
        ) => unknown;
        logMethod(...args.map((arg) => sanitizeLogValue(arg)));
      } finally {
        logger.settings.name = origName;
      }
    };
  }

  sub.warn = delegate("warn") as typeof sub.warn;
  sub.info = delegate("info") as typeof sub.info;
  sub.error = delegate("error") as typeof sub.error;
  sub.debug = delegate("debug") as typeof sub.debug;

  return sub;
}
