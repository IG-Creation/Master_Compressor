/**
 * losslesspack - Keyset Pagination Reader for Supabase
 * Streams millions of compressed records with constant memory consumption
 * and index-accelerated keyset cursors.
 */

import { decompress } from "../index.js";
import { byteaHexToBuffer } from "./bytea.js";
import { DecompressOptions } from "../algorithms/types.js";

export interface KeysetPaginationOptions {
  /**
   * Primary key column to cursor over.
   * @default "id"
   */
  idColumn?: string;

  /**
   * Number of rows to fetch per query.
   * @default 500
   */
  pageSize?: number;

  /**
   * Column containing the compressed bytea payload.
   * @default "payload"
   */
  compressColumn?: string;

  /**
   * Initial cursor value (exclusive). If omitted, starts from the beginning.
   */
  startAfterId?: string | number;

  /**
   * Decompression options.
   */
  decompressOptions?: DecompressOptions;
}

export interface GenericQueryBuilder {
  select(columns: string): GenericQueryBuilder;
  order(column: string, options?: { ascending?: boolean }): GenericQueryBuilder;
  limit(count: number): GenericQueryBuilder;
  gt(column: string, value: string | number): GenericQueryBuilder;
  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: { data: Record<string, unknown>[] | null; error: Error | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2>;
}

export interface GenericSupabaseReaderClient {
  from(table: string): {
    select(columns?: string): GenericQueryBuilder;
  };
}

/**
 * Async generator that yields decompressed rows one-by-one using keyset pagination.
 */
export async function* readKeysetPaginated<T = Record<string, unknown>>(
  supabase: GenericSupabaseReaderClient,
  tableName: string,
  opts?: KeysetPaginationOptions
): AsyncGenerator<T, void, unknown> {
  const idCol = opts?.idColumn ?? "id";
  const pageSize = opts?.pageSize ?? 500;
  const compressCol = opts?.compressColumn ?? "payload";
  let lastSeenId: string | number | undefined = opts?.startAfterId;

  while (true) {
    let query = supabase.from(tableName).select("*").order(idCol, { ascending: true }).limit(pageSize);
    if (lastSeenId !== undefined) {
      query = query.gt(idCol, lastSeenId);
    }

    const { data, error } = (await query) as {
      data: Record<string, unknown>[] | null;
      error: Error | null;
    };

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return;
    }

    for (const rawRow of data) {
      lastSeenId = rawRow[idCol] as string | number;

      const rawHex = rawRow[compressCol];
      if (typeof rawHex === "string" && (rawHex.startsWith("\\x") || rawHex.startsWith("0x"))) {
        const compressedBuf = byteaHexToBuffer(rawHex);
        const decompressed = await decompress(compressedBuf, opts?.decompressOptions);

        let parsedPayload: unknown;
        try {
          parsedPayload = JSON.parse(decompressed.toString("utf8"));
        } catch {
          parsedPayload = decompressed;
        }

        yield {
          ...rawRow,
          [compressCol]: parsedPayload
        } as T;
      } else {
        yield rawRow as T;
      }
    }

    if (data.length < pageSize) {
      return;
    }
  }
}
