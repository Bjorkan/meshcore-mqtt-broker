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
const MAX_RESPONSE_BODY_BYTES = 64 * 1024;
const MAX_RESPONSE_DIAGNOSTIC_CHARS = 2_000;

export function responseDiagnostic(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, MAX_RESPONSE_DIAGNOSTIC_CHARS);
}

async function readResponseBody(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  if (!response.body) {
    signal.throwIfAborted();
    return "";
  }

  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const cancel = (reason: unknown) => {
    void reader.cancel(reason).catch(() => undefined);
  };
  const abort = () => cancel(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    const bytes = new Uint8Array(MAX_RESPONSE_BODY_BYTES);
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      if (value.byteLength > MAX_RESPONSE_BODY_BYTES - length) {
        throw new Error("Meshcore.io response body exceeds 64 KiB");
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
    return new TextDecoder().decode(bytes.subarray(0, length));
  } catch (error) {
    cancel(error);
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

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

const ED25519_ORDER = ed25519.Point.Fn.ORDER;

function bytesToBigIntLE(bytes: Uint8Array): bigint {
  return BigInt(`0x${Buffer.from(bytes).reverse().toString("hex")}`);
}

function bigIntTo32BytesLE(value: bigint): Buffer {
  return Buffer.from(value.toString(16).padStart(64, "0"), "hex").reverse();
}

function hashToScalar(...parts: Uint8Array[]): bigint {
  const hasher = createHash("sha512");
  for (const part of parts) hasher.update(part);
  return bytesToBigIntLE(hasher.digest()) % ED25519_ORDER;
}

/**
 * MeshCore's 64-byte private keys are expanded Ed25519 keys:
 * clamped scalar (32 bytes) + SHA-512 nonce prefix (32 bytes).
 * They are NOT Ed25519 seeds and cannot be passed to ed25519.sign().
 */
function expandedPublicKey(expandedKey: Buffer): Buffer {
  const scalar = bytesToBigIntLE(expandedKey.subarray(0, 32)) % ED25519_ORDER;
  return Buffer.from(ed25519.Point.BASE.multiply(scalar).toBytes());
}

function signWithExpandedKey(
  message: Buffer,
  expandedKey: Buffer,
  publicKey: Buffer,
): Buffer {
  const scalar = bytesToBigIntLE(expandedKey.subarray(0, 32)) % ED25519_ORDER;
  const nonce = hashToScalar(expandedKey.subarray(32, 64), message);
  const R = Buffer.from(
    (nonce === 0n
      ? ed25519.Point.ZERO
      : ed25519.Point.BASE.multiply(nonce)
    ).toBytes(),
  );
  const challenge = hashToScalar(R, publicKey, message);
  const S = (nonce + challenge * scalar) % ED25519_ORDER;
  return Buffer.concat([R, bigIntTo32BytesLE(S)]);
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
  const detail = responseDiagnostic(
    response?.message ?? response?.error ?? rawText,
  );
  return `Meshcore.io tog emot advert för ${label}${detail ? `: ${detail}` : "."}`;
}

export class MeshcoreIoPoster {
  private readonly fetchImpl: typeof fetch;
  private readonly signingKey: Buffer;
  private readonly expandedKey: boolean;
  private readonly publicKeyBytes: Buffer;
  private readonly publicKeyHex: string;

  constructor(
    private readonly config: MeshcoreIoConfig,
    dependencies: MeshcoreIoPosterDependencies = {},
  ) {
    this.fetchImpl = dependencies.fetch ?? fetch;
    const configuredKey = config.privateKey?.trim();
    if (
      configuredKey &&
      !/^(?:[a-fA-F0-9]{64}|[a-fA-F0-9]{128})$/.test(configuredKey)
    ) {
      // Do not include the supplied key in errors or logs.
      throw new Error(
        "meshcore_io.private_key must be a 32-byte Ed25519 seed (64 hexadecimal characters) or a 64-byte MeshCore expanded private key (128 hexadecimal characters)",
      );
    }
    this.signingKey = Buffer.from(
      configuredKey
        ? Buffer.from(configuredKey, "hex")
        : (dependencies.privateSeed ?? randomBytes(32)),
    );
    this.expandedKey = this.signingKey.length === 64;
    if (this.expandedKey) {
      if (
        (this.signingKey[0] & 7) !== 0 ||
        (this.signingKey[31] & 0xc0) !== 0x40
      ) {
        throw new Error(
          "meshcore_io.private_key is not a valid clamped MeshCore expanded Ed25519 key",
        );
      }
      this.publicKeyBytes = expandedPublicKey(this.signingKey);
    } else {
      this.publicKeyBytes = Buffer.from(ed25519.getPublicKey(this.signingKey));
    }
    this.publicKeyHex = this.publicKeyBytes.toString("hex");
    log.info(
      `Uppladdare: använder ${configuredKey ? "konfigurerad" : "tillfällig"} signeringsnyckel (publik nyckel ${this.publicKeyHex})`,
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
      log.debug(
        `Uppladdare: dry-run, skulle publicera ${job.nodeName} (${job.nodePublicKey.slice(0, 6)}) till meshcore.io`,
      );
      return { status: "handled", responseFromMeshcoreIO: "dry-run" };
    }

    try {
      const { response, text } = await this.postWithTimeout(request, signal);
      const mapResponse = parseResponse(text);
      const responseText = responseDiagnostic(text);

      if (response.ok || isTerminalResponse(mapResponse)) {
        log.debug(
          successfulResponseDescription(job, mapResponse, responseText),
        );
        return {
          status: "handled",
          responseFromMeshcoreIO: text || `HTTP ${response.status}`,
        };
      }

      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 429
      ) {
        const terminal = new Error(
          `meshcore.io avvisade permanent HTTP ${response.status}${responseText ? `: ${responseText}` : ""}`,
        );
        log.warn(
          `Uppladdare: permanent fel för ${job.nodeName}, tappar: ${formatMeshcoreIoError(terminal)}`,
        );
        return {
          status: "handled",
          responseFromMeshcoreIO: text || `HTTP ${response.status}`,
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
      signature: Buffer.from(
        this.expandedKey
          ? signWithExpandedKey(digest, this.signingKey, this.publicKeyBytes)
          : ed25519.sign(digest, this.signingKey),
      ).toString("hex"),
      publicKey: this.publicKeyHex,
    };
  }

  private async postWithTimeout(
    body: SignedRequest,
    externalSignal?: AbortSignal,
  ): Promise<{ response: Response; text: string }> {
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
      controller.signal.throwIfAborted();
      const response = await this.fetchImpl(this.config.apiUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await readResponseBody(response, controller.signal);
      return { response, text };
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternalSignal);
    }
  }
}
