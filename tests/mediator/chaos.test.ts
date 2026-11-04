import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { MemoryStorageAdapter } from "../../src/adapters/memory.js";
import { ChaosAdapter } from "../../src/adapters/chaos.js";
import { LosslessMediator } from "../../src/mediator/mediator.js";
import { MemoryQuarantineStore } from "../../src/mediator/quarantine.js";

describe("Chaos Fault Injection & Circuit Breaker", () => {
  it("detects injected bit flips on read and prevents silent corruption", async () => {
    const memory = new MemoryStorageAdapter();
    // 0% on write, 100% bitFlip on read
    const chaos = new ChaosAdapter(memory, { bitFlipRate: 1.0 });
    const mediator = new LosslessMediator(memory); // write through normal memory

    const key = "chaos/bitflip_target";
    const payload = crypto.randomBytes(256);
    await mediator.write(key, payload);

    // Now read through chaos adapter
    const chaosMediator = new LosslessMediator(chaos);
    await expect(chaosMediator.read(key)).rejects.toThrow();
  });

  it("detects injected truncated reads and throws TruncatedDataError", async () => {
    const memory = new MemoryStorageAdapter();
    const chaos = new ChaosAdapter(memory, { truncatedReadRate: 1.0 });
    const mediator = new LosslessMediator(memory);

    const key = "chaos/truncated_read_target";
    const payload = crypto.randomBytes(512);
    await mediator.write(key, payload);

    const chaosMediator = new LosslessMediator(chaos);
    await expect(chaosMediator.read(key)).rejects.toThrow();
  });

  it("trips circuit breaker and quarantines record on persistent downstream failures", async () => {
    const memory = new MemoryStorageAdapter();
    // Injected connection reset on all puts
    const chaos = new ChaosAdapter(memory, { connectionResetRate: 1.0 });
    const quarantine = new MemoryQuarantineStore();
    const mediator = new LosslessMediator(
      chaos,
      { retries: 2, circuitBreakerThreshold: 1 },
      undefined,
      quarantine
    );

    const key = "chaos/quarantine_test";
    const payload = Buffer.from("CRITICAL_USER_TRANSACTION_PAYLOAD");

    // Write should fail and record should be quarantined
    let caughtErr: any = null;
    try {
      await mediator.write(key, payload);
    } catch (err: any) {
      caughtErr = err;
    }

    expect(caughtErr).not.toBeNull();
    expect(caughtErr.quarantined).toBe(true);

    // Assert Zero Data Loss: quarantine store has the original record!
    const quarantinedItems = await quarantine.list();
    expect(quarantinedItems.length).toBe(1);
    expect(quarantinedItems[0].key).toBe(key);
    expect(quarantinedItems[0].payload.equals(payload)).toBe(true);
    expect(quarantinedItems[0].sha256).toBe(crypto.createHash("sha256").update(payload).digest("hex"));

    // Verify circuit breaker tripped
    expect(mediator.circuitBreaker.getState()).toBe("OPEN");

    // Subsequent write should fast-fail due to OPEN circuit breaker
    await expect(mediator.write("another/key", "data")).rejects.toThrow(/Circuit breaker is OPEN/);
  });
});