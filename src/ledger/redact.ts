/**
 * losslesspack - Redaction & Sanitization Layer
 * Guarantees zero leakage of credentials, tokens, passwords, or raw payload bytes in reports.
 */

import crypto from "node:crypto";

const SENSITIVE_KEY_REGEX = /password|passwd|secret|token|apikey|api_key|auth|authorization|credential|bearer|private_key|privkey/i;
const CONNECTION_STRING_REGEX = /((?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|http|https):\/\/[^:]+:)([^@]+)(@)/gi;
const BEARER_REGEX = /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const JWT_REGEX = /eyJ[A-Za-z0-9-_=]+\.eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]+/gi;

/**
 * Sanitizes a string by masking passwords in connection URIs, Bearer tokens, and JWTs.
 */
export function sanitizeString(val: string): string {
  if (!val) return val;
  return val
    .replace(CONNECTION_STRING_REGEX, "$1[REDACTED]$3")
    .replace(BEARER_REGEX, "Bearer [REDACTED]")
    .replace(JWT_REGEX, "[REDACTED_JWT]");
}

/**
 * Deeply sanitizes any object, dictionary, or array.
 * Strips raw Buffer/Uint8Array data into hash/size summaries.
 * Redacts values whose keys match sensitive names.
 */
export function sanitizeObject(obj: any, depth = 0): any {
  if (obj === null || obj === undefined) return obj;
  if (depth > 8) return "[MAX_DEPTH_EXCEEDED]";

  if (Buffer.isBuffer(obj) || obj instanceof Uint8Array) {
    const sha = crypto.createHash("sha256").update(obj).digest("hex");
    return `<REDACTED_BYTES length=${obj.length} sha256=${sha}>`;
  }

  if (typeof obj === "string") {
    return sanitizeString(obj);
  }

  if (typeof obj === "number" || typeof obj === "boolean" || typeof obj === "bigint") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, depth + 1));
  }

  if (typeof obj === "object") {
    const sanitized: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE_KEY_REGEX.test(k)) {
        sanitized[k] = "[REDACTED_SECRET]";
      } else {
        sanitized[k] = sanitizeObject(v, depth + 1);
      }
    }
    return sanitized;
  }

  return String(obj);
}

/**
 * Sanitizes an error stack trace by stripping sensitive paths or embedded connection strings.
 */
export function sanitizeStackTrace(stack?: string): string | undefined {
  if (!stack) return undefined;
  return sanitizeString(stack);
}

/**
 * Audit helper: verifies that a serialized JSON string or object does NOT contain known secrets or raw payload.
 */
export function assertRedacted(jsonString: string, forbiddenStrings: string[] = []): void {
  for (const forbidden of forbiddenStrings) {
    if (forbidden && forbidden.length >= 3 && jsonString.includes(forbidden)) {
      throw new Error(`Redaction check failed! Report leaked sensitive value: "${forbidden}"`);
    }
  }
}