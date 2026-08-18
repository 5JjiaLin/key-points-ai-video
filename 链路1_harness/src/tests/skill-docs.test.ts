import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const skills = [
  {
    name: "abstract",
    runtime: "abstract-to-intuitive.skill.md",
    source: "补充抽象变直观skill.md",
    required: [
      "name: chain1-abstract-to-intuitive",
      '"selected_candidates"',
      '"suppressed_candidates"',
      '"image_prompt"',
      '"intuitive_mapping"',
      "10万亿美元≈100万亿人民币",
      "#0B0B0B",
      "粗白色模切外轮廓",
      "体感、动作或现实结果",
      "不得绘制外层卡片边框",
      "3 秒内说出目标数字",
      "禁止出现关闭叉号",
      "abstract_sticker_compare_v1",
      "4 个横向均匀排列",
      "珊瑚红圆角描边框",
    ],
  },
  {
    name: "knowledge",
    runtime: "knowledge-gap.skill.md",
    source: "补充名词知识skill.md",
    required: [
      "name: chain1-knowledge-gap",
      '"selected_term"',
      '"display_mode"',
      '"visual_semantic_plan"',
      '"image_prompt"',
      "#0B0B0B",
      "粗白色模切描边",
      "不得绘制外层卡片边框",
      "禁止出现关闭叉号",
    ],
  },
  {
    name: "verification",
    runtime: "claim-verification.skill.md",
    source: "补充验证真假skill.md",
    required: [
      "name: chain1-claim-verification",
      '"should_trigger"',
      '"insufficient_evidence"',
      '"unknowns"',
      '"conflicts"',
      '"card_variant"',
      '"left_column"',
      '"right_column"',
      "310×180",
      "不得伪造来源",
    ],
  },
] as const;

for (const skill of skills) {
  test(`${skill.name} skill stays compact and synchronized`, () => {
    const runtime = readFileSync(resolve("skills", skill.runtime), "utf8");
    const source = readFileSync(resolve("..", "链路1skill", skill.source), "utf8");

    assert.equal(runtime, source);
    assert.ok(runtime.startsWith("---\nname:"));
    assert.ok(runtime.length < 12_000, `${skill.name} skill is too large`);
    assert.ok(runtime.split(/\r?\n/).length < 300, `${skill.name} skill has too many lines`);
    assert.doesNotMatch(runtime, /更新后的|若本节与前文冲突|abstract_data_visualization|number_visualization|concept_gap/);
    for (const marker of skill.required) assert.ok(runtime.includes(marker), `${marker} missing`);
    for (const match of runtime.matchAll(/```json\n([\s\S]*?)\n```/g)) {
      assert.doesNotThrow(() => JSON.parse(match[1]!), `${skill.name} has invalid JSON example`);
    }
  });
}

test("claim verification output contract does not request image generation", () => {
  const prompt = readFileSync(resolve("skills", "claim-verification.skill.md"), "utf8");
  assert.doesNotMatch(prompt, /"image_prompt"\s*:/);
  assert.match(prompt, /永远不输出生图 Prompt/);
});
