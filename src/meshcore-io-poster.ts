import { createHash, randomBytes } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import type {
  MeshcoreIoConfig,
  MeshcoreIoPosterResult,
  MeshcoreIoUploadJob,
} from "./meshcore-io-types.js";
import {
  buildMeshcoreIoUploadParams,
  formatMeshcoreIoError,
  hasValidMeshcoreIoParams,
} from "./meshcore-io-utils.js";
import { getModuleLogger } from "./logger.js";

const log = getModuleLogger("MeshCoreIO");

interface SignedRequest {
  data: string;
  signature: string;
  publicKey: string;
}

interface MapApiResponseBody {
  code?: string;
  message?: string;
  error?: string;
}

export interface MeshcoreIoPosterDependencies {
  fetch?: typeof fetch;
  privateSeed?: Buffer;
}

function parseResponse(text: string): MapApiResponseBody | undefined {
  if (!text.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    return {
      code: typeof record.code === "string" ? record.code : undefined,
      message: typeof record.message === "string" ? record.message : undefined,
      error: typeof record.error === "string" ? record.error : undefined,
    };
  } catch {
    return undefined;
  }
}

function isTerminalResponse(response: MapApiResponseBody | undefined): boolean {
  return (
    typeof response?.code === "string" &&
    (response.code === "NODES_INSERTED" ||
      response.code.startsWith("ERR_ADVERT_") ||
      response.code.startsWith("ERR_COORDS_"))
  );
}

function successfulResponseDescription(
  job: MeshcoreIoUploadJob,
  response: MapApiResponseBody | undefined,
  rawText: string,
): string {
  const label = `${job.nodeName} (${job.nodePublicKey.slice(0, 6)})`;
  if (response?.code === "ERR_ADVERT_DUPLICATE") {
    return `Meshcore.io tog emot advert för ${label}, men ignorerade den som nyligen behandlad.`;
  }
  if (response?.code === "ERR_COORDS_MISSING") {
    return `Meshcore.io tog emot advert för ${label}, men kartkoordinater saknas.`;
  }
  if (response?.code === "NODES_INSERTED") {
    return `Meshcore.io tog emot advert för ${label}.`;
  }
  const detail = response?.message ?? response?.error ?? rawText;
  return `Meshcore.io tog emot advert för ${label}${detail ? `: ${detail}` : "."}`;
}

export class MeshcoreIoPoster {
  private readonly fetchImpl: typeof fetch;
  private readonly privateSeed: Buffer;
  private readonly publicKeyHex: string;

  constructor(
    private readonly config: MeshcoreIoConfig,
    dependencies: MeshcoreIoPosterDependencies = {},
  ) {
    this.fetchImpl = dependencies.fetch ?? fetch;
    this.privateSeed = Buffer.from(dependencies.privateSeed ?? randomBytes(32));
    this.publicKeyHex = Buffer.from(
      ed25519.getPublicKey(this.privateSeed),
    ).toString("hex");
    log.info(
      `Uppladdare: använder tillfällig signeringsnyckel ${this.publicKeyHex.slice(0, 12)}...`,
    );
  }

  async post(
    job: MeshcoreIoUploadJob,
    signal?: AbortSignal,
  ): Promise<MeshcoreIoPosterResult> {
    const params = buildMeshcoreIoUploadParams(job.radioParams);
    if (!hasValidMeshcoreIoParams(params)) {
      return {
        status: "handled",
        responseFromMeshcoreIO: "Ogiltiga radioparametrar",
      };
    }

    const request = this.sign({
      params,
      links: [`meshcore://${job.rawPacketHex}`],
    });

    if (this.config.dryRun) {
      log.info(
        `Uppladdare: dry-run, skulle publicera ${job.nodeName} (${job.nodePublicKey.slice(0, 6)}) till meshcore.io`,
      );
      return { status: "handled", responseFromMeshcoreIO: "dry-run" };
    }

    try {
      const response = await this.postWithTimeout(request, signal);
      const responseText = (await response.text().catch(() => ""))
        .replace(/[\r\n\t]+/g, " ")
        .trim()
        .slice(0, 2_000);
      const mapResponse = parseResponse(responseText);

      if (response.ok || isTerminalResponse(mapResponse)) {
        log.info(successfulResponseDescription(job, mapResponse, responseText));
        return {
          status: "handled",
          responseFromMeshcoreIO: responseText || `HTTP ${response.status}`,
        };
      }

      return {
        status: "retry",
        error: new Error(
          `meshcore.io svarade HTTP ${response.status}${responseText ? `: ${responseText}` : ""}`,
        ),
      };
    } catch (error) {
      log.warn(
        `Uppladdare: försök för ${job.nodeName} misslyckades: ${formatMeshcoreIoError(error)}`,
      );
      return { status: "retry", error };
    }
  }

  private sign(data: unknown): SignedRequest {
    const json = JSON.stringify(data);
    const digest = createHash("sha256").update(json).digest();
    return {
      data: json,
      signature: Buffer.from(ed25519.sign(digest, this.privateSeed)).toString(
        "hex",
      ),
      publicKey: this.publicKeyHex,
    };
  }

  private async postWithTimeout(
    body: SignedRequest,
    externalSignal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    const abortFromExternalSignal = () =>
      controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) {
      abortFromExternalSignal();
    } else {
      externalSignal?.addEventListener("abort", abortFromExternalSignal, {
        once: true,
      });
    }
    const timeout = setTimeout(
      () => controller.abort(new Error("Meshcore.io-anropet tog för lång tid")),
      this.config.requestTimeoutMs,
    );

    try {
      return await this.fetchImpl(this.config.apiUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternalSignal);
    }
  }
}
