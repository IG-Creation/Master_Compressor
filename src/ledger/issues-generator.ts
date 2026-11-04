/**
 * losslesspack - ISSUES.md Generator
 * Generates human-readable, AI-actionable reports from the Failure Ledger.
 */

import { Incident } from "./types.js";

export function generateIssuesMarkdown(incidents: Incident[]): string {
  if (incidents.length === 0) {
    return `# Losslesspack Operational Incident Tracker\n\n_No incidents recorded. All storage operations healthy._\n`;
  }

  // Group by errorCode
  const groups = new Map<string, Incident[]>();
  for (const inc of incidents) {
    const list = groups.get(inc.errorCode) || [];
    list.push(inc);
    groups.set(inc.errorCode, list);
  }

  const lines: string[] = [
    "# Losslesspack Operational Incident Tracker",
    "",
    `> **Total Incidents Recorded:** ${incidents.length} | **Unique Failure Modes:** ${groups.size} | **Generated At:** ${new Date().toISOString()}`,
    "",
    "This document is automatically generated from `reports/failures.jsonl`. It aggregates all runtime anomalies, verification mismatches, and adapter faults with copy-paste AI diagnostic prompts.",
    "",
    "---",
    ""
  ];

  // Sort groups by count descending
  const sortedCodes = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);

  for (const [code, items] of sortedCodes) {
    const count = items.length;
    const severities = Array.from(new Set(items.map((i) => i.severity))).join(", ");
    const adapters = Array.from(new Set(items.map((i) => i.adapterName || "core"))).join(", ");
    const sortedByDate = [...items].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const firstSeen = sortedByDate[0].timestamp;
    const lastSeen = sortedByDate[sortedByDate.length - 1].timestamp;
    const latest = sortedByDate[sortedByDate.length - 1];

    lines.push(`## ${code} (${count} occurrences)`);
    lines.push("");
    lines.push(`- **Severity:** \`${severities}\``);
    lines.push(`- **Affected Adapters:** \`${adapters}\``);
    lines.push(`- **First Seen:** ${firstSeen}`);
    lines.push(`- **Last Seen:** ${lastSeen}`);
    lines.push(`- **Latest Incident ID:** \`${latest.id}\``);
    lines.push(`- **Suggested Next Step:** ${latest.suggestedNextStep}`);
    lines.push("");
    lines.push("### Latest Incident Details");
    lines.push("```json");
    lines.push(
      JSON.stringify(
        {
          id: latest.id,
          timestamp: latest.timestamp,
          component: latest.component,
          adapter: latest.adapterName,
          keyOrId: latest.keyOrId,
          originalSize: latest.originalSize,
          storedSize: latest.storedSize,
          originalSha256: latest.originalSha256,
          storedSha256: latest.storedSha256,
          message: latest.message
        },
        null,
        2
      )
    );
    lines.push("```");
    lines.push("");

    if (latest.stackTrace) {
      lines.push("<details>");
      lines.push("<summary>Sanitized Stack Trace</summary>");
      lines.push("");
      lines.push("```");
      lines.push(latest.stackTrace.slice(0, 1000));
      lines.push("```");
      lines.push("</details>");
      lines.push("");
    }

    lines.push("### PROMPT FOR AI FIX");
    lines.push("```markdown");
    lines.push(`You are a senior systems engineer. An operational failure occurred in losslesspack:`);
    lines.push(`- Incident ID: ${latest.id}`);
    lines.push(`- Error Code: ${latest.errorCode}`);
    lines.push(`- Component: ${latest.component}`);
    lines.push(`- Affected Adapter: ${latest.adapterName || "core"}`);
    lines.push(`- Message: ${latest.message}`);
    lines.push(`- Suggested Next Step: ${latest.suggestedNextStep}`);
    lines.push(``);
    lines.push(`Task: diagnose the root cause, write a failing test that reproduces it, fix it, run the full test suite, and update CHANGELOG.`);
    lines.push("```");
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}