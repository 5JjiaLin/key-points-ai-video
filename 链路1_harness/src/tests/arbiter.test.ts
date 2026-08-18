import assert from "node:assert/strict";
import test from "node:test";
import { arbitrateCandidates } from "../arbiter.js";
import { DEFAULT_CONFIG } from "../config.js";
import type { UnifiedSupplementCandidate } from "../domain.js";

function candidate(
  id: string,
  startMs: number,
  endMs: number,
  globalPriority: number,
): UnifiedSupplementCandidate {
  return {
    id,
    route: "claim_verification",
    source: {
      text: id,
      startMs,
      endMs,
      segmentIds: [id],
    },
    content: {
      question: `${id}?`,
      answer: id,
    },
    decision: {
      displayMode: "auto_prompt",
      confidence: 0.9,
      globalPriority,
      reasons: [],
    },
    trigger: {
      triggerAtMs: endMs + 500,
    },
    visual: {
      required: false,
    },
    provenance: {
      skillId: "test",
      skillVersion: "test-v1",
      rawOutput: {},
    },
  };
}

test("keeps adjacent candidates that share only a boundary", () => {
  const first = candidate("hot-water-65c", 27_300, 52_360, 80);
  const second = candidate("warm-water-35c", 52_360, 77_360, 90);

  const result = arbitrateCandidates([first, second], DEFAULT_CONFIG);

  assert.deepEqual(result.selected.map((item) => item.id), [first.id, second.id]);
  assert.equal(result.suppressed.length, 0);
});

test("still suppresses candidates with a real time overlap", () => {
  const lowerPriority = candidate("lower", 27_300, 55_000, 80);
  const higherPriority = candidate("higher", 52_360, 77_360, 90);

  const result = arbitrateCandidates([lowerPriority, higherPriority], DEFAULT_CONFIG);

  assert.deepEqual(result.selected.map((item) => item.id), [higherPriority.id]);
  assert.equal(result.suppressed[0]?.id, lowerPriority.id);
});

test("keeps all non-overlapping automatic prompts without a frequency budget", () => {
  const listOnlyFirst = candidate("verification-1", 0, 5_000, 90);
  const automaticFirst = candidate("visual-explainer-1", 10_000, 15_000, 90);
  const automaticSecond = candidate("visual-explainer-2", 20_000, 25_000, 90);
  const automaticThird = candidate("visual-explainer-3", 30_000, 35_000, 90);
  automaticFirst.decision.displayMode = "auto_prompt";
  automaticSecond.decision.displayMode = "auto_prompt";
  automaticThird.decision.displayMode = "auto_prompt";
  listOnlyFirst.decision.displayMode = "list_only";

  const result = arbitrateCandidates(
    [listOnlyFirst, automaticFirst, automaticSecond, automaticThird],
    DEFAULT_CONFIG,
  );

  assert.deepEqual(
    result.selected.filter((item) => item.decision.displayMode === "auto_prompt").map((item) => item.id),
    [automaticFirst.id, automaticSecond.id, automaticThird.id],
  );
  assert.equal(result.suppressed[0]?.id, listOnlyFirst.id);
  assert.equal(result.suppressed[0]?.reason, "链路1无列表入口，仅展示自动轻提示");
});

test("keeps pending-review candidates out of the visible supplements", () => {
  const pending = candidate("verification-pending", 0, 5_000, 90);
  pending.decision.displayMode = "pending_review";

  const result = arbitrateCandidates([pending], DEFAULT_CONFIG);

  assert.equal(result.selected.length, 0);
  assert.equal(result.suppressed[0]?.id, pending.id);
  assert.equal(result.suppressed[0]?.reason, "等待人工复核");
});
