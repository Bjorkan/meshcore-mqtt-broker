import { z } from "zod/v4";
import { timestampSchema } from "../mcp-tool-common.js";

function isNullSchema(node: unknown): boolean {
  if (typeof node !== "object" || node === null) return false;
  const record = node as Record<string, unknown>;
  return Reflect.ownKeys(record).length === 1 && record.type === "null";
}

function normalizeJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalizeJsonSchema);
  if (typeof node !== "object" || node === null) return node;
  const record = node as Record<string, unknown>;
  if (Array.isArray(record.anyOf)) {
    const nullIndex = record.anyOf.findIndex(isNullSchema);
    if (nullIndex !== -1) {
      const nonNull = record.anyOf.filter((_, index) => index !== nullIndex);
      if (nonNull.length === 1) {
        const merged = {
          ...(normalizeJsonSchema(nonNull[0]) as Record<string, unknown>),
          nullable: true,
        };
        return merged;
      }
    }
    return {};
  }
  if (Array.isArray(record.type) && record.type.includes("null")) {
    const types = record.type.filter((item) => item !== "null");
    record.type = types.length === 1 ? types[0] : types;
    record.nullable = true;
  }
  if ("propertyNames" in record) {
    record.additionalProperties = record.propertyNames;
    delete record.propertyNames;
    record.type = "object";
  }
  for (const [key, value] of Object.entries(record)) {
    record[key] = normalizeJsonSchema(value);
  }
  return record;
}

function collectDefs(node: unknown, defs: Record<string, unknown>): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => collectDefs(item, defs));
  }
  if (typeof node !== "object" || node === null) return node;
  const record = node as Record<string, unknown>;
  if (typeof record.$defs === "object" && record.$defs !== null) {
    Object.assign(defs, record.$defs);
  }
  const output: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(record)) {
    if (key === "$defs" || (typeof key === "string" && key.startsWith("~"))) {
      continue;
    }
    if (typeof key === "string") output[key] = collectDefs(record[key], defs);
  }
  return output;
}

function resolveRefs(
  node: unknown,
  defs: Record<string, unknown>,
  seen = new Set<string>(),
): unknown {
  if (Array.isArray(node))
    return node.map((item) => resolveRefs(item, defs, seen));
  if (typeof node !== "object" || node === null) return node;
  const record = node as Record<string, unknown>;
  if (typeof record.$ref === "string" && record.$ref.startsWith("#/$defs/")) {
    const name = record.$ref.slice("#/$defs/".length);
    const definition = defs[name];
    if (definition !== undefined && !seen.has(record.$ref)) {
      seen.add(record.$ref);
      return resolveRefs(definition, defs, seen);
    }
    return {};
  }
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    output[key] = resolveRefs(value, defs, seen);
  }
  return output;
}

export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema);
  const defs: Record<string, unknown> = {};
  if (typeof raw.$defs === "object" && raw.$defs !== null) {
    Object.assign(defs, raw.$defs);
  }
  const copy: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(raw)) {
    if (
      typeof key === "string" &&
      (key === "$schema" || key === "$defs" || key.startsWith("~"))
    ) {
      continue;
    }
    if (typeof key === "string") copy[key] = raw[key];
  }
  const withoutDefs = collectDefs(copy, defs);
  return normalizeJsonSchema(resolveRefs(withoutDefs, defs)) as Record<
    string,
    unknown
  >;
}

export const timeRangeQuery = z
  .object({
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
  })
  .strict();

export const regionQuery = z
  .object({
    region: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
  })
  .strict();

export const pageQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(250).optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

export const orderQuery = z
  .object({
    order: z.enum(["asc", "desc"]).optional(),
  })
  .strict();

export const geoRadiusQuery = z
  .object({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lon: z.coerce.number().min(-180).max(180).optional(),
    radius_km: z.coerce.number().positive().max(500).optional(),
  })
  .strict();

