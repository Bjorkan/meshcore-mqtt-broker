import { Logger, type ILogObj } from "tslog";

const baseLogger = new Logger<ILogObj>({
  type: "pretty",
  name: "mc-mqtt",
  minLevel: 3,
  stylePrettyLogs: Boolean(process.stdout.isTTY),
  hideLogPositionForProduction: true,
  prettyLogTimeZone: "local",
});

export const logger = baseLogger;

export function setBrokerLogContext(
  context: { instanceId?: string; namespace?: string } = {},
): void {
  const parts = [
    context.instanceId ? `instance=${context.instanceId}` : undefined,
    context.namespace ? `ns=${context.namespace}` : undefined,
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
        logger[method](...args);
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
