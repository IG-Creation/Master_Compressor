/**
 * Example: Submitting Compressed Form Records to Supabase
 */

import { compress } from "../src/index.js";
import { bufferToByteaHex, uploadCompressed } from "../src/supabase/index.js";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function submitFieldVisitForm(
  supabase: SupabaseClient,
  formData: {
    role: string;
    userCode: string;
    branchName: string;
    visitDate: string;
    photoBuffer: Buffer;
    nestedAuditLog: Record<string, unknown>;
  }
) {
  // 1. Upload high-res photo to Supabase Storage with lossless compression
  const photoUpload = await uploadCompressed(
    supabase,
    "visit-photos",
    `${formData.userCode}/${Date.now()}.llp1`,
    formData.photoBuffer
  );

  // 2. Compress nested JSON audit payload for database storage
  const auditJson = Buffer.from(JSON.stringify(formData.nestedAuditLog), "utf8");
  const compressedAudit = await compress(auditJson);

  // 3. Insert record into Postgres with filterable columns plain and payload compressed
  const { data, error } = await supabase.from("field_visits").insert({
    role: formData.role,
    user_code: formData.userCode,
    branch_name: formData.branchName,
    visit_date: formData.visitDate,
    photo_path: photoUpload.path,
    payload: bufferToByteaHex(compressedAudit),
    original_size: auditJson.length,
    compressed_size: compressedAudit.length
  });

  if (error) {
    throw new Error(`Failed to submit form: ${error.message}`);
  }

  return data;
}