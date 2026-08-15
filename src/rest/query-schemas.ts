import { z } from "zod/v4";
import { timestampSchema } from "../mcp-tool-common.js";

function normalizeJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalizeJsonSchema);
  if (typeof node !== "object" || node === null) return node;
  const record = node as Record<string, unknown>;
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

export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema) as Record<string, unknown>;
  const { $schema: _schema, ...rest } = raw;
  return normalizeJsonSchema(rest) as Record<string, unknown>;
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
