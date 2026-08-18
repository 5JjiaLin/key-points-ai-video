import { createHash } from "node:crypto";
import type { Chain1HarnessConfig } from "./config.js";
import type { EnvironmentSnapshot, VideoEnvironmentInput } from "./domain.js";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function freezeEnvironment(
  input: VideoEnvironmentInput,
  config: Chain1HarnessConfig,
  modelVersions: Record<string, string> = {},
): EnvironmentSnapshot {
  const digest = createHash("sha256")
    .update(stableStringify({ input, versions: config.versions, modelVersions }))
    .digest("hex")
    .slice(0, 20);

  return Object.freeze({
    ...structuredClone(input),
    snapshotId: `snapshot_${digest}`,
    createdAt: new Date().toISOString(),
    skillVersions: {
      abstractToIntuitive: config.versions.abstractToIntuitive,
      knowledgeGap: config.versions.knowledgeGap,
      claimVerification: config.versions.claimVerification,
      routeClassifier: config.versions.routeClassifier,
    },
    modelVersions: structuredClone(modelVersions),
  });
}
