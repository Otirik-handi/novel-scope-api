import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export type ArtifactStoreErrorCode =
  | "ARTIFACT_NOT_FOUND"
  | "ARTIFACT_TOO_LARGE"
  | "ARTIFACT_INVALID"
  | "ARTIFACT_STORE_FAILED";

export class ArtifactStoreError extends Error {
  override readonly name = "ArtifactStoreError";

  constructor(
    readonly code: ArtifactStoreErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface ArtifactStoreOptions {
  rootDirectory: string;
  maxSizeBytes?: number;
}

export interface StoredArtifact {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}

const DEFAULT_MAX_SIZE_BYTES = 256 * 1024 * 1024;
const ARTIFACT_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.txt$/i;

export class ArtifactStore {
  private readonly rootDirectory: string;
  private readonly maxSizeBytes: number;

  constructor(options: ArtifactStoreOptions) {
    this.rootDirectory = resolve(options.rootDirectory);
    this.maxSizeBytes = options.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;
  }

  async validateRoot(): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true });
    const token = `.${process.pid}-${Date.now()}-artifact-probe`;
    const source = join(this.rootDirectory, `${token}.part`);
    const target = join(this.rootDirectory, `${token}.ready`);
    try {
      await writeFile(source, "probe", { flag: "wx" });
      await rename(source, target);
    } catch (error) {
      throw new ArtifactStoreError(
        "ARTIFACT_STORE_FAILED",
        "Artifact directory is not writable",
        { cause: error },
      );
    } finally {
      await rm(source, { force: true }).catch(() => undefined);
      await rm(target, { force: true }).catch(() => undefined);
    }
  }

  async store(
    taskId: string,
    source: Readable,
    contentType: string,
  ): Promise<StoredArtifact> {
    const relativePath = `${taskId}.txt`;
    this.assertSafeName(relativePath);
    const finalPath = this.resolvePath(relativePath);
    const partialPath = this.resolvePath(`${taskId}.part`, true);
    await mkdir(this.rootDirectory, { recursive: true });
    await rm(partialPath, { force: true });

    const hash = createHash("sha256");
    let sizeBytes = 0;
    const prefixChunks: Buffer[] = [];
    let prefixBytes = 0;
    const inspector = new Transform({
      transform: (chunk: Buffer | string, _encoding, callback) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        sizeBytes += buffer.length;
        if (sizeBytes > this.maxSizeBytes) {
          callback(
            new ArtifactStoreError(
              "ARTIFACT_TOO_LARGE",
              "Downloaded artifact exceeds the size limit",
            ),
          );
          return;
        }
        if (buffer.includes(0)) {
          callback(
            new ArtifactStoreError(
              "ARTIFACT_INVALID",
              "Downloaded artifact is not valid text",
            ),
          );
          return;
        }
        hash.update(buffer);
        if (prefixBytes < 4096) {
          const slice = buffer.subarray(0, 4096 - prefixBytes);
          prefixChunks.push(slice);
          prefixBytes += slice.length;
        }
        callback(null, buffer);
      },
      flush: (callback) => {
        const prefix = Buffer.concat(prefixChunks).toString("utf8").trimStart();
        const normalizedContentType = contentType.toLowerCase();
        const invalidType = !normalizedContentType.startsWith("text/plain");
        const invalidPrefix =
          /^<!doctype\s+html/i.test(prefix) ||
          /^<html[\s>]/i.test(prefix) ||
          (/^[\[{]/.test(prefix) &&
            /"(?:error|message|statusCode)"\s*:/.test(prefix));
        if (sizeBytes === 0 || invalidType || invalidPrefix) {
          callback(
            new ArtifactStoreError(
              "ARTIFACT_INVALID",
              "Downloader returned an invalid TXT artifact",
            ),
          );
          return;
        }
        callback();
      },
    });

    try {
      await pipeline(source, inspector, createWriteStream(partialPath, { flags: "wx" }));
      await rm(finalPath, { force: true });
      await rename(partialPath, finalPath);
      return {
        relativePath,
        sizeBytes,
        sha256: hash.digest("hex"),
      };
    } catch (error) {
      source.destroy();
      await rm(partialPath, { force: true }).catch(() => undefined);
      if (error instanceof ArtifactStoreError) throw error;
      throw new ArtifactStoreError(
        "ARTIFACT_STORE_FAILED",
        "Failed to store downloaded artifact",
        { cause: error },
      );
    }
  }

  async open(relativePath: string): Promise<Readable> {
    this.assertSafeName(relativePath);
    const path = this.resolvePath(relativePath);
    try {
      await access(path);
      return createReadStream(path);
    } catch (error) {
      throw new ArtifactStoreError(
        "ARTIFACT_NOT_FOUND",
        "Downloaded artifact was not found",
        { cause: error },
      );
    }
  }

  async delete(relativePath: string): Promise<void> {
    this.assertSafeName(relativePath);
    await rm(this.resolvePath(relativePath), { force: true });
  }

  private assertSafeName(relativePath: string): void {
    if (basename(relativePath) !== relativePath || !ARTIFACT_NAME.test(relativePath)) {
      throw new ArtifactStoreError(
        "ARTIFACT_INVALID",
        "Artifact path is invalid",
      );
    }
  }

  private resolvePath(relativePath: string, partial = false): string {
    if (partial) {
      const expected = relativePath.replace(/\.part$/, ".txt");
      this.assertSafeName(expected);
    } else {
      this.assertSafeName(relativePath);
    }
    const resolved = resolve(this.rootDirectory, relativePath);
    if (!resolved.startsWith(`${this.rootDirectory}\\`) && resolved !== this.rootDirectory) {
      throw new ArtifactStoreError(
        "ARTIFACT_INVALID",
        "Artifact path is invalid",
      );
    }
    return resolved;
  }
}
