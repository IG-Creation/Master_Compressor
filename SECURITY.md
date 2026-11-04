# Security Policy

## Supported Versions

| Version | Supported          |
| :--- | :---: |
| 1.0.x   | :white_check_mark: |

## Security Guarantees & Defenses

1. **Decompression Bomb Protection:** Every container specifies an `originalLength` uint64 header. Decompression throws `SizeLimitExceededError` before memory is allocated if the size exceeds `maxDecompressedSize` (default: 1 GiB).
2. **Tamper Detection:** All containers include both an IEEE 802.3 header CRC32 and a cryptographic SHA-256 payload checksum. Any bit modification raises a typed error and rejects the payload.
3. **No Global State:** Pure, thread-safe, concurrent functions with zero mutable global variables.
4. **Zero Telemetry:** No network calls, telemetry, or analytics tracking.
5. **No Secret Logging:** Credentials and decrypted payload contents are never logged to console or errors.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it privately via GitHub Security Advisories or email security@ig-creation.com. All reports will be acknowledged within 24 hours.