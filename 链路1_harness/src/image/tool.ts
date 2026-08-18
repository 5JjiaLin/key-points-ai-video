import type { Chain1HarnessConfig } from "../config.js";
import type {
  GeneratedCardAsset,
  UnifiedSupplementCandidate,
} from "../domain.js";
import { AgnesImageClient, loadAgnesConfig } from "./client.js";
import type { CardAssetStore } from "./asset-store.js";

export interface FullCardImageTool {
  generate(args: {
    runId: string;
    candidate: UnifiedSupplementCandidate;
    attempt: number;
    correction?: string;
  }): Promise<GeneratedCardAsset>;
}

export class AgnesFullCardImageTool implements FullCardImageTool {
  constructor(
    private readonly config: Chain1HarnessConfig,
    private readonly store: CardAssetStore,
  ) {}

  async generate(args: {
    runId: string;
    candidate: UnifiedSupplementCandidate;
    attempt: number;
    correction?: string;
  }): Promise<GeneratedCardAsset> {
    if (args.candidate.route === "claim_verification") {
      throw new Error("Claim verification must not call the image model");
    }
    const basePrompt = args.candidate.visual.fullCardPrompt?.trim();
    if (!basePrompt) throw new Error("Missing full-card image prompt");
    const correction = args.correction
      ? `\n\n上一次图片审核失败，必须修正：${args.correction}`
      : "";
    const prompt = `${basePrompt}${correction}\n\n最终图片必须是完整卡片，包含规定的少量中文文字。重要文字放在中心安全区，便于从16:9裁切为310×180。不得出现水印、乱码、额外文案或手机外框。`;
    const generated = await new AgnesImageClient(loadAgnesConfig()).generateFullCard(prompt);
    return this.store.persist({
      runId: args.runId,
      candidateId: args.candidate.id,
      generated,
      attempt: args.attempt,
    });
  }
}

export class DisabledImageTool implements FullCardImageTool {
  async generate(): Promise<GeneratedCardAsset> {
    throw new Error("Image generation is disabled");
  }
}
