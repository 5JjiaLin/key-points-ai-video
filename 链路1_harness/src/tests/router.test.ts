import test from "node:test";
import assert from "node:assert/strict";
import { HeuristicRouteClassifier, PromptRouteClassifier, type JsonInvoker } from "../router.js";
import type { CandidateWindow, EnvironmentSnapshot } from "../domain.js";

const snapshot = { title: "demo" } as EnvironmentSnapshot;

function candidate(overrides: Partial<CandidateWindow>): CandidateWindow {
  return {
    id: "c1",
    videoId: "v1",
    sourceText: "65℃以上的热饮",
    startMs: 0,
    endMs: 1000,
    segmentIds: ["s1"],
    contextBefore: "",
    contextAfter: "",
    ocrText: [],
    visualContext: [],
    signals: {
      containsNumber: true,
      containsUnit: true,
      containsPotentialTerm: false,
      containsStrongClaim: false,
      containsCausalLanguage: false,
      containsVisualCue: false,
    },
    ...overrides,
  };
}

test("routes abstract numbers to abstract_to_intuitive", async () => {
  const result = await new HeuristicRouteClassifier().classify(snapshot, candidate({}));
  assert.equal(result.primaryRoute, "abstract_to_intuitive");
});

test("routes strong claims to claim_verification", async () => {
  const result = await new HeuristicRouteClassifier().classify(
    snapshot,
    candidate({
      sourceText: "冰水就是不健康的",
      signals: {
        containsNumber: false,
        containsUnit: false,
        containsPotentialTerm: false,
        containsStrongClaim: true,
        containsCausalLanguage: false,
        containsVisualCue: false,
      },
    }),
  );
  assert.equal(result.primaryRoute, "claim_verification");
});

test("batch router limits one remote request to twelve candidates", async () => {
  let calls = 0;
  const invoker: JsonInvoker = {
    async invokeJson<T>(args: { input: unknown }): Promise<T> {
      calls += 1;
      const rows = (args.input as { candidates: Array<{ id: string }> }).candidates.map((item) => ({
        candidate_id: item.id,
        is_candidate: false,
        primary_route: "discard",
        route_scores: { abstract_to_intuitive: 0, knowledge_gap: 0, claim_verification: 0, discard: 1 },
        confidence: 1,
        reason: "discard",
        evidence: [],
      }));
      return { decisions: rows } as T;
    },
  };
  const candidates = Array.from({ length: 25 }, (_, index) => candidate({ id: `c${index}` }));
  const decisions = await new PromptRouteClassifier(invoker).classifyBatch(snapshot, candidates);
  assert.equal(calls, 3);
  assert.equal(decisions.size, 25);
});

test("a failed route batch falls back without failing the whole video", async () => {
  const invoker: JsonInvoker = {
    async invokeJson<T>(): Promise<T> {
      throw new Error("timeout");
    },
  };
  const result = await new PromptRouteClassifier(invoker).classifyBatch(snapshot, [candidate({ id: "c1" })]);
  assert.equal(result.get("c1")?.primaryRoute, "abstract_to_intuitive");
  assert.match(result.get("c1")?.reason ?? "", /批量路由请求失败/);
});
