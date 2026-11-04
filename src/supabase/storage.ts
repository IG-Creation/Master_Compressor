/**
 * losslesspack - Supabase Storage Helper
 * Uploads and downloads compressed containers to Supabase Storage with metadata.
 */

import { compress, decompress } from "../index.js";
import { CompressOptions, DecompressOptions } from "../algorithms/types.js";
import { inspectContainer } from "../index.js";

export interface StorageUploadMetadata {
  originalSize: number;
  compressedSize: number;
  algorithmId: number;
  sha256: string;
}

export interface StorageUploadResult {
  path: string;
  metadata: StorageUploadMetadata;
  error?: Error | null;
}

// Minimal duck-typed Supabase Storage client interface
export interface SupabaseStorageBucketClient {
  upload(
    path: string,
    fileBody: Buffer | Uint8Array,
    fileOptions?: { contentType?: string; upsert?: boolean }
  ): Promise<{ data: { path: string } | null; error: Error | null }>;
  download(path: string): Promise<{ data: Blob | Buffer | Uint8Array | null; error: Error | null }>;
}

export interface SupabaseClientLike {
  storage: {
    from(bucket: string): SupabaseStorageBucketClient;
  };
}

/**
 * Compresses data and uploads it to a Supabase Storage bucket.
 */
export async function uploadCompressed(
  supabase: SupabaseClientLike,
  bucket: string,
  path: string,
  data: Buffer | Uint8Array | string,
  opts?: CompressOptions
): Promise<StorageUploadResult> {
  const compressed = await compress(data, opts);
  const header = inspectContainer(compressed);

  const storageBucket = supabase.storage.from(bucket);
  const { data: resData, error } = await storageBucket.upload(path, compressed, {
    contentType: "application/octet-stream",
    upsert: true
  });

  if (error) {
    return {
      path,
      metadata: {
        originalSize: Number(header.originalLength),
        compressedSize: compressed.length,
        algorithmId: header.algorithmId,
        sha256: header.sha256.toString("hex")
      },
      error
    };
  }

  return {
    path: resData?.path ?? path,
    metadata: {
      originalSize: Number(header.originalLength),
      compressedSize: compressed.length,
      algorithmId: header.algorithmId,
      sha256: header.sha256.toString("hex")
    },
    error: null
  };
}

/**
 * Downloads a compressed container from Supabase Storage and decompresses it back to original bytes.
 */
export async function downloadDecompressed(
  supabase: SupabaseClientLike,
  bucket: string,
  path: string,
  opts?: DecompressOptions
): Promise<Buffer> {
  const storageBucket = supabase.storage.from(bucket);
  const { data, error } = await storageBucket.download(path);

  if (error || !data) {
    throw error ?? new Error(`File '${path}' not found in bucket '${bucket}'`);
  }

  let buf: Buffer;
  if (Buffer.isBuffer(data)) {
    buf = data;
  } else if (data instanceof Uint8Array) {
    buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  } else if (typeof (data as Blob).arrayBuffer === "function") {
    const arrayBuf = await (data as Blob).arrayBuffer();
    buf = Buffer.from(arrayBuf);
  } else {
    throw new TypeError("Unsupported data type received from Supabase Storage");
  }

  return decompress(buf, opts);
}
