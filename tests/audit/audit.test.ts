import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { MemoryStorageAdapter } from "../../src/adapters/memory.js";
import { StorageAuditor } from "../../src/audit/auditor.js";
import { compress } from "../../src/index.js";

describe("Storage Auditor & Scrub Engine", () => {
  it("audits clean dataset and reports 100% verified", async () => {
    const adapter = new MemoryStorageAdapter();

    // Populate with 20 valid LLP1 containers
    for (let i = 0; i < 20; i++) {
      const payload = Buffer.from(`record-content-${i}`);
      const compressed = await compress(payload);
      await adapter.put(`records/rec_${i.toString().padStart(3, "0")}`, compressed);
    }

    const auditor = new StorageAuditor({
      adapter,
      prefix: "records/",
      sampleRate: 1.0,
      rateLimitRps: 0
    });

    const report = await auditor.run();

    expect(report.scanned).toBe(20);
    expect(report.verified).toBe(20);
    expect(report.corrupted).toBe(0);
    expect(report.missing).toBe(0);
    expect(report.completed).toBe(true);
    expect(report.failures.length).toBe(0);
  });

  it("detects corrupted and truncated records during scrub", async () => {
    const adapter = new MemoryStorageAdapter();

    // 1. Valid record
    const validData = await compress(Buffer.from("valid data"));
    await adapter.put("audit/valid", validData);

    // 2. Corrupted CRC32 header
    const corruptHeader = Buffer.from(validData);
    corruptHeader[2] = 0x99; // corrupt magic/header
    await adapter.put("audit/corrupt_header", corruptHeader);

    // 3. Bit-flipped payload
    const bitFlipped = Buffer.from(validData);
    bitFlipped[bitFlipped.length - 1] ^= 0x01;
    await adapter.put("audit/bit_flipped", bitFlipped);

    const auditor = new StorageAuditor({
      adapter,
      prefix: "audit/",
      rateLimitRps: 0
    });

    const report = await auditor.run();

    expect(report.scanned).toBe(3);
    expect(report.verified).toBe(1);
    expect(report.corrupted).toBe(2);
    expect(report.failures.length).toBe(2);
  });

  it("supports pagination and resume via cursor", async () => {
    const adapter = new MemoryStorageAdapter();

    for (let i = 0; i < 15; i++) {
      const data = await compress(Buffer.from(`item-${i}`));
      await adapter.put(`page/item_${i.toString().padStart(2, "0")}`, data);
    }

    // First run with maxRecords: 7
    const auditor1 = new StorageAuditor({
      adapter,
      prefix: "page/",
      maxRecords: 7,
      rateLimitRps: 0
    });

    const report1 = await auditor1.run();
    expect(report1.scanned).toBe(7);
    expect(report1.verified).toBe(7);
    expect(report1.nextCursor).toBeDefined();

    // Second run resuming with cursor
    const auditor2 = new StorageAuditor({
      adapter,
      prefix: "page/",
      cursor: report1.nextCursor,
      maxRecords: 10,
      rateLimitRps: 0
    });

    const report2 = await auditor2.run();
    expect(report2.scanned).toBe(8); // remaining 8 items
    expect(report2.verified).toBe(8);
  });
});