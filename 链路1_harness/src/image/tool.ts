import type { Chain1HarnessConfig } from "../config.js";
import type {
  GeneratedCardAsset,
  UnifiedSupplementCandidate,
} from "../domain.js";
import { loadWanImageConfig, WanImageClient } from "./client.js";
import type { CardAssetStore } from "./asset-store.js";

export interface Chain1ImageTool {
  generate(args: {
    runId: string;
    candidate: UnifiedSupplementCandidate;
    attempt: number;
    correction?: string;
  }): Promise<GeneratedCardAsset>;
  generateHintSticker(args: {
    runId: string;
    candidate: UnifiedSupplementCandidate;
    attempt: number;
    correction?: string;
  }): Promise<GeneratedCardAsset>;
}

export const FULL_CARD_VISUAL_CONTRACT = `最终图片必须是2K、16:9的完整横向科普内容图，并能在310×180 CSS展示尺寸下清晰阅读。背景必须为纯黑或近黑色哑光底（#0B0B0B至#121212）并铺满整张图片；图片内部不得绘制外层卡片边框、圆角线框或四周描边，不得预留透明外边距。圆角、描边、裁切和关闭控件全部由H5容器提供；禁止深蓝、深紫、渐变、发光底和场景背景。顶部必须为问答区：大号粗体白色问题在上，较小浅灰色短答案在下，必须保留基础Prompt规定的逐字文案。解释贴图必须使用简洁扁平2D科普贴纸风：内部干净深色粗线，外缘明显粗白色模切描边，高饱和色块，只保留轻微2.5D体积和小阴影。禁止写实照片、3D玩具或黏土渲染、日漫场景、水彩、复杂背景、无关装饰、关闭叉号、播放器按钮、手机外框、水印、乱码或额外文案。重要文字和视觉主体放在中心安全区。`;

export const ABSTRACT_STICKER_COMPARE_VISUAL_CONTRACT = `这是 abstract_sticker_compare_v1 卡片。使用2K、16:9高清画布，按310×180 CSS展示尺寸校验缩略阅读效果。顶部问题区的位置不得变动：左上方只放一行醒目的白色粗体问题标题，不在标题下另写答案。主体必须是4个横向均匀排列的科普贴图比较组，每组只有数值或量级标签、贴图、核心判断和极短说明。贴图统一为简洁2D科普贴纸插画，带轻微2.5D体积感、粗白色模切外轮廓、细深灰内描边、圆润几何造型、柔和左上高光和轻微统一阴影，使用正视角或轻微三分之四视角。只用珊瑚红圆角描边框强调目标项。不得增加额外物件、额外文字、来源、脚注、表格、多层面板、流程、炫光或粒子效果。不画外层线框，由H5容器负责圆角和裁切。`;

export function buildFullCardImagePrompt(
  basePrompt: string,
  correction?: string,
  route: UnifiedSupplementCandidate["route"] = "knowledge_gap",
): string {
  const correctionPrompt = correction
    ? `\n\n上一次图片审核失败，必须修正：${correction}`
    : "";
  const visualContract = route === "abstract_to_intuitive"
    ? ABSTRACT_STICKER_COMPARE_VISUAL_CONTRACT
    : FULL_CARD_VISUAL_CONTRACT;
  return `${basePrompt}${correctionPrompt}\n\n${visualContract}`;
}

