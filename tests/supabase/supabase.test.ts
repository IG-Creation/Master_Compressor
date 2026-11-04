import { describe, it, expect } from "vitest";
import {
  bufferToByteaHex,
  byteaHexToBuffer,
  uploadCompressed,
  downloadDecompressed,
  batchInsertCompressed,
  readKeysetPaginated
} from "../../src/supabase/index.js";
import { compress, decompress } from "../../src/index.js";

describe("Section F: Supabase Integration (Postgres bytea, Storage, Batch, Pagination)", () => {
  // 1. Bytea Hex encoding round-trips
  describe("PostgreSQL bytea Hex Conversion", () => {
    it("round-trips all 256 byte values", () => {
      const allBytes = Buffer.alloc(256);
      for (let i = 0; i < 256; i++) allBytes[i] = i;

      const hex = bufferToByteaHex(allBytes);
      expect(hex.startsWith("\\x")).toBe(true);

      const restored = byteaHexToBuffer(hex);
      expect(restored.equals(allBytes)).toBe(true);
    });

    it("round-trips empty payload and 0x00 / 0xFF boundary values", () => {
      const empty = Buffer.alloc(0);
      expect(bufferToByteaHex(empty)).toBe("\\x");
      expect(byteaHexToBuffer("\\x").length).toBe(0);

      const edges = Buffer.from([0x00, 0xff, 0x00, 0xff]);
      const hex = bufferToByteaHex(edges);
      expect(byteaHexToBuffer(hex).equals(edges)).toBe(true);
    });

    it("round-trips a 5 MB binary payload", () => {
      const large = Buffer.alloc(5 * 1024 * 1024, 0x41);
      const hex = bufferToByteaHex(large);
      const restored = byteaHexToBuffer(hex);
      expect(restored.equals(large)).toBe(true);
    });
  });

  // 2. Storage upload / download mock
  describe("Supabase Storage Operations", () => {
    it("uploads compressed container and downloads decompressed bytes with verified hash", async () => {
      const storageBuckets: Record<string, Record<string, Buffer>> = { "documents": {} };

      const mockSupabase = {
        storage: {
          from(bucket: string) {
            return {
              async upload(filePath: string, fileBody: Buffer) {
                storageBuckets[bucket] = storageBuckets[bucket] || {};
                storageBuckets[bucket][filePath] = Buffer.from(fileBody);
                return { data: { path: filePath }, error: null };
              },
              async download(filePath: string) {
                const data = storageBuckets[bucket]?.[filePath];
                if (!data) return { data: null, error: new Error("Not found") };
                return { data, error: null };
              }
            };
          }
        }
      };

      const originalPayload = Buffer.from("Field Visit Photo Metadata and Verification Log Payload", "utf8");
      const uploadRes = await uploadCompressed(
        mockSupabase,
        "documents",
        "visits/visit_101.llp1",
        originalPayload
      );

      expect(uploadRes.error).toBeNull();
      expect(uploadRes.metadata.originalSize).toBe(originalPayload.length);
      expect(uploadRes.metadata.compressedSize).toBeGreaterThan(0);

      const downloaded = await downloadDecompressed(
        mockSupabase,
        "documents",
        "visits/visit_101.llp1"
      );
      expect(downloaded.equals(originalPayload)).toBe(true);
    });
  });

  // 3. Batch Insert with retry, backoff, and failure isolation
  describe("Batch Insert Engine", () => {
    it("inserts rows with compression, retries on 429/500, and isolates bad rows", async () => {
      const storedDb: Record<string, unknown>[] = [];
      let simulatedAttempts = 0;

      const mockSupabase = {
        from(_tableName: string) {
          return {
            async upsert(values: Record<string, unknown>[]) {
              // Simulate transient 429 on first 2 calls
              if (simulatedAttempts < 2) {
                simulatedAttempts++;
                return { error: { message: "Too many requests", status: 429 } };
              }
              // If ANY row in the batch is bad, simulate Postgres constraint error
              const badRow = values.find((v) => (v as any).id === "bad_row_fail");
              if (badRow) {
                return { error: { message: "Unique constraint violation", status: 400 } };
              }

              storedDb.push(...values);
              return { error: null };
            }
          };
        }
      };

      const rows = [
        { id: "row_1", payload: { visit: "Branch Alpha", user: "BDO_01" } },
        { id: "row_2", payload: { visit: "Branch Beta", user: "BDM_02" } },
        { id: "bad_row_fail", payload: { visit: "Bad Data", user: "FAIL" } },
        { id: "row_3", payload: { visit: "Branch Gamma", user: "BPM_03" } }
      ];

      const report = await batchInsertCompressed(mockSupabase, "field_visits", rows, {
        batchSize: 2,
        concurrency: 2,
        maxRetries: 3
      });

      expect(report.total).toBe(4);
      expect(report.inserted).toBe(3);
      expect(report.failed.length).toBe(1);
      expect(report.failed[0].row.id).toBe("bad_row_fail");
    });
  });

  // 4. Keyset pagination
  describe("Keyset Pagination Reader", () => {
    it("reads all rows exactly once without memory exhaustion", async () => {
      // Setup mock dataset of 25 records
      const mockDatabaseRows: Record<string, unknown>[] = [];
      for (let i = 1; i <= 25; i++) {
        const rawJson = JSON.stringify({ recordId: i, remarks: `Visit remarks for transaction #${i}` });
        const compressed = await compress(Buffer.from(rawJson, "utf8"));
        mockDatabaseRows.push({
          id: i,
          payload: bufferToByteaHex(compressed),
          created_at: 1700000000 + i
        });
      }

      const mockSupabase = {
        from(_table: string) {
          return {
            select(_cols: string) {
              let filterGt: number | undefined;
              let limitCount = 10;

              const builder = {
                order(_col: string, _opts: any) { return builder; },
                limit(n: number) { limitCount = n; return builder; },
                gt(_col: string, val: number) { filterGt = val; return builder; },
                then(resolve: any) {
                  let filtered = mockDatabaseRows;
                  if (filterGt !== undefined) {
                    filtered = filtered.filter((r) => (r.id as number) > filterGt!);
                  }
                  const sliced = filtered.slice(0, limitCount);
                  return resolve({ data: sliced, error: null });
                }
              };
              return builder as any;
            }
          };
        }
      };

      const collected: Record<string, unknown>[] = [];
      for await (const row of readKeysetPaginated(mockSupabase as any, "field_visits", { pageSize: 5 })) {
        collected.push(row);
      }

      expect(collected.length).toBe(25);
      expect((collected[0].payload as any).recordId).toBe(1);
      expect((collected[24].payload as any).recordId).toBe(25);
    });
  });

  // 5. Realistic Dataset Test: Field Visit Form Records
  describe("Realistic Field Visit Form Records", () => {
    it("significantly reduces size while preserving exact form data", async () => {
      const visitFormRecord = {
        role: "BDO",
        name: "Devendra Sharma",
        user_code: "FMF10892",
        state: "Maharashtra",
        cluster: "Mumbai East Cluster",
        branch: "Kurla Branch 04",
        visit_date: "2026-11-04T10:30:00Z",
        remarks: "Verified field attendance, physical photo audit, and merchant onboarding pipeline.",
        nested_audit_log: Array.from({ length: 20 }, (_, i) => ({
          step: i,
          status: "VERIFIED",
          geo_lat: 19.0760,
          geo_lng: 72.8777,
          timestamp: 1700000000 + i * 60
        }))
      };

      const rawBuffer = Buffer.from(JSON.stringify(visitFormRecord), "utf8");
      const compressed = await compress(rawBuffer);

      // Verify reduction
      expect(compressed.length).toBeLessThan(rawBuffer.length);
      const savingsPct = ((rawBuffer.length - compressed.length) / rawBuffer.length) * 100;
      expect(savingsPct).toBeGreaterThan(50); // Over 50% savings

      // Verify exact read-back
      const decompressed = await decompress(compressed);
      const restored = JSON.parse(decompressed.toString("utf8"));
      expect(restored).toEqual(visitFormRecord);
    });
  });
});