export const boundingBoxQuery = z
  .object({
    min_lat: z.coerce.number().min(-90).max(90).optional(),
    max_lat: z.coerce.number().min(-90).max(90).optional(),
    min_lon: z.coerce.number().min(-180).max(180).optional(),
    max_lon: z.coerce.number().min(-180).max(180).optional(),
  })
  .strict();

export const fromToRange = {
  from: { type: "number" },
  to: { type: "number" },
} as const;

export const timePageQuery = z
  .object({
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
    limit: z.coerce.number().int().min(1).max(250).optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

export const observerListQuery = z
  .object({
    region: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
    active_since: timestampSchema.optional(),
    has_neighbor_data: z.coerce.boolean().optional(),
    limit: z.coerce.number().int().min(1).max(250).optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

export const nodeListQuery = z
  .object({
    role: z.string().min(1).max(32).optional(),
    name: z.string().min(1).max(120).optional(),
    public_key: z
      .string()
      .regex(/^[0-9A-Fa-f]{64}$/)
      .optional(),
    region: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
    active_since: timestampSchema.optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lon: z.coerce.number().min(-180).max(180).optional(),
    radius_km: z.coerce.number().positive().max(500).optional(),
    min_lat: z.coerce.number().min(-90).max(90).optional(),
    max_lat: z.coerce.number().min(-90).max(90).optional(),
    min_lon: z.coerce.number().min(-180).max(180).optional(),
    max_lon: z.coerce.number().min(-180).max(180).optional(),
    limit: z.coerce.number().int().min(1).max(250).optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

export const packetSearchQuery = z
  .object({
    view: z.enum(["logical", "raw"]).optional(),
    packet_hash: z
      .string()
      .regex(/^[0-9A-Fa-f]{64}$/)
      .optional(),
    logical_packet_id: z
      .string()
      .regex(/^lp_[0-9A-Fa-f]{64}$/)
      .optional(),
    observer_public_key: z
      .string()
      .regex(/^[0-9A-Fa-f]{64}$/)
      .optional(),
    node_public_key: z
      .string()
      .regex(/^[0-9A-Fa-f]{64}$/)
      .optional(),
    region: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
    packet_type: z.string().min(1).max(64).optional(),
    payload_type: z.string().min(1).max(64).optional(),
    route_type: z.string().min(1).max(64).optional(),
    min_rssi: z.coerce.number().min(-300).max(100).optional(),
    max_rssi: z.coerce.number().min(-300).max(100).optional(),
    min_snr: z.coerce.number().min(-100).max(100).optional(),
    max_snr: z.coerce.number().min(-100).max(100).optional(),
    min_score: z.coerce.number().min(-1_000_000).max(1_000_000).optional(),
    max_score: z.coerce.number().min(-1_000_000).max(1_000_000).optional(),
    min_hops: z.coerce.number().int().min(0).max(64).optional(),
    max_hops: z.coerce.number().int().min(0).max(64).optional(),
    decode_status: z
      .enum([
        "not_attempted",
        "decoded",
        "partially_decoded",
        "unknown_type",
        "invalid_packet",
        "decoder_error",
      ])
      .optional(),
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
    limit: z.coerce.number().int().min(1).max(250).optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

export const advertSearchQuery = z
  .object({
    node_public_key: z
      .string()
      .regex(/^[0-9A-Fa-f]{64}$/)
      .optional(),
    prefix_hex: z
      .string()
      .regex(/^(?:[0-9A-Fa-f]{2}){1,32}$/)
      .optional(),
    logical_packet_id: z
      .string()
      .regex(/^lp_[0-9A-Fa-f]{64}$/)
      .optional(),
    name: z.string().min(1).max(120).optional(),
    role: z.string().min(1).max(32).optional(),
    region: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
    verified: z.coerce.boolean().optional(),
    signature_valid: z.coerce.boolean().optional(),
    has_location: z.coerce.boolean().optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lon: z.coerce.number().min(-180).max(180).optional(),
    radius_km: z.coerce.number().positive().max(500).optional(),
    min_lat: z.coerce.number().min(-90).max(90).optional(),
    max_lat: z.coerce.number().min(-90).max(90).optional(),
    min_lon: z.coerce.number().min(-180).max(180).optional(),
    max_lon: z.coerce.number().min(-180).max(180).optional(),
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
    limit: z.coerce.number().int().min(1).max(250).optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

export const messageSearchQuery = z
  .object({
    view: z.enum(["logical", "raw"]).optional(),
    packet_hash: z
      .string()
      .regex(/^[0-9A-Fa-f]{64}$/)
      .optional(),
    logical_packet_id: z
      .string()
      .regex(/^lp_[0-9A-Fa-f]{64}$/)
      .optional(),
    sender_node_public_key: z
      .string()
      .regex(/^[0-9A-Fa-f]{64}$/)
      .optional(),
    destination_node_public_key: z
      .string()
      .regex(/^[0-9A-Fa-f]{64}$/)
      .optional(),
    message_type: z.string().min(1).max(64).optional(),
    channel: z.string().min(1).max(100).optional(),
    encrypted: z.coerce.boolean().optional(),
    signature_valid: z.coerce.boolean().optional(),
    region: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
    observer_public_key: z
      .string()
      .regex(/^[0-9A-Fa-f]{64}$/)
      .optional(),
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
    limit: z.coerce.number().int().min(1).max(250).optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

export const signalQuery = z
  .object({
    node_public_key: z
      .string()
      .regex(/^[0-9A-Fa-f]{64}$/)
      .optional(),
    packet_type: z.string().min(1).max(64).optional(),
    from: timestampSchema,
    to: timestampSchema,
    bucket: z.enum(["minute", "hour", "day"]).optional(),
    limit: z.coerce.number().int().min(1).max(250).optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

export const telemetryQuery = z
  .object({
    metric: z.string().min(1).max(200).optional(),
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
    limit: z.coerce.number().int().min(1).max(250).optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

export const sightingsQuery = z
  .object({
    observer_public_key: z
      .string()
      .regex(/^[0-9A-Fa-f]{64}$/)
      .optional(),
    region: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
    limit: z.coerce.number().int().min(1).max(250).optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

export const regionSummaryQuery = z
  .object({
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
  })
  .strict();

export const neighborsQuery = z
  .object({
    at: timestampSchema.optional(),
    latest: z.coerce.boolean().optional(),
  })
  .strict();

export const publicKeyParams = {
  type: "object",
  required: ["publicKey"],
  properties: {
    publicKey: { type: "string", pattern: "^[0-9A-Fa-f]{64}$" },
  },
} as const;

export const packetHashParams = {
  type: "object",
  required: ["packetHash"],
  properties: {
    packetHash: { type: "string", pattern: "^[0-9A-Fa-f]{64}$" },
  },
} as const;

export const logicalPacketIdParams = {
  type: "object",
  required: ["logicalPacketId"],
  properties: {
    logicalPacketId: { type: "string", pattern: "^lp_[0-9A-Fa-f]{64}$" },
  },
} as const;

export const logicalAdvertIdParams = {
  type: "object",
  required: ["logicalAdvertId"],
  properties: {
    logicalAdvertId: { type: "string", pattern: "^lp_[0-9A-Fa-f]{64}$" },
  },
} as const;

export const regionParams = {
  type: "object",
  required: ["region"],
  properties: { region: { type: "string", pattern: "^[A-Za-z]{3}$" } },
} as const;

export const prefixParams = {
  type: "object",
  required: ["prefix"],
  properties: {
    prefix: { type: "string", pattern: "^(?:[0-9A-Fa-f]{2}){1,32}$" },
  },
} as const;

export const messageIdParams = {
  type: "object",
  required: ["messageId"],
  properties: { messageId: { type: "integer", minimum: 1 } },
} as const;
