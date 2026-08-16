import { z } from "zod/v4";
import { MAX_PATH_OBSERVATIONS_PAGE } from "../mcp-public-query.js";
import { timestampSchema } from "../mcp-tool-common.js";

function isNullSchema(node: unknown): boolean {
  if (typeof node !== "object" || node === null) return false;
  const record = node as Record<string, unknown>;
  return Reflect.ownKeys(record).length === 1 && record.type === "null";
}

function isGenericJsonAnyOf(members: unknown[]): boolean {
  if (members.length < 6) return false;
  const types = new Set<string>();
  for (const member of members) {
    if (typeof member !== "object" || member === null) return false;
    const type = (member as Record<string, unknown>).type;
    if (typeof type === "string") types.add(type);
  }
  return ["string", "number", "boolean", "null", "array", "object"].every(
    (type) => types.has(type),
  );
}

function isSelfReferentialJsonSchema(node: unknown): boolean {
  if (typeof node !== "object" || node === null) return false;
  const record = node as Record<string, unknown>;
  if (record.$ref === "#") return true;
  return Object.values(record).some(isSelfReferentialJsonSchema);
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
        return {
          ...(normalizeJsonSchema(nonNull[0]) as Record<string, unknown>),
          nullable: true,
        };
      }
    }
    if (
      isGenericJsonAnyOf(record.anyOf) ||
      record.anyOf.some(isSelfReferentialJsonSchema)
    ) {
      return {};
    }
    record.anyOf = record.anyOf.map((member) => normalizeJsonSchema(member));
    return record;
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

export function pageLimitSchema(maxLimit: number) {
  return z.coerce.number().int().min(1).max(maxLimit).optional();
}

export function timePageQuery(maxLimit: number) {
  return z
    .object({
      from: timestampSchema.optional(),
      to: timestampSchema.optional(),
      limit: pageLimitSchema(maxLimit),
      cursor: z.string().min(1).max(4096).optional(),
    })
    .strict();
}

export function observerListQuery(maxLimit: number) {
  return z
    .object({
      region: z
        .string()
        .regex(/^[A-Za-z]{3}$/)
        .optional(),
      active_since: timestampSchema.optional(),
      has_neighbor_data: z.coerce.boolean().optional(),
      sort: z.string().min(1).max(32).optional(),
      order: z.enum(["asc", "desc"]).optional(),
      limit: pageLimitSchema(maxLimit),
      cursor: z.string().min(1).max(4096).optional(),
    })
    .strict();
}

export function nodeListQuery(maxLimit: number) {
  return z
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
      sort: z.string().min(1).max(32).optional(),
      order: z.enum(["asc", "desc"]).optional(),
      lat: z.coerce.number().min(-90).max(90).optional(),
      lon: z.coerce.number().min(-180).max(180).optional(),
      radius_km: z.coerce.number().positive().max(500).optional(),
      min_lat: z.coerce.number().min(-90).max(90).optional(),
      max_lat: z.coerce.number().min(-90).max(90).optional(),
      min_lon: z.coerce.number().min(-180).max(180).optional(),
      max_lon: z.coerce.number().min(-180).max(180).optional(),
      limit: pageLimitSchema(maxLimit),
      cursor: z.string().min(1).max(4096).optional(),
    })
    .strict();
}

export function packetSearchQuery(maxLimit: number) {
  return z
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
      sort: z.enum(["last_observed_at", "first_observed_at"]).optional(),
      order: z.enum(["asc", "desc"]).optional(),
      from: timestampSchema.optional(),
      to: timestampSchema.optional(),
      limit: pageLimitSchema(maxLimit),
      cursor: z.string().min(1).max(4096).optional(),
    })
    .strict();
}

export function advertSearchQuery(maxLimit: number) {
  return z
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
      limit: pageLimitSchema(maxLimit),
      cursor: z.string().min(1).max(4096).optional(),
    })
    .strict();
}

export function messageSearchQuery(maxLimit: number) {
  return z
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
      limit: pageLimitSchema(maxLimit),
      cursor: z.string().min(1).max(4096).optional(),
    })
    .strict();
}

