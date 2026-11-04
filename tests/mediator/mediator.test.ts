import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { MemoryStorageAdapter } from "../../src/adapters/memory.js";
import { LosslessMediator } from "../../src/mediator/mediator.js";

describe("LosslessMediator Pipeline", () => {
  it("strict mode: writes, read-backs, verifies SHA-256, and returns receipt", async () => {
    const adapter = new MemoryStorageAdapter();
    const mediator = new LosslessMediator(adapter, { mode: "strict" });

    const key = "users/123/profile";
    const payload = Buffer.from(JSON.stringify({ id: 123, name: "Alice", active: true }));

    const receipt = await mediator.write(key, payload);

    expect(receipt.key).toBe(key);
    expect(receipt.originalSize).toBe(payload.length);
    expect(receipt.storedSize).toBeGreaterThan(0);
    expect(receipt.adapter).toBe("memory");
    expect(receipt.sha256).toBe(crypto.createHash("sha256").update(payload).digest("hex"));

    // Verify read
    const restored = await mediator.read(key);
    expect(restored).not.toBeNull();
    expect(restored!.equals(payload)).toBe(true);
  });

  it("dry-run mode: computes compression stats without writing anything to adapter", async () => {
    const adapter = new MemoryStorageAdapter();
    const mediator = new LosslessMediator(adapter, { mode: "dry-run" });

    const key = "dryrun/record";
    const payload = Buffer.from("dry-run test payload that should not be stored".repeat(5));

    const receipt = await mediator.write(key, payload);
    expect(receipt.dryRun).toBe(true);
    expect(receipt.storedSize).toBeGreaterThan(0);

    const exists = await adapter.exists(key);
    expect(exists).toBe(false);
  });

  it("idempotent writes: writing identical content to existing key returns receipt without re-writing", async () => {
    const adapter = new MemoryStorageAdapter();
    const mediator = new LosslessMediator(adapter);

    const key = "idempotent/record";
    const payload = Buffer.from("idempotent content payload");

    const receipt1 = await mediator.write(key, payload);
    const receipt2 = await mediator.write(key, payload);

    expect(receipt1.sha256).toBe(receipt2.sha256);
    expect(receipt1.key).toBe(receipt2.key);
  });

  it("shadow mode: writes compressed and shadow raw copies and verifies both", async () => {
    const adapter = new MemoryStorageAdapter();
    const mediator = new LosslessMediator(adapter, { mode: "shadow" });

    const key = "shadow/user";
    const payload = crypto.randomBytes(512);

    const receipt = await mediator.write(key, payload);
    expect(receipt.shadowVerified).toBe(true);

    // Verify shadow raw key exists
    const shadowRaw = await adapter.get(`${key}.__llp_shadow_raw__`);
    expect(shadowRaw).not.toBeNull();
    expect(shadowRaw!.equals(payload)).toBe(true);

    // Read through mediator returns bit-identical data
    const read = await mediator.read(key);
    expect(read!.equals(payload)).toBe(true);
  });

  it("supports delete and cleanup", async () => {
    const adapter = new MemoryStorageAdapter();
    const mediator = new LosslessMediator(adapter, { mode: "shadow" });

    const key = "delete/test";
    await mediator.write(key, "data to delete");
    expect(await mediator.exists(key)).toBe(true);

    const deleted = await mediator.delete(key);
    expect(deleted).toBe(true);
    expect(await mediator.exists(key)).toBe(false);
  });
});