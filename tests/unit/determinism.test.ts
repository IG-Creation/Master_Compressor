import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { compress, decompress, inspectContainer } from "../../src/index.js";

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/golden-v1.llp1");
const GOLDEN_ORIGINAL_TEXT = "Golden fixture version 1 text for backward compatibility verification.\n";

describe("Section D: Determinism & Cross-Version Compatibility", () => {
  beforeAll(async () => {
    // Generate golden fixture if not present
    if (!fs.existsSync(FIXTURE_PATH)) {
      const origBuf = Buffer.from(GOLDEN_ORIGINAL_TEXT, "utf8");
      const comp = await compress(origBuf, { algorithm: "store" });
      await fsp.writeFile(FIXTURE_PATH, comp);
    }
  });

  it("produces byte-identical output for identical inputs and options", async () => {
    const input = Buffer.from("Deterministic compression test string 1234567890", "utf8");
    const out1 = await compress(input, { algorithm: "gzip", level: 6 });
    const out2 = await compress(input, { algorithm: "gzip", level: 6 });

    expect(out1.equals(out2)).toBe(true);
  });

  it("successfully decompresses version-1 golden fixture file", async () => {
    const fixtureBuf = await fsp.readFile(FIXTURE_PATH);
    const header = inspectContainer(fixtureBuf);

    expect(header.magic).toBe("LLP1");
    expect(header.version).toBe(1);

    const decompressed = await decompress(fixtureBuf);
    expect(decompressed.toString("utf8")).toBe(GOLDEN_ORIGINAL_TEXT);
  });
});