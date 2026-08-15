import type {
  McpServer,
  StandardSchemaWithJSON,
  ToolAnnotations,
} from "@modelcontextprotocol/server";
import type { z } from "zod/v4";
import type { publicMcpToolResult } from "./mcp-public-policy.js";

export type PublicToolCallResult = Awaited<
  ReturnType<typeof publicMcpToolResult>
>;

export class PublicToolInputError extends Error {
  constructor() {
    super("Invalid public tool arguments");
    this.name = "PublicToolInputError";
  }
}

export class PublicToolOutputError extends Error {
  constructor() {
    super("Invalid public tool output");
    this.name = "PublicToolOutputError";
  }
}

interface PublicToolEntry {
  title?: string;
  description?: string;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  invoke: (input: unknown) => Promise<PublicToolCallResult>;
}

export interface PublicToolDescription {
  name: string;
  title?: string;
  description?: string;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
}

export class PublicToolRegistry {
  private readonly entries = new Map<string, PublicToolEntry>();

  add(entry: {
    name: string;
    title?: string;
    description?: string;
    inputSchema: z.ZodType;
    outputSchema: z.ZodType;
    invoke: (input: unknown) => Promise<PublicToolCallResult>;
  }): void {
    if (this.entries.has(entry.name)) {
      throw new Error(`Duplicate public tool registration: ${entry.name}`);
    }
    this.entries.set(entry.name, entry);
  }

  names(): string[] {
    return [...this.entries.keys()].sort((left, right) =>
      left.localeCompare(right),
    );
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  descriptions(): PublicToolDescription[] {
    return this.names().map((name) => {
      const entry = this.entries.get(name);
      if (!entry) throw new Error("Public tool registry changed unexpectedly");
      return {
        name,
        title: entry.title,
        description: entry.description,
        inputSchema: entry.inputSchema,
        outputSchema: entry.outputSchema,
      };
    });
  }

  async invoke(name: string, input: unknown): Promise<PublicToolCallResult> {
    const entry = this.entries.get(name);
    if (!entry) throw new Error("Unknown public tool");
    const parsed = entry.inputSchema.safeParse(input);
    if (!parsed.success) throw new PublicToolInputError();
    const result = await entry.invoke(parsed.data);
    if (result.isError) return result;
    if (
      result.structuredContent === undefined ||
      !entry.outputSchema.safeParse(result.structuredContent).success
    ) {
      throw new PublicToolOutputError();
    }
    return result;
  }
}

interface PublicToolConfig<
  InputSchema extends z.ZodType & StandardSchemaWithJSON,
  OutputSchema extends z.ZodType & StandardSchemaWithJSON,
> {
  title?: string;
  description?: string;
  inputSchema: InputSchema;
  outputSchema: OutputSchema;
  annotations?: ToolAnnotations;
}

export function registerPublicTool<
  InputSchema extends z.ZodType & StandardSchemaWithJSON,
  OutputSchema extends z.ZodType & StandardSchemaWithJSON,
>(
  server: McpServer,
  registry: PublicToolRegistry | undefined,
  name: string,
  config: PublicToolConfig<InputSchema, OutputSchema>,
  handler: (input: z.output<InputSchema>) => Promise<PublicToolCallResult>,
): void {
  const register = server.registerTool.bind(server) as unknown as (
    toolName: string,
    toolConfig: {
      title?: string;
      description?: string;
      inputSchema: StandardSchemaWithJSON;
      outputSchema: StandardSchemaWithJSON;
      annotations?: ToolAnnotations;
    },
    callback: (input: unknown) => Promise<PublicToolCallResult>,
  ) => unknown;
  register(name, config, (input) => handler(input as z.output<InputSchema>));
  registry?.add({
    name,
    title: config.title,
    description: config.description,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    invoke: (input) => handler(input as z.output<InputSchema>),
  });
}
