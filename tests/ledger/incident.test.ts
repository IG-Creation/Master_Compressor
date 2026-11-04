import { describe, it, expect, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { FailureLedger } from "../../src/ledger/ledger.js";
import { assertRedacted, sanitizeObject } from "../../src/ledger/redact.js";

describe("Failure Ledger & Redaction Guarantees", () => {
  const tmpDir = path.join(os.tmpdir(), `llp_ledger_test_${Date.now()}`);
  const jsonlPath = path.join(tmpDir, "failures.jsonl");
  const mdPath = path.join(tmpDir, "ISSUES.md");

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("strictly redacts passwords, connection strings, bearer tokens, and raw bytes", async () => {
    const rawSecretPassword = "SuperSecretDbPassword123!";
    const rawJwtToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisSignature";
    const rawPayloadBytes = Buffer.from("CRITICAL_USER_PII_DATA_CONFIDENTIAL_12345");

    const ledger = new FailureLedger({
      filePath: jsonlPath,
      markdownPath: mdPath
    });

    const incident = await ledger.record({
      errorCode: "ERR_CHECKSUM_MISMATCH",
      component: "mediator",
      adapterName: "postgres",
      message: `Failed connecting with postgres://app_user:${rawSecretPassword}@prod-db.internal:5432/main`,
      keyOrId: "user/42",
      optionsUsed: {
        token: rawJwtToken,
        apiKey: "sk-proj-999888777666",
        bufferPayload: rawPayloadBytes
      },
      originalSize: rawPayloadBytes.length,
      originalSha256: "abcdef1234567890",
      suggestedNextStep: "Check replica lag"
    });

    expect(incident.id).toMatch(/^INC-/);

    // Read generated JSONL and Markdown
    const jsonlContent = await fs.readFile(jsonlPath, "utf8");
    const mdContent = await fs.readFile(mdPath, "utf8");

    // Assert that NONE of the raw secrets or payload bytes appear anywhere
    const forbidden = [
      rawSecretPassword,
      rawJwtToken,
      "CRITICAL_USER_PII_DATA_CONFIDENTIAL_12345",
      "sk-proj-999888777666"
    ];

    assertRedacted(jsonlContent, forbidden);
    assertRedacted(mdContent, forbidden);

    // Verify ISSUES.md structure and PROMPT FOR AI FIX
    expect(mdContent).toContain("### PROMPT FOR AI FIX");
    expect(mdContent).toContain("diagnose the root cause, write a failing test that reproduces it, fix it");
    expect(mdContent).toContain("ERR_CHECKSUM_MISMATCH");
  });

  it("rotates log file when size exceeds maxSizeBytes", async () => {
    const ledger = new FailureLedger({
      filePath: jsonlPath,
      markdownPath: mdPath,
      maxSizeBytes: 1024, // 1 KB rotation threshold for test
      autoRegenerateMarkdown: false
    });

    // Record enough incidents to exceed 1 KB
    for (let i = 0; i < 15; i++) {
      await ledger.record({
        errorCode: `ERR_TEST_${i}`,
        message: `Repeated failure test message ${i}`
      });
    }

    const stat = await fs.stat(jsonlPath);
    expect(stat.size).toBeLessThan(1024 * 3);

    // Rotated file should exist
    const rotatedFileExists = await fs.access(`${jsonlPath}.1`).then(() => true).catch(() => false);
    expect(rotatedFileExists).toBe(true);
  });
});