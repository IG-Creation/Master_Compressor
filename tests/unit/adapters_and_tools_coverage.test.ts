import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { getAdapter } from "../../src/adapters/index.js";
import { runAdapterConformanceTests } from "../../src/adapters/conformance.js";
import {
  AdapterTimeoutError,
  AdapterRateLimitError,
  AdapterSizeLimitError,
  AdapterConflictError,
  AdapterUnknownError,
  AdapterUnavailableError,
  AdapterConnectionError
} from "../../src/adapters/errors.js";
import { SQLiteStorageAdapter } from "../../src/adapters/sqlite.js";
import { PostgresStorageAdapter } from "../../src/adapters/postgres.js";
import { MySQLStorageAdapter } from "../../src/adapters/mysql.js";
import { MongoStorageAdapter } from "../../src/adapters/mongodb.js";
import { RedisStorageAdapter } from "../../src/adapters/redis.js";
import { S3StorageAdapter } from "../../src/adapters/s3.js";
import { SupabaseStorageAdapter } from "../../src/adapters/supabase.js";
import { ChaosAdapter } from "../../src/adapters/chaos.js";
import { FilesystemWriteAheadJournal, MemoryWriteAheadJournal } from "../../src/mediator/journal.js";
import { FilesystemQuarantineStore, MemoryQuarantineStore } from "../../src/mediator/quarantine.js";
import { CircuitBreaker } from "../../src/mediator/circuit-breaker.js";
import { runDiagnostics } from "../../src/ledger/doctor.js";
import { FailureLedger } from "../../src/ledger/ledger.js";
import { StorageAuditor } from "../../src/audit/auditor.js";
import { summarizeIncidents, formatTextReport, exportHtmlReport } from "../../src/ledger/report.js";
import { runCli } from "../../src/cli.js";
import { MemoryStorageAdapter } from "../../src/adapters/memory.js";
import { LosslessMediator } from "../../src/mediator/mediator.js";
import { compress } from "../../src/index.js";

