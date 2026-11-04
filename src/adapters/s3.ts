/**
 * losslesspack - S3-Compatible Storage Adapter
 * Lazy loads "@aws-sdk/client-s3" or accepts an injected client.
 */

import { BaseAdapter } from "./base.js";
import { AdapterCapabilities, ListResult } from "./types.js";
import { AdapterUnavailableError, AdapterConnectionError } from "./errors.js";

export interface S3AdapterOptions {
  bucket: string;
  client?: any; // S3Client
  prefix?: string;
  maxValueSizeBytes?: number;
}

export class S3StorageAdapter extends BaseAdapter {
  readonly name = "s3";
  private client: any;
  private readonly bucket: string;
  private readonly keyPrefix: string;
  private readonly maxValSize: number;

  constructor(options: S3AdapterOptions) {
    super();
    this.bucket = options.bucket;
    this.keyPrefix = options.prefix ?? "";
    this.maxValSize = options.maxValueSizeBytes ?? 100 * 1024 * 1024;

    if (options.client) {
      this.client = options.client;
    } else {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { S3Client } = require("@aws-sdk/client-s3");
        this.client = new S3Client({});
      } catch {
        throw new AdapterUnavailableError(this.name, "Install '@aws-sdk/client-s3' to use the S3 storage adapter.");
      }
    }
  }

  capabilities(): AdapterCapabilities {
    return {
      maxValueSizeBytes: this.maxValSize,
      atomicWrites: true,
      supportsPrefixList: true,
      supportsBatchPut: false,
      supportsMetadata: true
    };
  }

  private fullKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  private createCommand(commandName: string, input: any): any {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const aws = require("@aws-sdk/client-s3");
      const CmdClass = aws[commandName];
      if (CmdClass) return new CmdClass(input);
    } catch {
      // fallback to structural command object for mocks
    }
    return { commandName, input };
  }

  protected async rawPut(key: string, bytes: Buffer, meta?: Record<string, unknown>): Promise<void> {
    try {
      const metadataStrings: Record<string, string> = {};
      if (meta) {
        for (const [k, v] of Object.entries(meta)) {
          metadataStrings[k] = String(v);
        }
      }
      const cmd = this.createCommand("PutObjectCommand", {
        Bucket: this.bucket,
        Key: this.fullKey(key),
        Body: bytes,
        ContentType: "application/octet-stream",
        Metadata: metadataStrings
      });
      await this.client.send(cmd);
    } catch (err: any) {
      throw new AdapterConnectionError(this.name, `Failed to upload S3 object '${key}': ${err.message ?? String(err)}`);
    }
  }

  protected async rawGet(key: string): Promise<Buffer | null> {
    try {
      const cmd = this.createCommand("GetObjectCommand", {
        Bucket: this.bucket,
        Key: this.fullKey(key)
      });
      const res = await this.client.send(cmd);
      if (!res.Body) return null;
      if (Buffer.isBuffer(res.Body)) return res.Body;
      if (typeof res.Body.transformToByteArray === "function") {
        const arr = await res.Body.transformToByteArray();
        return Buffer.from(arr);
      }
      const chunks: Buffer[] = [];
      for await (const chunk of res.Body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (err: any) {
      if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw new AdapterConnectionError(this.name, `Failed to get S3 object '${key}': ${err.message ?? String(err)}`);
    }
  }

  protected async rawDelete(key: string): Promise<boolean> {
    try {
      const cmd = this.createCommand("DeleteObjectCommand", {
        Bucket: this.bucket,
        Key: this.fullKey(key)
      });
      await this.client.send(cmd);
      return true;
    } catch (err: any) {
      throw new AdapterConnectionError(this.name, `Failed to delete S3 object '${key}': ${err.message ?? String(err)}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const cmd = this.createCommand("HeadObjectCommand", {
        Bucket: this.bucket,
        Key: this.fullKey(key)
      });
      await this.client.send(cmd);
      return true;
    } catch (err: any) {
      if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw new AdapterConnectionError(this.name, `Failed to check S3 object existence: ${err.message ?? String(err)}`);
    }
  }

  async list(prefix = "", cursor?: string, limit = 100): Promise<ListResult> {
    try {
      const cmd = this.createCommand("ListObjectsV2Command", {
        Bucket: this.bucket,
        Prefix: this.fullKey(prefix),
        ContinuationToken: cursor,
        MaxKeys: limit
      });
      const res = await this.client.send(cmd);

      const keys = (res.Contents || [])
        .map((o: any) => o.Key)
        .filter((k: string) => !k.includes(".__llp_part__."))
        .map((k: string) => (this.keyPrefix && k.startsWith(this.keyPrefix) ? k.slice(this.keyPrefix.length) : k));

      return {
        keys,
        nextCursor: res.NextContinuationToken
      };
    } catch (err: any) {
      throw new AdapterConnectionError(this.name, `Failed to list S3 objects: ${err.message ?? String(err)}`);
    }
  }
}