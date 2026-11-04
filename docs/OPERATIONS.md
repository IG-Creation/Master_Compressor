# losslesspack - Production Operations & Runbook

This guide covers operational maintenance, automated scrubs, incident ledger monitoring, quarantine recovery, and crash safety.

---

## 1. Running Storage Audits & Data Scrubs

Storage bit rot, premature connection drops, or driver bugs can silently compromise databases over time. The `losslesspack audit` CLI scrubs stored records and verifies LLP1 magic bytes, header CRC32, payload byte length, and SHA-256 hashes.

```bash
# Full audit across all records in the filesystem adapter
losslesspack audit --adapter filesystem

# Sampled audit (5% random sample) with rate limiting (50 records/sec)
losslesspack audit --adapter postgres --sample 5% --rate 50 --prefix "users/"

# Resume audit from a saved cursor
losslesspack audit --adapter s3 --cursor "page_cursor_token"
```

### Scheduled GitHub Actions Workflow Example
```yaml
name: Losslesspack Storage Scrub
on:
  schedule:
    - cron: '0 2 * * 0' # Weekly Sunday at 02:00 UTC
  workflow_dispatch:

jobs:
  scrub:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - name: Run Storage Audit
        run: npx losslesspack audit --adapter s3 --sample 10% --rate 100
        env:
          AWS_REGION: us-east-1
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

---

## 2. Reading the Failure Ledger & `ISSUES.md`

`losslesspack` never discards an operational failure. Every failed write, quarantine event, or scrub anomaly is appended atomically to `reports/failures.jsonl` and summarized in `reports/ISSUES.md`.

### Strict Redaction Guarantee
- No credentials, passwords, JWT tokens, or DB URIs ever appear in any report.
- Raw payload bytes are strictly stripped and replaced with `<REDACTED_BYTES length=N sha256=H>`.
- Verified by automated test suites.

### Generating Failure Reports & HTML Dashboards
```bash
# Print summary table in terminal
losslesspack report

# Export rich HTML dashboard
losslesspack report --html reports/dashboard.html
```

### AI-Driven Issue Remediation
Each section in `reports/ISSUES.md` ends with a ready-to-run prompt:
```markdown
### PROMPT FOR AI FIX
You are a senior systems engineer. An operational failure occurred in losslesspack:
- Incident ID: INC-20261105-a1b2c3
- Error Code: ERR_CHECKSUM_MISMATCH
- Component: mediator
- Affected Adapter: postgres
- Message: Checksum mismatch...
- Suggested Next Step: Investigate underlying disk/network controller...

Task: diagnose the root cause, write a failing test that reproduces it, fix it, run the full test suite, and update CHANGELOG.
```

---

## 3. Quarantine Store & Recovery Runbook

When write retries are exhausted, the mediator **never throws away the original user data**. Instead:
1. The original uncompressed payload is staged in the `QuarantineStore`.
2. An incident is logged to `reports/failures.jsonl`.
3. The error thrown attaches `quarantineId` and `quarantined: true`.

### Quarantine Inspection & Manual Re-Queueing
```typescript
import { FilesystemQuarantineStore } from "losslesspack/mediator";

const quarantine = new FilesystemQuarantineStore("./quarantine");
const items = await quarantine.list();

for (const item of items) {
  console.log(`Failed Key: ${item.key}, Reason: ${item.error}, Timestamp: ${item.failedAt}`);
  // Inspect original payload: item.payload
  // Retry writing through mediator:
  // await mediator.write(item.key, item.payload);
  // Once recovered, remove from quarantine:
  // await quarantine.remove(item.id);
}
```

---

## 4. Crash Recovery (Write-Ahead Journal / WAL)

The `LosslessMediator` writes an entry to the WAL before handing bytes to the underlying adapter. If a node crashes mid-write:
```typescript
const mediator = new LosslessMediator(adapter, options, journal, quarantine);

// Call on application startup or worker initialization:
const report = await mediator.recover();
console.log(`WAL Recovered: ${report.committed} committed, ${report.rolledBack} rolled back, ${report.quarantined} quarantined.`);
```
- If the adapter contains the correct SHA-256 data, the journal entry is committed immediately.
- If the adapter was not written or was corrupted, the mediator attempts to re-write from the WAL compressed payload.
- If unresolvable, the record is placed in quarantine to prevent data loss.