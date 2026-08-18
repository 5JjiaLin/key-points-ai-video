import assert from "node:assert/strict";
import test from "node:test";
import { WanImageClient } from "../image/client.js";

interface DashScopeRequestBody {
  model?: string;
  input?: {
    messages?: Array<{ role?: string; content?: Array<{ text?: string }> }>;
  };
  parameters?: {
    size?: string;
    n?: number;
    watermark?: boolean;
    thinking_mode?: boolean;
  };
}

function createClient(): WanImageClient {
  return new WanImageClient({
    apiKey: "test-key",
    endpoint: "https://example.test/api/v1/services/aigc/multimodal-generation/generation",
    model: "wan2.7-image-pro",
    timeoutMs: 1000,
    maxRetries: 0,
  });
}

async function captureRequest(
  action: (client: WanImageClient) => Promise<unknown>,
): Promise<DashScopeRequestBody> {
  const originalFetch = globalThis.fetch;
  let requestBody: DashScopeRequestBody | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as DashScopeRequestBody;
    return new Response(JSON.stringify({
      output: { choices: [{ message: { content: [{ image: "https://example.test/image.png" }] } }] },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await action(createClient());
    assert.ok(requestBody);
    return requestBody;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("full-card request uses Wan 2.7 Pro with the 2K 16:9 contract", async () => {
  const requestBody = await captureRequest((client) =>
    client.generateFullCard("card prompt", { size: "2K", ratio: "16:9" }));

  assert.equal(requestBody.model, "wan2.7-image-pro");
  assert.deepEqual(requestBody.input?.messages, [
    { role: "user", content: [{ text: "card prompt" }] },
  ]);
  assert.deepEqual(requestBody.parameters, {
    size: "2560*1440",
    n: 1,
    watermark: false,
    thinking_mode: true,
  });
});

test("hint-sticker request uses the 2K square image contract", async () => {
  const requestBody = await captureRequest((client) =>
    client.generateHintSticker("sticker prompt", { size: "2K", ratio: "1:1" }));

  assert.equal(requestBody.model, "wan2.7-image-pro");
  assert.equal(requestBody.parameters?.size, "2048*2048");
});
