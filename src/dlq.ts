import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface DeadLetter { id: string; at: string; step: string; error: string; status?: number; payload: unknown }

/** Append-only JSONL dead-letter queue. Failed leads land here with the step and error, for replay. */
export class DeadLetterQueue {
  private mem: DeadLetter[] = [];
  constructor(private file?: string) { if (file) mkdirSync(dirname(file), { recursive: true }); }

  push(d: Omit<DeadLetter, "id" | "at">): DeadLetter {
    const item = { id: `dlq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString(), ...d };
    if (this.file) appendFileSync(this.file, JSON.stringify(item) + "\n"); else this.mem.push(item);
    return item;
  }

  list(): DeadLetter[] {
    if (!this.file) return [...this.mem];
    return existsSync(this.file) ? readFileSync(this.file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  }

  /** Removes and returns all items (caller re-processes them; failures are re-queued). */
  drain(): DeadLetter[] {
    const items = this.list();
    if (this.file) writeFileSync(this.file, ""); else this.mem = [];
    return items;
  }
}
