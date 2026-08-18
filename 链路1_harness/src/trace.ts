import { mkdir, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TraceEvent } from "./domain.js";

export interface TraceStore {
  readonly path: string;
  append(event: TraceEvent): Promise<void>;
}

export class JsonlTraceStore implements TraceStore {
  readonly path: string;

  constructor(baseDirectory: string, runId: string) {
    this.path = join(baseDirectory, `${runId}.jsonl`);
  }

  async append(event: TraceEvent): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(redact(event))}\n`, "utf8");
  }
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/api.?key|authorization|secret|token/i.test(key)) output[key] = "[REDACTED]";
    else output[key] = redact(child);
  }
  return output;
}