export const HINT_STICKER_VISUAL_CONTRACT = `生成一张用于移动端轻提示左侧方形槽位的高清独立卡通贴图。先从内容中提炼一个最容易识别的具体视觉主体，保留2至5个核心结构，适度简化次要细节；结构必须完整、比例合理、轮廓稳定，不得出现部件缺失、重复、错位或现实逻辑错误，缩小到40px后仍能快速识别。

整体必须采用精致卡通贴纸插画风（Sticker Illustration），扁平2.5D设计，介于扁平插画与轻立体图标之间；造型圆润、简洁、清晰、可爱但不过度幼稚，适合科普信息图、知识卡片和移动端UI。主体内部使用统一、连续、清晰的深色粗描边。主体外侧必须包裹完整、均匀、连续的粗白色模切贴纸边框，白边不得缺失、断裂、宽窄不一、被主体颜色吞没或连接画面边缘；白边外只添加非常轻微的柔和投影，形成轻微贴纸悬浮感。

使用柔和渐变、少量高光和轻微阴影表现体积，具有轻拟物和Emoji图标质感；表面光滑、干净、适度有光泽。配色明快但不过度饱和，用于深色卡片时提高主体明度与色彩区分度，确保主体和白色边框有清晰对比。

画面中只出现一个完整、紧凑的主体，主体居中并占画面约70%至80%，四周留白均匀，不裁切，不添加人物、手、地面、场景、装饰或无关物体。背景优先透明；如模型无法直接输出透明背景，则使用与主体边缘清晰分离的纯白背景，供服务端只清除与画布四边连通的背景区域。背景必须干净，无纹理、无渐变、无环境元素。

负面约束：禁止文字、数字、字母、水印、品牌Logo、界面元素、卡片边框和按钮；禁止写实摄影、真实材质、复杂真实3D、黏土、毛绒玩具、像素、水彩、油画、手绘草图、赛博朋克、霓虹灯、复杂纹理、复杂场景、多个分散主体、过细或模糊描边、主体裁切、结构错误、比例失衡、透视混乱、过度阴影、过度高光、过度反光、过度写实、过度幼稚和拟人化五官。`;

export function buildHintStickerImagePrompt(
  candidate: UnifiedSupplementCandidate,
  correction?: string,
): string {
  const routeDirection = candidate.route === "claim_verification"
    ? "把代表原话主题的对象与放大镜或核验动作融合为一个紧凑主体，表现‘值得再看’，不要画成两个分散物体。"
    : candidate.route === "abstract_to_intuitive"
      ? "把抽象数字或尺度转化为一个完整、直观、可比较的物体或刻度隐喻，不要堆叠多个分散对象。"
      : "把当前名词转化为一个容易秒懂的完整物体或结构隐喻，不要使用含义模糊的通用符号。";
  const mustShow = candidate.visual.mustShow?.length
    ? `优先保留这些语义元素：${candidate.visual.mustShow.join("、")}。`
    : "";
  const correctionPrompt = correction
    ? `\n上一次贴图审核失败，必须修正：${correction}`
    : "";
  return `${HINT_STICKER_VISUAL_CONTRACT}\n贴图语义来自：原话“${candidate.source.text}”，问题“${candidate.content.question}”，简短回答“${candidate.content.answer}”。${routeDirection}${mustShow}${correctionPrompt}`;
}

export class WanChain1ImageTool implements Chain1ImageTool {
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
      throw new Error("Claim verification must not generate a full-card image");
    }
    const basePrompt = args.candidate.visual.fullCardPrompt?.trim();
    if (!basePrompt) throw new Error("Missing full-card image prompt");
    const prompt = buildFullCardImagePrompt(basePrompt, args.correction, args.candidate.route);
    const generated = await new WanImageClient(loadWanImageConfig()).generateFullCard(prompt, {
      size: this.config.image.requestSize,
      ratio: this.config.image.requestRatio,
    });
    return this.store.persist({
      runId: args.runId,
      candidateId: args.candidate.id,
      generated,
      attempt: args.attempt,
      targetWidth: this.config.image.targetWidth,
      targetHeight: this.config.image.targetHeight,
    });
  }

  async generateHintSticker(args: {
    runId: string;
    candidate: UnifiedSupplementCandidate;
    attempt: number;
    correction?: string;
  }): Promise<GeneratedCardAsset> {
    const prompt = buildHintStickerImagePrompt(args.candidate, args.correction);
    const generated = await new WanImageClient(loadWanImageConfig()).generateHintSticker(prompt, {
      size: this.config.image.hintSticker.requestSize,
      ratio: this.config.image.hintSticker.requestRatio,
    });
    return this.store.persist({
      runId: args.runId,
      candidateId: args.candidate.id,
      generated,
      attempt: args.attempt,
      variant: "hint-sticker",
      targetWidth: this.config.image.hintSticker.targetWidth,
      targetHeight: this.config.image.hintSticker.targetHeight,
    });
  }
}

export class DisabledImageTool implements Chain1ImageTool {
  async generate(): Promise<GeneratedCardAsset> {
    throw new Error("Image generation is disabled");
  }

  async generateHintSticker(): Promise<GeneratedCardAsset> {
    throw new Error("Image generation is disabled");
  }
}
