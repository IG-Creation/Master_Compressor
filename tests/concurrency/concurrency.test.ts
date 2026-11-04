import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { compress, decompress, compressFile, decompressFile } from "../../src/index.js";

describe("Section E: Concurrency & File Robustness", () => {
  it("executes 1000 concurrent compress and decompress calls cleanly", async () => {
    const tasks: Promise<void>[] = [];

    for (let i = 0; i < 1000; i++) {
      tasks.push(
        (async () => {
          const payload = Buffer.from(`Concurrent task payload #${i} timestamp=${Date.now()}`);
          const compressed = await compress(payload);
          const decompressed = await decompress(compressed);
          expect(decompressed.equals(payload)).toBe(true);
        })()
      );
    }

    await Promise.all(tasks);
  });

  it("handles atomic compressFile and decompressFile without corrupting files", async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "losslesspack-test-"));
    const srcFile = path.join(tmpDir, "source.txt");
    const compFile = path.join(tmpDir, "source.txt.llp1");
    const restoredFile = path.join(tmpDir, "restored.txt");

    const content = "Atomic file round-trip testing content\n".repeat(500);
    await fsp.writeFile(srcFile, content, "utf8");

    // Compress
    const compRes = await compressFile(srcFile, compFile);
    expect(compRes.originalSize).toBe(Buffer.byteLength(content));
    expect(fs.existsSync(compFile)).toBe(true);

    // Decompress
    const decompRes = await decompressFile(compFile, restoredFile);
    expect(decompRes.originalSize).toBe(Buffer.byteLength(content));
    expect(fs.existsSync(restoredFile)).toBe(true);

    const readBack = await fsp.readFile(restoredFile, "utf8");
    expect(readBack).toBe(content);

    // Clean up
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it("leaves original file untouched if compressFile source does not exist", async () => {
    const nonExistent = path.join(os.tmpdir(), `non_existent_${Date.now()}.txt`);
    const target = path.join(os.tmpdir(), `target_${Date.now()}.llp1`);

    await expect(compressFile(nonExistent, target)).rejects.toThrow();
    expect(fs.existsSync(target)).toBe(false);
  });
});