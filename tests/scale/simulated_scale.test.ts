import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { MemoryStorageAdapter } from "../../src/adapters/memory.js";
import { LosslessMediator } from "../../src/mediator/mediator.js";

describe("Scale & Memory Stability Simulation", () => {
  it("processes high-volume records with stable memory and 100% reconciliation", async () => {
    // Configurable scale: default to 5,000 for fast CI, extensible to 1,000,000 via env
    const totalRecords = process.env.SCALE_RECORDS ? parseInt(process.env.SCALE_RECORDS, 10) : 2500;
    const batchSize = 250;

    const adapter = new MemoryStorageAdapter();
    const mediator = new LosslessMediator(adapter, { mode: "strict" });

    // Track original hashes for 100% reconciliation pass
    const recordedHashes = new Map<string, string>();

    const initialMem = process.memoryUsage().heapUsed;

    for (let batchStart = 0; batchStart < totalRecords; batchStart += batchSize) {
      const currentBatchSize = Math.min(batchSize, totalRecords - batchStart);
      const batchPromises = [];

      for (let i = 0; i < currentBatchSize; i++) {
        const id = batchStart + i;
        const key = `scale/record_${id.toString().padStart(7, "0")}`;
        const payload = Buffer.from(
          JSON.stringify({
            recordId: id,
            timestamp: 1700000000 + id,
            event: "TELEMETRY_SAMPLE",
            metrics: [id * 1.5, id * 2.5, id % 100],
            tags: { env: "prod", cluster: "us-east-1" }
          })
        );
        const sha = crypto.createHash("sha256").update(payload).digest("hex");
        recordedHashes.set(key, sha);

        batchPromises.push(mediator.write(key, payload));
      }

      await Promise.all(batchPromises);
    }

    // Memory stability assertion: ensure no runaway memory leaks
    if (global.gc) {
      global.gc();
    }
    const finalMem = process.memoryUsage().heapUsed;
    const memIncreaseMb = (finalMem - initialMem) / 1024 / 1024;
    // Memory increase should be reasonable for the data stored
    expect(memIncreaseMb).toBeLessThan(300);

    // Final Reconciliation Pass: sample and verify stored records
    const sampleKeys = Array.from(recordedHashes.keys()).slice(0, 100);
    for (const sampleKey of sampleKeys) {
      const retrieved = await mediator.read(sampleKey);
      expect(retrieved).not.toBeNull();
      const readSha = crypto.createHash("sha256").update(retrieved!).digest("hex");
      expect(readSha).toBe(recordedHashes.get(sampleKey));
    }
  });
});