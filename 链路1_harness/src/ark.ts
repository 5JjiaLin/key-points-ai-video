import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { JsonInvoker } from "./router.js";

export interface ArkInvokerConfig {
  apiKey: string;
  endpoint: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  temperature: number;
}

export function loadArkInvokerConfig(): ArkInvokerConfig {
  const apiKey = process.env.ARK_API_KEY?.trim() ?? process.env.DOUBAO_API_KEY?.trim();
  if (!apiKey) throw new Error("Missing server-side ARK_API_KEY");
  return {
    apiKey,
    endpoint: process.env.DOUBAO_ENDPOINT?.trim() ?? "https://ark.cn-beijing.volces.com/api/v3/responses",
    model: process.env.DOUBAO_MODEL?.trim() ?? "doubao-seed-2-1-pro-260628",
    timeoutMs: Number(process.env.ARK_TIMEOUT_MS ?? 180000),
    maxRetries: Number(process.env.ARK_MAX_RETRIES ?? 2),
    temperature: Number(process.env.ARK_TEMPERATURE ?? 0),
  };
}

export class ArkJsonInvoker implements JsonInvoker {
  constructor(private readonly config: ArkInvokerConfig = loadArkInvokerConfig()) {}

  async invokeJson<T>(args: {
    systemPrompt: string;
    input: unknown;
    schemaName: string;
    imagePaths?: string[];
  }): Promise<T> {
    const bridge = resolve(process.cwd(), "src", "ark_bridge.py");
    const pythonExecutable = process.env.CHAIN1_PYTHON?.trim() || "python3";
    const result = spawnSync(pythonExecutable, [bridge], {
      input: JSON.stringify({
        endpoint: this.config.endpoint,
        model: this.config.model,
        timeoutSeconds: this.config.timeoutMs / 1000,
        maxRetries: this.config.maxRetries,
        temperature: this.config.temperature,
        systemPrompt: args.systemPrompt,
        schemaName: args.schemaName,
        input: args.input,
        imagePaths: [...new Set(args.imagePaths ?? [])].slice(0, 4),
      }),
      encoding: "utf8",
      env: { ...process.env, ARK_API_KEY: this.config.apiKey },
      timeout: (this.config.maxRetries + 1) * this.config.timeoutMs + 30000,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || "Ark bridge failed").trim().slice(-800));
    }
    return parseJsonContent<T>(result.stdout);
  }
}

function parseJsonContent<T>(value: string): T {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed) as T;
}
