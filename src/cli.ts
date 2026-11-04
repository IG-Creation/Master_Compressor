/**
 * losslesspack - CLI Interface
 * Supports compress, decompress, verify, info, and bench with stdin/stdout piping.
 */

import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { compress, decompress, inspectContainer } from "./index.js";
import { AlgorithmId } from "./format.js";
import { isZstdAvailable } from "./algorithms/zstd.js";

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function getAlgorithmName(id: AlgorithmId): string {
  switch (id) {
    case AlgorithmId.STORE: return "store";
    case AlgorithmId.GZIP: return "gzip";
    case AlgorithmId.BROTLI: return "brotli";
    case AlgorithmId.ZSTD: return "zstd";
    case AlgorithmId.ZSTD_DICT: return "zstd-dict";
    default: return "unknown(" + id + ")";
  }
}

export async function runCli(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    console.error([
      "Usage: losslesspack <command> [options]",
      "",
      "Commands:",
      "  compress <in> <out>     Compress file or stdin (-) to container",
      "  decompress <in> <out>   Decompress container to destination or stdout (-)",
      "  verify <file>           Verify integrity and SHA-256 of container",
      "  info <file>             Inspect and display container header metadata",
      "  bench [path]            Run benchmark on target file or synthetic dataset"
    ].join("\n"));
    return command ? 0 : 1;
  }

  try {
    if (command === "compress") {
      const inPath = args[1];
      const outPath = args[2];
      if (!inPath || !outPath) {
        console.error("Error: Missing input or output argument. Usage: losslesspack compress <in> <out>");
        return 1;
      }

      const inputBuf = inPath === "-" ? await readStream(process.stdin) : await fsp.readFile(path.resolve(inPath));
      const compressed = await compress(inputBuf);

      if (outPath === "-") {
        process.stdout.write(compressed);
      } else {
        await fsp.writeFile(path.resolve(outPath), compressed);
        const ratio = ((inputBuf.length - compressed.length) / (inputBuf.length || 1) * 100).toFixed(1);
        console.error("Compressed " + inPath + " -> " + outPath + " (" + inputBuf.length + " -> " + compressed.length + " bytes, saved " + ratio + "%)");
      }
      return 0;
    }

    if (command === "decompress") {
      const inPath = args[1];
      const outPath = args[2];
      if (!inPath || !outPath) {
        console.error("Error: Missing input or output argument. Usage: losslesspack decompress <in> <out>");
        return 1;
      }

      const inputBuf = inPath === "-" ? await readStream(process.stdin) : await fsp.readFile(path.resolve(inPath));
      const decompressed = await decompress(inputBuf);

      if (outPath === "-") {
        process.stdout.write(decompressed);
      } else {
        await fsp.writeFile(path.resolve(outPath), decompressed);
        console.error("Decompressed " + inPath + " -> " + outPath + " (" + decompressed.length + " bytes verified)");
      }
      return 0;
    }

    if (command === "verify") {
      const targetPath = args[1];
      if (!targetPath) {
        console.error("Error: Missing file path. Usage: losslesspack verify <file>");
        return 1;
      }

      const buf = await fsp.readFile(path.resolve(targetPath));
      const header = inspectContainer(buf);
      await decompress(buf);

      console.log("VERIFIED: " + targetPath);
      console.log("  Format Version    : " + header.version);
      console.log("  Algorithm         : " + getAlgorithmName(header.algorithmId));
      console.log("  Original Size     : " + header.originalLength.toString() + " bytes");
      console.log("  Container Size    : " + buf.length + " bytes");
      console.log("  SHA-256 Checksum  : " + header.sha256.toString("hex"));
      console.log("  Header CRC32      : 0x" + header.crc32.toString(16).padStart(8, "0"));
      console.log("  Status            : 100% BIT-PERFECT LOSSLESS MATCH");
      return 0;
    }

    if (command === "info") {
      const targetPath = args[1];
      if (!targetPath) {
        console.error("Error: Missing file path. Usage: losslesspack info <file>");
        return 1;
      }

      const buf = await fsp.readFile(path.resolve(targetPath));
      const header = inspectContainer(buf);

      console.log("LLP1 Container Info: " + targetPath);
      console.log("  Magic             : " + header.magic);
      console.log("  Version           : " + header.version);
      console.log("  Algorithm ID      : " + header.algorithmId + " (" + getAlgorithmName(header.algorithmId) + ")");
      console.log("  Flags             : 0x" + header.flags.toString(16).padStart(2, "0"));
      console.log("  Dictionary ID     : " + header.dictionaryId);
      console.log("  Original Length   : " + header.originalLength.toString() + " bytes");
      console.log("  SHA-256 Digest    : " + header.sha256.toString("hex"));
      console.log("  Header CRC32      : 0x" + header.crc32.toString(16).padStart(8, "0"));
      return 0;
    }

    if (command === "bench") {
      const targetPath = args[1];
      let data: Buffer;
      if (targetPath && fs.existsSync(targetPath)) {
        data = await fsp.readFile(path.resolve(targetPath));
      } else {
        const sample = {
          service: "telemetry-worker",
          cluster: "us-east-1",
          logs: Array.from({ length: 500 }, (_, i) => ({
            id: i,
            timestamp: Date.now() + i * 1000,
            event: "HTTP_TRANSACTION",
            status: 200,
            meta: { endpoint: "/api/v1/records", latency_ms: (Math.random() * 20).toFixed(2) }
          }))
        };
        data = Buffer.from(JSON.stringify(sample), "utf8");
      }

      console.log("=".repeat(75));
      console.log("LOSSLESSPACK BENCHMARK - Input Size: " + data.length.toLocaleString() + " bytes");
      console.log("=".repeat(75));
      console.log("Algorithm".padEnd(12) + " | " + "Comp Size".padEnd(12) + " | " + "Savings".padEnd(10) + " | " + "Comp (ms)".padEnd(12) + " | " + "Decomp (ms)".padEnd(12) + " | Integrity");
      console.log("-".repeat(75));

      const algos = ["store", "gzip", "brotli"] as const;
      const allAlgos: Array<"store" | "gzip" | "brotli" | "zstd"> = isZstdAvailable()
        ? [...algos, "zstd"]
        : [...algos];

      for (const algo of allAlgos) {
        const t0 = performance.now();
        const compressed = await compress(data, { algorithm: algo, verify: false });
        const compTime = performance.now() - t0;

        const t1 = performance.now();
        const decompressed = await decompress(compressed);
        const decompTime = performance.now() - t1;

        const isMatch = decompressed.equals(data);
        const saved = ((data.length - compressed.length) / (data.length || 1) * 100).toFixed(1);

        console.log(
          algo.padEnd(12) + " | " +
          (compressed.length.toLocaleString() + " B").padEnd(12) + " | " +
          (saved + "%").padEnd(10) + " | " +
          (compTime.toFixed(2) + " ms").padEnd(12) + " | " +
          (decompTime.toFixed(2) + " ms").padEnd(12) + " | " +
          (isMatch ? "✅ MATCH" : "❌ CORRUPT")
        );
      }
      console.log("=".repeat(75));
      return 0;
    }

    console.error("Unknown command: " + command);
    return 1;
  } catch (err) {
    console.error("LosslessPack Error:", err instanceof Error ? err.message : String(err));
    return 1;
  }
}