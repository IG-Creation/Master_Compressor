/**
 * losslesspack - Write-Ahead Journal (WAL)
 * Records in-flight writes before storage adapter execution to enable safe crash recovery.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { JournalEntry } from "./types.js";

export interface IWriteAheadJournal {
  beginWrite(entry: Omit<JournalEntry, "status" | "createdAt">): Promise<void>;
  commitWrite(id: string): Promise<void>;
  rollbackWrite(id: string): Promise<void>;
  getPending(): Promise<JournalEntry[]>;
  purge(maxAgeMs?: number): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryWriteAheadJournal implements IWriteAheadJournal {
  private readonly entries = new Map<string, JournalEntry>();

  async beginWrite(entry: Omit<JournalEntry, "status" | "createdAt">): Promise<void> {
    this.entries.set(entry.id, {
      ...entry,
      status: "pending",
      createdAt: Date.now()
    });
  }

  async commitWrite(id: string): Promise<void> {
    const item = this.entries.get(id);
    if (item) {
      item.status = "committed";
    }
  }

  async rollbackWrite(id: string): Promise<void> {
    const item = this.entries.get(id);
    if (item) {
      item.status = "rolled_back";
    }
  }

  async getPending(): Promise<JournalEntry[]> {
    return Array.from(this.entries.values()).filter((e) => e.status === "pending");
  }

  async purge(maxAgeMs = 86400000): Promise<void> {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, e] of this.entries.entries()) {
      if (e.status !== "pending" && e.createdAt < cutoff) {
        this.entries.delete(id);
      }
    }
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}

export class FilesystemWriteAheadJournal implements IWriteAheadJournal {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async beginWrite(entry: Omit<JournalEntry, "status" | "createdAt">): Promise<void> {
    await this.ensureDir();
    const fullEntry: JournalEntry = {
      ...entry,
      status: "pending",
      createdAt: Date.now()
    };
    const filePath = path.join(this.dir, `${entry.id}.journal.json`);
    const payloadPath = path.join(this.dir, `${entry.id}.payload.bin`);

    const json = {
      id: fullEntry.id,
      key: fullEntry.key,
      sha256: fullEntry.sha256,
      status: fullEntry.status,
      createdAt: fullEntry.createdAt,
      metadata: fullEntry.metadata
    };

    await fs.writeFile(filePath, JSON.stringify(json, null, 2), "utf8");
    if (fullEntry.compressedPayload) {
      await fs.writeFile(payloadPath, fullEntry.compressedPayload);
    }
  }

  async commitWrite(id: string): Promise<void> {
    const filePath = path.join(this.dir, `${id}.journal.json`);
    const payloadPath = path.join(this.dir, `${id}.payload.bin`);
    try {
      const data = await fs.readFile(filePath, "utf8");
      const entry: JournalEntry = JSON.parse(data);
      entry.status = "committed";
      await fs.writeFile(filePath, JSON.stringify(entry, null, 2), "utf8");
      // Payload can be removed once committed
      await fs.unlink(payloadPath).catch(() => {});
    } catch {
      // ignore
    }
  }

  async rollbackWrite(id: string): Promise<void> {
    const filePath = path.join(this.dir, `${id}.journal.json`);
    const payloadPath = path.join(this.dir, `${id}.payload.bin`);
    try {
      const data = await fs.readFile(filePath, "utf8");
      const entry: JournalEntry = JSON.parse(data);
      entry.status = "rolled_back";
      await fs.writeFile(filePath, JSON.stringify(entry, null, 2), "utf8");
      await fs.unlink(payloadPath).catch(() => {});
    } catch {
      // ignore
    }
  }

  async getPending(): Promise<JournalEntry[]> {
    await this.ensureDir();
    const files = await fs.readdir(this.dir);
    const journalFiles = files.filter((f) => f.endsWith(".journal.json"));
    const pending: JournalEntry[] = [];

    for (const f of journalFiles) {
      const id = f.replace(".journal.json", "");
      try {
        const data = await fs.readFile(path.join(this.dir, f), "utf8");
        const entry: JournalEntry = JSON.parse(data);
        if (entry.status === "pending") {
          const payloadPath = path.join(this.dir, `${id}.payload.bin`);
          try {
            entry.compressedPayload = await fs.readFile(payloadPath);
          } catch {
            // payload might not exist
          }
          pending.push(entry);
        }
      } catch {
        // ignore corrupt journal file
      }
    }

    return pending;
  }

  async purge(maxAgeMs = 86400000): Promise<void> {
    await this.ensureDir();
    const cutoff = Date.now() - maxAgeMs;
    const files = await fs.readdir(this.dir);
    for (const f of files) {
      if (f.endsWith(".journal.json")) {
        const fullPath = path.join(this.dir, f);
        try {
          const content = await fs.readFile(fullPath, "utf8");
          const entry: JournalEntry = JSON.parse(content);
          if (entry.status !== "pending" && entry.createdAt < cutoff) {
            await fs.unlink(fullPath).catch(() => {});
            await fs.unlink(path.join(this.dir, `${entry.id}.payload.bin`)).catch(() => {});
          }
        } catch {
          // ignore
        }
      }
    }
  }

  async clear(): Promise<void> {
    await this.ensureDir();
    const files = await fs.readdir(this.dir);
    for (const f of files) {
      await fs.unlink(path.join(this.dir, f)).catch(() => {});
    }
  }
}