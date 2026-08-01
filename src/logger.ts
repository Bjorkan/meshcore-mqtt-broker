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
        const logMethod = logger[method] as (...values: unknown[]) => unknown;
        logMethod.apply(logger, args);
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
