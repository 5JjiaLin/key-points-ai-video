export interface AgnesConfig {
  apiKey: string;
  endpoint: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
}

export interface AgnesGeneratedImage {
  source: "url" | "base64";
  url?: string;
  base64?: string;
  model: string;
}

export function loadAgnesConfig(): AgnesConfig {
  const apiKey = process.env.AGNES_API_KEY?.trim();
  if (!apiKey) throw new Error("Missing server-side AGNES_API_KEY");
  return {
    apiKey,
    endpoint:
      process.env.AGNES_IMAGE_ENDPOINT?.trim() ??
      "https://apihub.agnes-ai.com/v1/images/generations",
    model: process.env.AGNES_IMAGE_MODEL?.trim() ?? "agnes-image-2.1-flash",
    timeoutMs: Number(process.env.AGNES_IMAGE_TIMEOUT_MS ?? 180000),
    maxRetries: Number(process.env.AGNES_IMAGE_MAX_RETRIES ?? 2),
  };
}

export class AgnesImageClient {
  constructor(private readonly config: AgnesConfig) {}

  async generateFullCard(prompt: string): Promise<AgnesGeneratedImage> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await fetch(this.config.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.config.model,
            prompt,
            size: "1K",
            ratio: "16:9",
            extra_body: { response_format: "url" },
          }),
          signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          if (!retryable || attempt === this.config.maxRetries) {
            throw new Error(`Agnes HTTP ${response.status}: ${text.slice(0, 400)}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
          continue;
        }
        const payload = JSON.parse(text) as {
          data?: Array<{ url?: string | null; b64_json?: string | null }>;
        };
        const item = payload.data?.[0];
        if (item?.url) return { source: "url", url: item.url, model: this.config.model };
        if (item?.b64_json) {
          return { source: "base64", base64: item.b64_json, model: this.config.model };
        }
        throw new Error("Agnes response contained no image");
      } catch (error) {
        lastError = error;
        if (attempt === this.config.maxRetries) throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Unknown Agnes error");
  }
}
