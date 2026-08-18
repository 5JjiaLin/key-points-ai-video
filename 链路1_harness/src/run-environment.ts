import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ArkJsonInvoker, loadArkInvokerConfig } from "./ark.js";
import { DEFAULT_CONFIG } from "./config.js";
import { loadVideoEnvironmentFile } from "./environment-file.js";
import { DisabledImageTool, WanChain1ImageTool } from "./image/tool.js";
import { LocalCardAssetStore } from "./image/asset-store.js";
import { Chain1Harness } from "./orchestrator.js";
import { PromptRouteClassifier } from "./router.js";
import { PromptSkillRunner } from "./skills.js";

function loadEnv(path: string): void {
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // Environment files are optional; deployment can provide process variables.
  }
}

async function main(): Promise<void> {
  const [environmentArg, outputArg] = process.argv.slice(2);
  if (!environmentArg || !outputArg) {
    throw new Error("Usage: run-environment <video_environment.v1.json> <output.json>");
  }
  loadEnv(resolve(".env"));
  loadEnv(resolve("..", ".env"));
  loadEnv(resolve("..", "链路2_harness", ".env"));
  const input = loadVideoEnvironmentFile(environmentArg);
  const baseArkConfig = loadArkInvokerConfig();
  const invoker = new ArkJsonInvoker(baseArkConfig);
  const routeInvoker = new ArkJsonInvoker({
    ...baseArkConfig,
    model: process.env.ARK_ROUTER_MODEL?.trim() || "doubao-seed-2-0-lite-260428",
    timeoutMs: Number(process.env.ARK_ROUTER_TIMEOUT_MS ?? 90000),
    maxRetries: Number(process.env.ARK_ROUTER_MAX_RETRIES ?? 1),
  });
  const verificationGuard = "\n不得伪造来源或文献。缺乏可核验证据时，必须输出证据不足或待复核。";
  const skills = {
    abstractToIntuitive: new PromptSkillRunner(
      invoker,
      readFileSync(resolve("skills/abstract-to-intuitive.skill.md"), "utf8"),
      "abstract-to-intuitive",
    ),
    knowledgeGap: new PromptSkillRunner(
      invoker,
      readFileSync(resolve("skills/knowledge-gap.skill.md"), "utf8"),
      "knowledge-gap",
    ),
    claimVerification: new PromptSkillRunner(
      invoker,
      readFileSync(resolve("skills/claim-verification.skill.md"), "utf8") + verificationGuard,
      "claim-verification",
    ),
  };
  const imageEnabled = Boolean(process.env.DASHSCOPE_API_KEY?.trim());
  const config = {
    ...DEFAULT_CONFIG,
    route: {
      ...DEFAULT_CONFIG.route,
      allowSecondaryRoute: process.env.CHAIN1_ALLOW_SECONDARY_ROUTE?.trim() !== "false",
    },
    image: {
      ...DEFAULT_CONFIG.image,
      enabled: imageEnabled,
      maxAttempts: positiveInteger(
        process.env.CHAIN1_IMAGE_MAX_ATTEMPTS,
        DEFAULT_CONFIG.image.maxAttempts,
      ),
      hintSticker: {
        ...DEFAULT_CONFIG.image.hintSticker,
        enabled: process.env.CHAIN1_HINT_STICKER_ENABLED?.trim() !== "false",
        maxAttempts: positiveInteger(
          process.env.CHAIN1_HINT_STICKER_MAX_ATTEMPTS,
          DEFAULT_CONFIG.image.hintSticker.maxAttempts,
        ),
      },
    },
  };
  const imageTool = imageEnabled
    ? new WanChain1ImageTool(config, new LocalCardAssetStore(config.assetDirectory))
    : new DisabledImageTool();
  const harness = new Chain1Harness({
    config,
    routeClassifier: new PromptRouteClassifier(routeInvoker),
    skills,
    imageTool,
    modelVersions: { ark: process.env.DOUBAO_MODEL ?? "configured" },
  });
  const result = await harness.run(input);
  writeFileSync(resolve(outputArg), JSON.stringify(result, null, 2) + "\n", "utf8");
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
