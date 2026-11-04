/**
 * Example: Reading Compressed Records via Keyset Pagination for Analytics Dashboard
 */

import { readKeysetPaginated } from "../src/supabase/index.js";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function generateVisitAnalyticsReport(supabase: SupabaseClient) {
  console.log("Streaming records with constant memory usage...");
  let totalRecords = 0;
  let totalOriginalBytes = 0;
  let totalCompressedBytes = 0;

  // Uses keyset cursor pagination to stream millions of rows without loading all into RAM
  for await (const row of readKeysetPaginated(supabase, "field_visits", { pageSize: 1000 })) {
    totalRecords++;
    totalOriginalBytes += Number((row as any).original_size || 0);
    totalCompressedBytes += Number((row as any).compressed_size || 0);

    // Payload is automatically decompressed
    const auditPayload = (row as any).payload;
    if (totalRecords % 5000 === 0) {
      console.log(`Processed ${totalRecords} records. Latest sample:`, auditPayload);
    }
  }

  const spaceSavedPct = totalOriginalBytes > 0
    ? (((totalOriginalBytes - totalCompressedBytes) / totalOriginalBytes) * 100).toFixed(1)
    : "0";

  console.log(`Analytics Summary: ${totalRecords} records.`);
  console.log(`Storage Saved: ${spaceSavedPct}%`);
}