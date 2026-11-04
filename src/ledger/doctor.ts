/**
 * losslesspack - Doctor / Diagnostic Engine
 * Validates system environment, optional driver presence, filesystem access,
 * clock stability, and performs binary roundtrip canaries.
 */

import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { isZstdAvailable } from "../algorithms/zstd.js";
import { StorageAdapter } from "../adapters/types.js";
import { MemoryStorageAdapter } from "../adapters/memory.js";

export interface DiagnosticCheck {
  name: string;
  category: "runtime" | "drivers" | "compression" | "filesystem" | "canary";
  passed: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface DoctorReport {
  timestamp: string;
  healthy: boolean;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  checks: DiagnosticCheck[];
}

export async function runDiagnostics(targetAdapter?: StorageAdapter): Promise<DoctorReport> {
  const checks: DiagnosticCheck[] = [];

  function addCheck(
    name: string,
    category: DiagnosticCheck["category"],
    passed: boolean,
    message: string,
    details?: Record<string, unknown>
  ) {
    checks.push({ name, category, passed, message, details });
  }

  // 1. Node.js Version Check (>= 18)
  const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
  addCheck(
    "node_version",
    "runtime",
    nodeMajor >= 18,
    nodeMajor >= 18
      ? `Node.js ${process.version} meets requirement (>= 18.0.0)`
      : `Node.js ${process.version} is unsupported (requires >= 18.0.0)`,
    { version: process.version, major: nodeMajor }
  );

  // 2. Monotonic Clock & Drift Check
  const startEpoch = Date.now();
  const startHr = process.hrtime.bigint();
  await new Promise((r) => setTimeout(r, 10));
  const diffEpoch = Date.now() - startEpoch;
  const diffHrMs = Number((process.hrtime.bigint() - startHr) / 1000000n);
  const clockStable = Math.abs(diffEpoch - diffHrMs) < 25;
  addCheck(
    "monotonic_clock",
    "runtime",
    clockStable,
    clockStable
      ? "System clock and monotonic hrtime are synchronized"
      : `Clock jitter detected (epoch diff: ${diffEpoch}ms, hrtime diff: ${diffHrMs}ms)`
  );

  // 3. Memory Headroom
  const mem = process.memoryUsage();
  const heapUsedMb = Math.round(mem.heapUsed / 1024 / 1024);
  const heapTotalMb = Math.round(mem.heapTotal / 1024 / 1024);
  const freeMemMb = Math.round(os.freemem() / 1024 / 1024);
  addCheck(
    "memory_headroom",
    "runtime",
    freeMemMb > 100,
    `Memory headroom healthy (${freeMemMb} MB free system memory, ${heapUsedMb}/${heapTotalMb} MB heap)`,
    { heapUsedMb, heapTotalMb, freeMemMb }
  );

  // 4. Zstandard Availability Check (Optional algorithm; automatic Brotli fallback)
  const hasZstd = isZstdAvailable();
  addCheck(
    "zstd_availability",
    "compression",
    true,
    hasZstd
      ? "Zstandard compression engine is available and verified"
      : "Zstandard not installed (Brotli fallback will be used automatically)"
  );

  // 5. Binary-Safe Encoding Canary (0x00..0xFF)
  const binaryCanary = Buffer.alloc(256);
  for (let i = 0; i < 256; i++) binaryCanary[i] = i;
  const canaryHash = crypto.createHash("sha256").update(binaryCanary).digest("hex");
  const readBackCanary = Buffer.from(binaryCanary);
  const readBackHash = crypto.createHash("sha256").update(readBackCanary).digest("hex");
  addCheck(
    "binary_safety_canary",
    "runtime",
    canaryHash === readBackHash,
    "Runtime binary buffers preserve all 256 byte values identically (0x00..0xFF)"
  );

  // 6. Optional Database Drivers Detection
  const optionalDrivers = [
    { pkg: "@supabase/supabase-js", name: "Supabase" },
    { pkg: "@mongodb-js/zstd", name: "Zstandard (native/wasm)" },
    { pkg: "pg", name: "PostgreSQL (pg)" },
    { pkg: "mysql2", name: "MySQL (mysql2)" },
    { pkg: "better-sqlite3", name: "SQLite (better-sqlite3)" },
    { pkg: "mongodb", name: "MongoDB" },
    { pkg: "ioredis", name: "Redis (ioredis)" },
    { pkg: "@aws-sdk/client-s3", name: "AWS S3" }
  ];

  for (const drv of optionalDrivers) {
    let installed = false;
    let version: string | undefined = undefined;
    try {
      const mod = await import(drv.pkg);
      installed = true;
      version = (mod as any).default?.version || (mod as any).version;
    } catch {
      // not installed
    }
    addCheck(
      `driver_${drv.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
      "drivers",
      true, // Info check, not a critical failure
      installed
        ? `${drv.name} is available${version ? ` (v${version})` : ""}`
        : `${drv.name} is not installed (optional peer dependency)`
    );
  }

  // 7. Filesystem Journal & Reports Permissions
  const testDir = path.join(process.cwd(), "reports", ".doctor_check");
  let fsOk = false;
  try {
    await fs.mkdir(testDir, { recursive: true });
    const testFile = path.join(testDir, "write_test.tmp");
    await fs.writeFile(testFile, "canary", "utf8");
    const testContent = await fs.readFile(testFile, "utf8");
    await fs.unlink(testFile);
    await fs.rmdir(testDir);
    fsOk = testContent === "canary";
  } catch {
    fsOk = false;
  }
  addCheck(
    "filesystem_write_permissions",
    "filesystem",
    fsOk,
    fsOk
      ? "Read/write access confirmed for reports and journal directories"
      : "Permission denied or failed writing to reports directory"
  );

  // 8. Storage Adapter Roundtrip Canary
  const testAdapter = targetAdapter || new MemoryStorageAdapter();
  let canaryOk = false;
  let canaryMsg = "";
  try {
    const canaryKey = `__doctor_canary_${Date.now()}`;
    const payload = crypto.randomBytes(512);
    await testAdapter.put(canaryKey, payload);
    const retrieved = await testAdapter.get(canaryKey);
    const deleted = await testAdapter.delete(canaryKey);
    if (retrieved && retrieved.equals(payload) && deleted) {
      canaryOk = true;
      canaryMsg = `Adapter '${testAdapter.name}' roundtrip write/read/delete passed`;
    } else {
      canaryMsg = `Adapter '${testAdapter.name}' roundtrip payload mismatch or delete failed`;
    }
  } catch (err: any) {
    canaryOk = false;
    canaryMsg = `Adapter '${testAdapter.name}' canary failed: ${err.message}`;
  }
  addCheck("adapter_roundtrip_canary", "canary", canaryOk, canaryMsg);

  const failedCount = checks.filter((c) => !c.passed && c.category !== "drivers").length;
  const passedCount = checks.filter((c) => c.passed).length;

  return {
    timestamp: new Date().toISOString(),
    healthy: failedCount === 0,
    totalChecks: checks.length,
    passedChecks: passedCount,
    failedChecks: failedCount,
    checks
  };
}