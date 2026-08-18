export interface WanImageConfig {
  apiKey: string;
  endpoint: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
}

export interface GeneratedImage {
  source: "url" | "base64";
  url?: string;
  base64?: string;
  model: string;
}

export interface ImageRequestConfig {
  size: "2K";
  ratio: "16:9" | "1:1";
}

export function loadWanImageConfig(): WanImageConfig {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) throw new Error("Missing server-side DASHSCOPE_API_KEY");
  return {
    apiKey,
    endpoint:
      process.env.DASHSCOPE_IMAGE_ENDPOINT?.trim() ??
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
    model: process.env.DASHSCOPE_IMAGE_MODEL?.trim() ?? "qwen-image",
    timeoutMs: Number(process.env.DASHSCOPE_IMAGE_TIMEOUT_MS ?? 180000),
    maxRetries: Number(process.env.DASHSCOPE_IMAGE_MAX_RETRIES ?? 2),
  };
}

export class WanImageClient {
  constructor(private readonly config: WanImageConfig) {}

  async generateFullCard(
    prompt: string,
    request: ImageRequestConfig = { size: "2K", ratio: "16:9" },
  ): Promise<GeneratedImage> {
    return this.generate(prompt, request);
  }

  async generateHintSticker(
    prompt: string,
    request: ImageRequestConfig = { size: "2K", ratio: "1:1" },
  ): Promise<GeneratedImage> {
    return this.generate(prompt, request);
  }

  private usesText2ImageApi(): boolean {
    // qwen-image / wan*-t2i* 走 DashScope 异步 text2image/image-synthesis 接口。
    return (
      this.config.endpoint.includes("text2image")
      || /qwen-image|t2i/i.test(this.config.model)
    );
  }

  private async generate(
    prompt: string,
    request: ImageRequestConfig,
  ): Promise<GeneratedImage> {
    if (this.usesText2ImageApi()) {
      return this.generateViaText2Image(prompt, request);
    }
    return this.generateViaMultimodal(prompt, request);
  }

  private async generateViaMultimodal(
    prompt: string,
    request: ImageRequestConfig,
  ): Promise<GeneratedImage> {
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
            input: {
              messages: [{ role: "user", content: [{ text: prompt }] }],
            },
            parameters: {
              size: request.ratio === "16:9" ? "2560*1440" : "2048*2048",
              n: 1,
              watermark: false,
              thinking_mode: true,
            },
          }),
          signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          if (!retryable || attempt === this.config.maxRetries) {
            throw new Error(`DashScope HTTP ${response.status}: ${text.slice(0, 400)}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
          continue;
        }
        const payload = JSON.parse(text) as {
          output?: {
            choices?: Array<{
              message?: { content?: Array<{ image?: string; url?: string }> };
            }>;
          };
        };
        const item = payload.output?.choices?.[0]?.message?.content?.find(
          (content) => content.image || content.url,
        );
        const url = item?.image ?? item?.url;
        if (url) return { source: "url", url, model: this.config.model };
        throw new Error("DashScope response contained no image");
      } catch (error) {
        lastError = error;
        if (attempt === this.config.maxRetries) throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Unknown DashScope error");
  }

  private async generateViaText2Image(
    prompt: string,
    request: ImageRequestConfig,
  ): Promise<GeneratedImage> {
    const submitEndpoint =
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis";
    const size = request.ratio === "16:9" ? "1664*928" : "1024*1024";
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const submit = await fetch(submitEndpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
          },
          body: JSON.stringify({
            model: this.config.model,
            input: { prompt },
            parameters: { size, n: 1, prompt_extend: true, watermark: false },
          }),
          signal: controller.signal,
        });
        const submitText = await submit.text();
        if (!submit.ok) {
          const retryable = submit.status === 429 || submit.status >= 500;
          if (!retryable || attempt === this.config.maxRetries) {
            throw new Error(`DashScope HTTP ${submit.status}: ${submitText.slice(0, 400)}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
          continue;
        }
        const taskId = (JSON.parse(submitText) as { output?: { task_id?: string } })
          .output?.task_id;
        if (!taskId) throw new Error("DashScope text2image returned no task_id");
        const url = await this.pollText2ImageTask(taskId, controller.signal);
        if (url) return { source: "url", url, model: this.config.model };
        throw new Error("DashScope text2image contained no image");
      } catch (error) {
        lastError = error;
        if (attempt === this.config.maxRetries) throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Unknown DashScope error");
  }

  private async pollText2ImageTask(
    taskId: string,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    const taskEndpoint = `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`;
    const deadline = Date.now() + this.config.timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const response = await fetch(taskEndpoint, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        signal,
      });
      const text = await response.text();
      if (!response.ok) continue;
      const payload = JSON.parse(text) as {
        output?: {
          task_status?: string;
          results?: Array<{ url?: string }>;
        };
      };
      const status = payload.output?.task_status;
      if (status === "SUCCEEDED") {
        return payload.output?.results?.find((item) => item.url)?.url;
      }
      if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
        throw new Error(`DashScope text2image task ${status}: ${text.slice(0, 300)}`);
      }
    }
    throw new Error("DashScope text2image task timed out");
  }
}
