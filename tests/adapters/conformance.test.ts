import { describe, it, expect, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { runAdapterConformanceTests } from "../../src/adapters/conformance.js";
import { MemoryStorageAdapter } from "../../src/adapters/memory.js";
import { FilesystemStorageAdapter } from "../../src/adapters/filesystem.js";

describe("Storage Adapter Conformance Suite", () => {
  it("passes full conformance suite for MemoryStorageAdapter", async () => {
    const report = await runAdapterConformanceTests(async () => new MemoryStorageAdapter({ maxValueSizeBytes: 512 * 1024 }), {
      testLargeValues: true
    });
    expect(report.failedChecks).toBe(0);
    expect(report.passedChecks).toBe(report.totalChecks);
    expect(report.totalChecks).toBeGreaterThanOrEqual(7);
  });

  it("passes full conformance suite for FilesystemStorageAdapter", async () => {
    const tmpDir = path.join(os.tmpdir(), `llp_conf_fs_${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    try {
      const report = await runAdapterConformanceTests(async () => new FilesystemStorageAdapter({ baseDir: tmpDir, maxValueSizeBytes: 256 * 1024 }), {
        testLargeValues: true
      });
      expect(report.failedChecks).toBe(0);
      expect(report.passedChecks).toBe(report.totalChecks);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});