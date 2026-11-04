import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { MemoryStorageAdapter } from "../../src/adapters/memory.js";
import { LosslessMediator } from "../../src/mediator/mediator.js";
import { MemoryWriteAheadJournal } from "../../src/mediator/journal.js";
import { MemoryQuarantineStore } from "../../src/mediator/quarantine.js";
import { compress } from "../../src/index.js";

describe("Simulated Crash Recovery (WAL)", () => {
  it("recovers half-finished write where adapter write completed but journal commit crashed", async () => {
    const adapter = new MemoryStorageAdapter();
    const journal = new MemoryWriteAheadJournal();
    const quarantine = new MemoryQuarantineStore();

    const key = "crash/half_finished_committed";
    const payload = Buffer.from("Important user data before crash");
    const sha256 = crypto.createHash("sha256").update(payload).digest("hex");
    const compressed = await compress(payload);

    // Simulate crash: adapter wrote the compressed bytes, but journal remained pending
    await adapter.put(key, compressed);
    await journal.beginWrite({
      id: "crash-wal-001",
      key,
      sha256,
      compressedPayload: compressed,
      originalPayload: payload
    });

    const pendingBefore = await journal.getPending();
    expect(pendingBefore.length).toBe(1);

    // Run recovery
    const mediator = new LosslessMediator(adapter, {}, journal, quarantine);
    const report = await mediator.recover();

    expect(report.scanned).toBe(1);
    expect(report.committed).toBe(1);

    const pendingAfter = await journal.getPending();
    expect(pendingAfter.length).toBe(0);

    // Data in storage is 100% readable and verified
    const restored = await mediator.read(key);
    expect(restored!.equals(payload)).toBe(true);
  });

  it("recovers pending write by writing compressed payload from WAL into adapter", async () => {
    const adapter = new MemoryStorageAdapter();
    const journal = new MemoryWriteAheadJournal();
    const quarantine = new MemoryQuarantineStore();

    const key = "crash/pending_payload_in_wal";
    const payload = Buffer.from("Payload saved in WAL before network crash");
    const sha256 = crypto.createHash("sha256").update(payload).digest("hex");
    const compressed = await compress(payload);

    // WAL entry created, but process crashed before adapter.put
    await journal.beginWrite({
      id: "crash-wal-002",
      key,
      sha256,
      compressedPayload: compressed,
      originalPayload: payload
    });

    expect(await adapter.exists(key)).toBe(false);

    // Recover
    const mediator = new LosslessMediator(adapter, {}, journal, quarantine);
    const report = await mediator.recover();

    expect(report.scanned).toBe(1);
    expect(report.committed).toBe(1);
    expect(await adapter.exists(key)).toBe(true);

    const restored = await mediator.read(key);
    expect(restored!.equals(payload)).toBe(true);
  });
});