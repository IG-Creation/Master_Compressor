/**
 * losslesspack - Supabase / Postgres bytea Hex Encoding Helper
 * PostgREST communicates binary data through PostgreSQL bytea columns
 * using the standard hex format prefixed with "\x".
 */

/**
 * Converts a binary Buffer into a PostgreSQL bytea hex string ("\x...").
 */
export function bufferToByteaHex(buf: Buffer | Uint8Array): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return "\\x" + b.toString("hex");
}

/**
 * Parses a PostgreSQL bytea hex string ("\x...") into a binary Buffer.
 */
export function byteaHexToBuffer(hexStr: string): Buffer {
  if (typeof hexStr !== "string") {
    throw new TypeError(`Expected string for bytea hex, received ${typeof hexStr}`);
  }
  let clean = hexStr;
  if (clean.startsWith("\\x") || clean.startsWith("\\X")) {
    clean = clean.slice(2);
  } else if (clean.startsWith("0x") || clean.startsWith("0X")) {
    clean = clean.slice(2);
  }
  return Buffer.from(clean, "hex");
}