export function pathSearchQuery(maxLimit: number) {
  return z
    .object({
      region: z
        .string()
        .regex(/^[A-Za-z]{3}$/)
        .optional(),
      logical_packet_id: z
        .string()
        .regex(/^lp_[0-9A-Fa-f]{64}$/)
        .optional(),
      packet_hash: z
        .string()
        .regex(/^[0-9A-Fa-f]{64}$/)
        .optional(),
      observer_public_key: z
        .string()
        .regex(/^[0-9A-Fa-f]{64}$/)
        .optional(),
      contains_prefix_hex: z
        .string()
        .regex(/^(?:[0-9A-Fa-f]{2}){1,3}$/)
        .optional(),
      contains_node_public_key: z
        .string()
        .regex(/^[0-9A-Fa-f]{64}$/)
        .optional(),
      min_hops: z.coerce.number().int().min(0).max(64).optional(),
      max_hops: z.coerce.number().int().min(0).max(64).optional(),
      contains_resolution_status: z
        .enum(["resolved", "ambiguous", "unresolved"])
        .optional(),
      sort: z.literal("received_at").optional(),
      order: z.enum(["asc", "desc"]).optional(),
      from: timestampSchema.optional(),
      to: timestampSchema.optional(),
      limit: pageLimitSchema(Math.min(maxLimit, MAX_PATH_OBSERVATIONS_PAGE)),
      cursor: z.string().min(1).max(4096).optional(),
    })
    .strict();
}

export function pathPrefixSearchQuery(maxLimit: number) {
  return z
    .object({
      region: z
        .string()
        .regex(/^[A-Za-z]{3}$/)
        .optional(),
      prefix_hex: z
        .string()
        .regex(/^(?:[0-9A-Fa-f]{2}){1,3}$/)
        .optional(),
      resolution_status: z
        .enum(["resolved", "ambiguous", "unresolved"])
        .optional(),
      min_occurrences: z.coerce.number().int().min(1).max(1_000_000).optional(),
      sort: z
        .enum(["occurrence_count", "first_seen_at", "last_seen_at"])
        .optional(),
      order: z.enum(["asc", "desc"]).optional(),
      from: timestampSchema.optional(),
      to: timestampSchema.optional(),
      limit: pageLimitSchema(maxLimit),
      cursor: z.string().min(1).max(4096).optional(),
    })
    .strict();
}

export function eventsSearchQuery(maxLimit: number) {
  return z
    .object({
      region: z
        .string()
        .regex(/^[A-Za-z]{3}$/)
        .optional(),
      node_public_key: z
        .string()
        .regex(/^[0-9A-Fa-f]{64}$/)
        .optional(),
      observer_public_key: z
        .string()
        .regex(/^[0-9A-Fa-f]{64}$/)
        .optional(),
      event_types: z
        .string()
        .regex(/^[a-z_]+(,[a-z_]+)*$/)
        .optional(),
      sort: z.literal("received_at").optional(),
      order: z.enum(["asc", "desc"]).optional(),
      from: timestampSchema.optional(),
      to: timestampSchema.optional(),
      limit: pageLimitSchema(maxLimit),
      cursor: z.string().min(1).max(4096).optional(),
    })
    .strict();
}

export function signalQuery(maxLimit: number) {
  return z
    .object({
      node_public_key: z
        .string()
        .regex(/^[0-9A-Fa-f]{64}$/)
        .optional(),
      packet_type: z.string().min(1).max(64).optional(),
      from: timestampSchema.optional(),
      to: timestampSchema.optional(),
      bucket: z.enum(["minute", "hour", "day"]).optional(),
      limit: pageLimitSchema(maxLimit),
      cursor: z.string().min(1).max(4096).optional(),
    })
    .strict();
}

export function telemetryQuery(maxLimit: number) {
  return z
    .object({
      metric: z.string().min(1).max(200).optional(),
      from: timestampSchema.optional(),
      to: timestampSchema.optional(),
      limit: pageLimitSchema(maxLimit),
      cursor: z.string().min(1).max(4096).optional(),
    })
    .strict();
}

export function sightingsQuery(maxLimit: number) {
  return z
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
      limit: pageLimitSchema(maxLimit),
      cursor: z.string().min(1).max(4096).optional(),
    })
    .strict();
}

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
