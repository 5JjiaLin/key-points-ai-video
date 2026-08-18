import assert from "node:assert/strict";
import test from "node:test";
import { buildFullCardImagePrompt, buildHintStickerImagePrompt } from "../image/tool.js";
import type { UnifiedSupplementCandidate } from "../domain.js";

test("full-card image prompt uses full-bleed black content without drawing the H5 frame", () => {
  const prompt = buildFullCardImagePrompt("问题：65℃有多烫？答案：已经明显烫口。", "修正错字");

  assert.match(prompt, /纯黑或近黑色哑光底/);
  assert.match(prompt, /#0B0B0B至#121212/);
  assert.match(prompt, /铺满整张图片/);
  assert.match(prompt, /不得绘制外层卡片边框、圆角线框或四周描边/);
  assert.match(prompt, /圆角、描边、裁切和关闭控件全部由H5容器提供/);
  assert.doesNotMatch(prompt, /大圆角并带细灰描边/);
  assert.match(prompt, /大号粗体白色问题/);
  assert.match(prompt, /较小浅灰色短答案/);
  assert.match(prompt, /外缘明显粗白色模切描边/);
  assert.match(prompt, /禁止写实照片/);
  assert.match(prompt, /关闭叉号/);
  assert.match(prompt, /上一次图片审核失败，必须修正：修正错字/);
});

test("abstract full-card prompt locks the four-column sticker comparison layout", () => {
  const prompt = buildFullCardImagePrompt(
    "顶部问题：65℃有多烫？主体使用四组温度参照。",
    undefined,
    "abstract_to_intuitive",
  );

  assert.match(prompt, /abstract_sticker_compare_v1/);
  assert.match(prompt, /顶部问题区的位置不得变动/);
  assert.match(prompt, /只放一行醒目的白色粗体问题标题/);
  assert.match(prompt, /4个横向均匀排列/);
  assert.match(prompt, /粗白色模切外轮廓/);
  assert.match(prompt, /珊瑚红圆角描边框/);
  assert.match(prompt, /310×180/);
  assert.doesNotMatch(prompt, /较小浅灰色短答案/);
});

test("light-prompt sticker prompt enforces a text-free square sticker", () => {
  const candidate: UnifiedSupplementCandidate = {
    id: "claim",
    route: "claim_verification",
    source: { text: "冰水就是不健康的", startMs: 0, endMs: 1000, segmentIds: ["s"] },
    content: { question: "冰水就是不健康的吗？", answer: "需要结合人群和饮用方式判断。" },
    decision: { displayMode: "auto_prompt", confidence: 0.9, globalPriority: 90, reasons: [] },
    trigger: { triggerAtMs: 1500 },
    visual: { required: false },
    provenance: { skillId: "claim_verification", skillVersion: "v1", rawOutput: {} },
  };
  const prompt = buildHintStickerImagePrompt(candidate);

  assert.match(prompt, /轻提示左侧方形槽位/);
  assert.match(prompt, /Sticker Illustration/);
  assert.match(prompt, /扁平2\.5D/);
  assert.match(prompt, /完整、均匀、连续的粗白色模切贴纸边框/);
  assert.match(prompt, /柔和渐变、少量高光和轻微阴影/);
  assert.match(prompt, /明快但不过度饱和/);
  assert.match(prompt, /占画面约70%至80%/);
  assert.match(prompt, /背景优先透明/);
  assert.match(prompt, /无法直接输出透明背景.*纯白背景/);
  assert.match(prompt, /只清除与画布四边连通的背景区域/);
  assert.match(prompt, /禁止文字、数字、字母、水印、品牌Logo/);
  assert.match(prompt, /拟人化五官/);
  assert.match(prompt, /放大镜或核验动作融合为一个紧凑主体/);
  assert.match(prompt, /缩小到40px后仍能快速识别/);
});