describe("Adapters, Diagnostics, CLI & Tooling Coverage", () => {
  it("exercises all typed adapter errors and retryable flags", () => {
    const connErr = new AdapterConnectionError("test", "conn failed");
    expect(connErr.retryable).toBe(true);
    expect(connErr.code).toBe("ERR_ADAPTER_CONNECTION");

    const timeoutErr = new AdapterTimeoutError("test", "timeout");
    expect(timeoutErr.retryable).toBe(true);
    expect(timeoutErr.code).toBe("ERR_ADAPTER_TIMEOUT");

    const rateErr = new AdapterRateLimitError("test", "rate limit");
    expect(rateErr.retryable).toBe(true);

    const sizeErr = new AdapterSizeLimitError("test", "size limit");
    expect(sizeErr.retryable).toBe(false);

    const conflictErr = new AdapterConflictError("test", "conflict");
    expect(conflictErr.retryable).toBe(false);

    const unkErr = new AdapterUnknownError("test", "unknown");
    expect(unkErr.retryable).toBe(false);

    const unavailErr = new AdapterUnavailableError("test", "driver missing");
    expect(unavailErr.retryable).toBe(false);
  });

  it("exercises getAdapter factory across all supported names", () => {
    expect(getAdapter("memory").name).toBe("memory");
    expect(getAdapter("fs").name).toBe("filesystem");
    expect(getAdapter("filesystem").name).toBe("filesystem");
    expect(getAdapter("sqlite", { db: { exec: () => {} } }).name).toBe("sqlite");
    expect(getAdapter("better-sqlite3", { db: { exec: () => {} } }).name).toBe("sqlite");
    expect(getAdapter("pg", { client: { query: async () => ({ rows: [] }) } }).name).toBe("postgres");
    expect(getAdapter("postgres", { client: { query: async () => ({ rows: [] }) } }).name).toBe("postgres");
    expect(getAdapter("mysql", { client: { query: async () => [[]] } }).name).toBe("mysql");
    expect(getAdapter("mysql2", { client: { query: async () => [[]] } }).name).toBe("mysql");
    expect(getAdapter("mongo", { collection: {} }).name).toBe("mongodb");
    expect(getAdapter("mongodb", { collection: {} }).name).toBe("mongodb");
    expect(getAdapter("redis", { client: {} }).name).toBe("redis");
    expect(getAdapter("ioredis", { client: {} }).name).toBe("redis");
    expect(getAdapter("s3", { client: {}, bucket: "test" }).name).toBe("s3");
    expect(getAdapter("supabase", { client: {} }).name).toBe("supabase");
    expect(() => getAdapter("invalid_adapter_xyz")).toThrow(AdapterUnavailableError);
  });

  it("exercises ChaosAdapter comprehensive fault modes", async () => {
    const memory = new MemoryStorageAdapter();

    const chaosTimeout = new ChaosAdapter(memory, { timeoutRate: 1.0 });
    await expect(chaosTimeout.get("k")).rejects.toThrow(AdapterTimeoutError);

    const chaosRateLimit = new ChaosAdapter(memory, { rateLimitRate: 1.0 });
    await expect(chaosRateLimit.put("k", Buffer.from("v"))).rejects.toThrow(AdapterRateLimitError);

    const chaosDiskFull = new ChaosAdapter(memory, { diskFullRate: 1.0 });
    await expect(chaosDiskFull.delete("k")).rejects.toThrow(AdapterSizeLimitError);

    const chaosPartial = new ChaosAdapter(memory, { partialWriteRate: 1.0 });
    await chaosPartial.put("partKey", Buffer.from("1234567890"));
    const partialRead = await memory.get("partKey");
    expect(partialRead!.length).toBe(5);

    const chaosLatency = new ChaosAdapter(memory, { latencyMs: { min: 2, max: 5 } });
    await chaosLatency.put("latKey", Buffer.from("latVal"));
    expect(await chaosLatency.exists("latKey")).toBe(true);
    expect(chaosLatency.capabilities().atomicWrites).toBe(true);

    await chaosLatency.putMany([{ key: "pm1", bytes: Buffer.from("b1") }]);
    expect(await chaosLatency.exists("pm1")).toBe(true);
    await chaosLatency.close();
  });

  it("exercises SQLiteStorageAdapter with callback-based mock db", async () => {
    const table = new Map<string, any>();
    const mockCallbackDb = {
      run: (sql: string, params: any[], cb: any) => {
        if (sql.includes("INSERT")) {
          table.set(params[0], params[1]);
          cb(null);
        } else if (sql.includes("DELETE")) {
          const existed = table.has(params[0]);
          table.delete(params[0]);
          cb.call({ changes: existed ? 1 : 0 }, null);
        } else {
          cb(null);
        }
      },
      get: (sql: string, params: any[], cb: any) => {
        const val = table.get(params[0]);
        cb(null, val ? { val } : null);
      },
      all: (sql: string, params: any[], cb: any) => {
        cb(null, Array.from(table.keys()).map((key) => ({ key })));
      }
    };

    const sqlite = new SQLiteStorageAdapter({ db: mockCallbackDb });
    await sqlite.put("cb_key", Buffer.from("cb_val"));
    expect(await sqlite.exists("cb_key")).toBe(true);
    const read = await sqlite.get("cb_key");
    expect(read!.toString()).toBe("cb_val");
    const list = await sqlite.list("cb_");
    expect(list.keys).toContain("cb_key");
    expect(await sqlite.delete("cb_key")).toBe(true);
  });

  it("exercises PostgresStorageAdapter with mock client", async () => {
    const rows = new Map<string, Buffer>();
    const mockClient = {
      query: async (sql: string, params?: any[]) => {
        if (sql.includes("CREATE TABLE")) return { rows: [] };
        if (sql.includes("INSERT")) {
          rows.set(params![0], params![1]);
          return { rows: [] };
        }
        if (sql.includes("SELECT val FROM")) {
          const val = rows.get(params![0]);
          return { rows: val ? [{ val }] : [] };
        }
        if (sql.includes("SELECT 1 FROM")) {
          return { rows: rows.has(params![0]) ? [{ "?column?": 1 }] : [] };
        }
        if (sql.includes("DELETE FROM")) {
          const had = rows.has(params![0]);
          rows.delete(params![0]);
          return { rowCount: had ? 1 : 0, rows: [] };
        }
        if (sql.includes("SELECT key FROM")) {
          return { rows: Array.from(rows.keys()).map((key) => ({ key })) };
        }
        return { rows: [] };
      }
    };

    const pg = new PostgresStorageAdapter({ client: mockClient });
    expect(pg.capabilities().supportsPrefixList).toBe(true);

    await pg.put("pg_key", Buffer.from("pg_data"));
    expect(await pg.exists("pg_key")).toBe(true);
    const fetched = await pg.get("pg_key");
    expect(fetched!.toString()).toBe("pg_data");
    const list = await pg.list("pg_");
    expect(list.keys).toContain("pg_key");
    expect(await pg.delete("pg_key")).toBe(true);
  });

  it("exercises MySQLStorageAdapter with mock client", async () => {
    const store = new Map<string, Buffer>();
    const mockClient = {
      query: async (sql: string, params?: any[]) => {
        if (sql.includes("CREATE TABLE")) return [{ affectedRows: 0 }];
        if (sql.includes("INSERT INTO")) {
          store.set(params![0], params![1]);
          return [{ affectedRows: 1 }];
        }
        if (sql.includes("SELECT") && sql.includes("val")) {
          const val = store.get(params![0]);
          return [val ? [{ val }] : []];
        }
        if (sql.includes("SELECT 1 FROM")) {
          return [store.has(params![0]) ? [{ 1: 1 }] : []];
        }
        if (sql.includes("DELETE FROM")) {
          const had = store.has(params![0]);
          store.delete(params![0]);
          return [{ affectedRows: had ? 1 : 0 }];
        }
        if (sql.includes("SELECT") && sql.includes("key")) {
          return [Array.from(store.keys()).map((k) => ({ key: k }))];
        }
        return [[]];
      }
    };

    const mysql = new MySQLStorageAdapter({ client: mockClient });
    await mysql.put("my_key", Buffer.from("my_data"));
    expect(await mysql.exists("my_key")).toBe(true);
    const read = await mysql.get("my_key");
    expect(read!.toString()).toBe("my_data");
    const list = await mysql.list("my_");
    expect(list.keys).toContain("my_key");
    expect(await mysql.delete("my_key")).toBe(true);
  });

  it("exercises MongoStorageAdapter with mock collection", async () => {
    const store = new Map<string, { val: Buffer; meta: any }>();
    const mockCol = {
      updateOne: async (filter: any, update: any) => {
        const key = filter._id;
        const setObj = update.$set;
        store.set(key, { val: Buffer.from(setObj.val), meta: setObj.meta });
        return { acknowledged: true };
      },
      findOne: async (filter: any) => {
        const item = store.get(filter._id);
        return item ? { _id: filter._id, val: Buffer.from(item.val) } : null;
      },
      deleteOne: async (filter: any) => {
        const deleted = store.delete(filter._id);
        return { deletedCount: deleted ? 1 : 0 };
      },
      countDocuments: async (filter: any) => (store.has(filter._id) ? 1 : 0),
      find: () => ({
        sort: () => ({
          limit: () => ({
            toArray: async () => Array.from(store.keys()).map((k) => ({ _id: k }))
          })
        })
      })
    };

    const mongo = new MongoStorageAdapter({ collection: mockCol });
    await mongo.put("mongo_key", Buffer.from("mongo_data"));
    expect(await mongo.exists("mongo_key")).toBe(true);
    const read = await mongo.get("mongo_key");
    expect(read!.toString()).toBe("mongo_data");
    const list = await mongo.list();
    expect(list.keys).toContain("mongo_key");
    expect(await mongo.delete("mongo_key")).toBe(true);
  });

  it("exercises RedisStorageAdapter with mock client", async () => {
    const store = new Map<string, Buffer>();
    const mockRedis = {
      set: async (k: string, v: Buffer) => {
        store.set(k, v);
        return "OK";
      },
      getBuffer: async (k: string) => store.get(k) || null,
      exists: async (k: string) => (store.has(k) ? 1 : 0),
      del: async (k: string) => (store.delete(k) ? 1 : 0),
      scan: async () => ["0", Array.from(store.keys())]
    };

    const redis = new RedisStorageAdapter({ client: mockRedis });
    await redis.put("redis_key", Buffer.from("redis_data"));
    expect(await redis.exists("redis_key")).toBe(true);
    const read = await redis.get("redis_key");
    expect(read!.toString()).toBe("redis_data");
    const list = await redis.list("redis_");
    expect(list.keys).toContain("redis_key");
    expect(await redis.delete("redis_key")).toBe(true);
  });

  it("exercises S3StorageAdapter with mock client", async () => {
    const store = new Map<string, Buffer>();
    const mockS3 = {
      send: async (cmd: any) => {
        const input = cmd.input || cmd;
        if (input.Body !== undefined) {
          store.set(input.Key, Buffer.from(input.Body));
          return {};
        }
        if (input.Key && !input.ContinuationToken && !input.Prefix) {
          if (cmd.commandName === "DeleteObjectCommand") {
            store.delete(input.Key);
            return {};
          }
          if (cmd.commandName === "HeadObjectCommand") {
            if (!store.has(input.Key)) {
              const err: any = new Error("NotFound");
              err.name = "NotFound";
              throw err;
            }
            return {};
          }
          const body = store.get(input.Key);
          if (!body) {
            const err: any = new Error("NoSuchKey");
            err.name = "NoSuchKey";
            throw err;
          }
          return { Body: Buffer.from(body) };
        }
        return {
          Contents: Array.from(store.keys()).map((k) => ({ Key: k })),
          NextContinuationToken: undefined
        };
      }
    };

    const s3 = new S3StorageAdapter({ client: mockS3, bucket: "test-bucket" });
    await s3.put("s3_key", Buffer.from("s3_data"));
    expect(await s3.exists("s3_key")).toBe(true);
    const read = await s3.get("s3_key");
    expect(read!.toString()).toBe("s3_data");
    const list = await s3.list();
    expect(list.keys).toContain("s3_key");
    expect(await s3.delete("s3_key")).toBe(true);
  });

  it("exercises SupabaseStorageAdapter with mock client", async () => {
    const byteaStore = new Map<string, string>();
    const mockSupabase = {
      from: () => ({
        upsert: async (row: any) => {
          byteaStore.set(row.id, row.payload);
          return { error: null };
        },
        select: () => ({
          eq: (field: string, val: any) => ({
            maybeSingle: async () => {
              const res = byteaStore.get(val);
              return { data: res ? { payload: res } : null, error: null };
            }
          }),
          ilike: () => ({
            order: () => ({
              limit: async () => ({
                data: Array.from(byteaStore.keys()).map((k) => ({ id: k })),
                error: null
              })
            })
          })
        }),
        delete: () => ({
          eq: () => ({
            select: async () => {
              return { data: [{ id: "deleted" }], error: null };
            }
          })
        })
      })
    };

    const sb = new SupabaseStorageAdapter({ client: mockSupabase });
    await sb.put("sb_key", Buffer.from("sb_data"));
    expect(await sb.exists("sb_key")).toBe(true);
    const read = await sb.get("sb_key");
    expect(read!.toString()).toBe("sb_data");
    const list = await sb.list();
    expect(list.keys).toContain("sb_key");
    expect(await sb.delete("sb_key")).toBe(true);
  });

  it("exercises StorageAuditor with FailureLedger reporting", async () => {
    const adapter = new MemoryStorageAdapter();
    const ledger = new FailureLedger({ autoRegenerateMarkdown: false });

    await adapter.put("aud/ok", await compress(Buffer.from("clean")));
    await adapter.put("aud/bad", Buffer.from("corrupt_header_bytes"));

    const auditor = new StorageAuditor({
      adapter,
      prefix: "aud/",
      ledger,
      rateLimitRps: 0
    });

    const res = await auditor.run();
    expect(res.corrupted).toBe(1);
    expect(res.verified).toBe(1);

    const incidents = await ledger.query({ component: "audit" });
    expect(incidents.length).toBeGreaterThan(0);
    expect(["ERR_TRUNCATED_DATA", "ERR_CORRUPT_HEADER"]).toContain(incidents[0].errorCode);
  });

  it("exercises LosslessMediator recover quarantine and shutdown timeout", async () => {
    const adapter = new MemoryStorageAdapter();
    const journal = new MemoryWriteAheadJournal();
    const quarantine = new MemoryQuarantineStore();

    await journal.beginWrite({
      id: "unrecoverable_rec",
      key: "bad_key",
      sha256: "fake_hash_123",
      originalPayload: Buffer.from("quarantine_me")
    });

    const mediator = new LosslessMediator(adapter, {}, journal, quarantine);
    const rep = await mediator.recover();
    expect(rep.quarantined).toBe(1);
    expect(rep.rolledBack).toBe(1);

    await mediator.shutdown(50);
  });

  it("exercises FilesystemWriteAheadJournal and FilesystemQuarantineStore", async () => {
    const tmpDir = path.join(os.tmpdir(), "llp_fs_tools_" + Date.now());
    const walDir = path.join(tmpDir, "wal");
    const qDir = path.join(tmpDir, "quarantine");

    const wal = new FilesystemWriteAheadJournal(walDir);
    await wal.beginWrite({
      id: "wal_1",
      key: "item_wal",
      sha256: "abc",
      compressedPayload: Buffer.from("wal_compressed"),
      originalPayload: Buffer.from("wal_orig")
    });

    let pending = await wal.getPending();
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe("wal_1");

    await wal.commitWrite("wal_1");
    pending = await wal.getPending();
    expect(pending.length).toBe(0);

    await wal.beginWrite({
      id: "wal_2",
      key: "item_wal_2",
      sha256: "def"
    });
    await wal.rollbackWrite("wal_2");
    await wal.purge(0);
    await wal.clear();

    const q = new FilesystemQuarantineStore(qDir);
    await q.quarantine({
      id: "q_1",
      key: "bad_key",
      payload: Buffer.from("quarantined_data"),
      sha256: "hash123",
      error: "Sample error",
      errorCode: "ERR_SAMPLE",
      failedAt: new Date().toISOString(),
      adapterName: "test"
    });

    const qList = await q.list();
    expect(qList.length).toBe(1);
    expect(qList[0].key).toBe("bad_key");

    const item = await q.get("q_1");
    expect(item!.payload.toString()).toBe("quarantined_data");

    expect(await q.remove("q_1")).toBe(true);
    await q.clear();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("exercises CircuitBreaker half-open recovery transitions", () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 10, successThreshold: 2 });
    expect(cb.canExecute()).toBe(true);

    cb.recordFailure();
    expect(cb.getState()).toBe("CLOSED");
    cb.recordFailure();
    expect(cb.getState()).toBe("OPEN");
    expect(cb.canExecute()).toBe(false);

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cb.getState()).toBe("HALF_OPEN");
        expect(cb.canExecute()).toBe(true);

        cb.recordSuccess();
        expect(cb.getState()).toBe("HALF_OPEN");

        cb.recordSuccess();
        expect(cb.getState()).toBe("CLOSED");

        cb.reset();
        expect(cb.getState()).toBe("CLOSED");
        resolve();
      }, 25);
    });
  });

  it("exercises runDiagnostics and report generator", async () => {
    const diag = await runDiagnostics(new MemoryStorageAdapter());
    expect(diag.totalChecks).toBeGreaterThan(5);
    expect(diag.healthy).toBe(true);

    const incidents: any[] = [
      {
        id: "INC-1",
        timestamp: "2026-11-05T00:00:00.000Z",
        severity: "ERROR",
        errorCode: "ERR_CHECKSUM_MISMATCH",
        component: "mediator",
        message: "Checksum failed",
        adapterName: "memory",
        libraryVersion: "1.0.0",
        nodeVersion: process.version,
        os: "test-os",
        suggestedNextStep: "inspect"
      }
    ];

    const s = summarizeIncidents(incidents);
    expect(s.totalIncidents).toBe(1);

    const txt = formatTextReport(incidents);
    expect(txt).toContain("LOSSLESSPACK OPERATIONAL REPORT");

    const tmpHtml = path.join(os.tmpdir(), "llp_dash_" + Date.now() + ".html");
    await exportHtmlReport(incidents, tmpHtml);
    const htmlContent = await fs.readFile(tmpHtml, "utf8");
    expect(htmlContent).toContain("Losslesspack Incident Dashboard");
    await fs.unlink(tmpHtml).catch(() => {});
  });

  it("exercises CLI commands: --help, info, bench, doctor, report", async () => {
    const exitHelp = await runCli(["node", "cli", "--help"]);
    expect(exitHelp).toBe(0);

    const tmpFile = path.join(os.tmpdir(), "llp_cli_" + Date.now() + ".bin");
    const compressed = await compress(Buffer.from("cli file test"));
    await fs.writeFile(tmpFile, compressed);

    const exitInfo = await runCli(["node", "cli", "info", tmpFile]);
    expect(exitInfo).toBe(0);

    const exitVerify = await runCli(["node", "cli", "verify", tmpFile]);
    expect(exitVerify).toBe(0);

    const exitBench = await runCli(["node", "cli", "bench"]);
    expect(exitBench).toBe(0);

    const exitDoc = await runCli(["node", "cli", "doctor"]);
    expect(exitDoc).toBe(0);

    const exitRep = await runCli(["node", "cli", "report"]);
    expect(exitRep).toBe(0);

    await fs.unlink(tmpFile).catch(() => {});
  });

  it("exercises auditor when adapter.get throws and conformance failure branch", async () => {
    const failingAdapter = new MemoryStorageAdapter();
    await failingAdapter.put("fail_key", Buffer.from("data"));
    failingAdapter.get = async () => { throw new Error("Disk read error"); };
    const aud = new StorageAuditor({ adapter: failingAdapter, rateLimitRps: 0 });
    const audRes = await aud.run();
    expect(audRes.unreadable).toBe(1);

    const brokenAdapter = new MemoryStorageAdapter();
    brokenAdapter.get = async () => Buffer.from("wrong");
    await expect(runAdapterConformanceTests(async () => brokenAdapter)).rejects.toThrow(/Adapter conformance tests failed/);
  });
});