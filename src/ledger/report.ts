/**
 * losslesspack - Operational Failure Report & HTML Dashboard
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Incident } from "./types.js";

export interface ReportSummary {
  totalIncidents: number;
  bySeverity: Record<string, number>;
  byErrorCode: Record<string, number>;
  byAdapter: Record<string, number>;
  recentTrends: Array<{ date: string; count: number }>;
}

export function summarizeIncidents(incidents: Incident[]): ReportSummary {
  const summary: ReportSummary = {
    totalIncidents: incidents.length,
    bySeverity: {},
    byErrorCode: {},
    byAdapter: {},
    recentTrends: []
  };

  const trendMap = new Map<string, number>();

  for (const inc of incidents) {
    summary.bySeverity[inc.severity] = (summary.bySeverity[inc.severity] || 0) + 1;
    summary.byErrorCode[inc.errorCode] = (summary.byErrorCode[inc.errorCode] || 0) + 1;
    const adp = inc.adapterName || "core";
    summary.byAdapter[adp] = (summary.byAdapter[adp] || 0) + 1;

    const day = inc.timestamp.slice(0, 10);
    trendMap.set(day, (trendMap.get(day) || 0) + 1);
  }

  summary.recentTrends = Array.from(trendMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return summary;
}

export function formatTextReport(incidents: Incident[]): string {
  const s = summarizeIncidents(incidents);
  const lines: string[] = [
    "==================================================",
    "       LOSSLESSPACK OPERATIONAL REPORT            ",
    "==================================================",
    `Total Incidents: ${s.totalIncidents}`,
    "",
    "--- Incidents by Severity ---"
  ];

  for (const [sev, count] of Object.entries(s.bySeverity)) {
    lines.push(`  ${sev.padEnd(10)}: ${count}`);
  }

  lines.push("", "--- Top Error Codes ---");
  for (const [code, count] of Object.entries(s.byErrorCode)) {
    lines.push(`  ${code.padEnd(25)}: ${count}`);
  }

  lines.push("", "--- By Storage Adapter ---");
  for (const [adp, count] of Object.entries(s.byAdapter)) {
    lines.push(`  ${adp.padEnd(20)}: ${count}`);
  }

  lines.push("==================================================");
  return lines.join("\n");
}

export async function exportHtmlReport(incidents: Incident[], outputPath: string): Promise<void> {
  const s = summarizeIncidents(incidents);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Losslesspack Incident Dashboard</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 2rem; }
    h1 { color: #38bdf8; margin-bottom: 0.5rem; }
    .card { background: #1e293b; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; border: 1px solid #334155; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; }
    .stat-val { font-size: 2rem; font-weight: bold; color: #38bdf8; }
    .stat-label { font-size: 0.875rem; color: #94a3b8; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid #334155; }
    th { color: #94a3b8; }
    .badge { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
    .badge-ERROR { background: #ef4444; color: #fff; }
    .badge-CRITICAL { background: #dc2626; color: #fff; }
    .badge-WARN { background: #f59e0b; color: #000; }
    .badge-INFO { background: #3b82f6; color: #fff; }
  </style>
</head>
<body>
  <h1>Losslesspack Failure Ledger Dashboard</h1>
  <p style="color: #94a3b8;">Generated on ${new Date().toISOString()}</p>
  
  <div class="grid">
    <div class="card">
      <div class="stat-label">Total Incidents</div>
      <div class="stat-val">${s.totalIncidents}</div>
    </div>
    <div class="card">
      <div class="stat-label">Critical Incidents</div>
      <div class="stat-val" style="color: #ef4444;">${s.bySeverity["CRITICAL"] || 0}</div>
    </div>
    <div class="card">
      <div class="stat-label">Errors</div>
      <div class="stat-val" style="color: #f87171;">${s.bySeverity["ERROR"] || 0}</div>
    </div>
    <div class="card">
      <div class="stat-label">Unique Error Codes</div>
      <div class="stat-val">${Object.keys(s.byErrorCode).length}</div>
    </div>
  </div>

  <div class="card">
    <h2>Recent Incidents</h2>
    <table>
      <thead>
        <tr>
          <th>Incident ID</th>
          <th>Timestamp</th>
          <th>Severity</th>
          <th>Error Code</th>
          <th>Adapter</th>
          <th>Message</th>
        </tr>
      </thead>
      <tbody>
        ${incidents
          .slice(-50)
          .reverse()
          .map(
            (i) => `
          <tr>
            <td><code>${i.id}</code></td>
            <td>${i.timestamp}</td>
            <td><span class="badge badge-${i.severity}">${i.severity}</span></td>
            <td><code>${i.errorCode}</code></td>
            <td>${i.adapterName || "core"}</td>
            <td>${i.message}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  </div>
</body>
</html>`;

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, html, "utf8");
}