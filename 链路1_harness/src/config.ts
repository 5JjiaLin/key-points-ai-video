export interface Chain1HarnessConfig {
  versions: {
    routeClassifier: string;
    abstractToIntuitive: string;
    knowledgeGap: string;
    claimVerification: string;
  };
  route: {
    minimumConfidence: number;
    ambiguityDelta: number;
    allowSecondaryRoute: boolean;
  };
  arbitration: {
    overlapWindowMs: number;
    minimumPromptIntervalMs: number;
    maximumPromptsPerMinute: number;
  };
  image: {
    enabled: boolean;
    maxAttempts: number;
    targetWidth: 310;
    targetHeight: 180;
    requestSize: "1K";
    requestRatio: "16:9";
  };
  traceDirectory: string;
  assetDirectory: string;
}

export const DEFAULT_CONFIG: Chain1HarnessConfig = {
  versions: {
    routeClassifier: "route-classifier-v1",
    abstractToIntuitive: "abstract-to-intuitive-v13",
    knowledgeGap: "knowledge-gap-v1",
    claimVerification: "claim-verification-v6",
  },
  route: {
    minimumConfidence: 0.62,
    ambiguityDelta: 0.08,
    allowSecondaryRoute: true,
  },
  arbitration: {
    overlapWindowMs: 4000,
    minimumPromptIntervalMs: 15000,
    maximumPromptsPerMinute: 2,
  },
  image: {
    enabled: true,
    maxAttempts: 3,
    targetWidth: 310,
    targetHeight: 180,
    requestSize: "1K",
    requestRatio: "16:9",
  },
  traceDirectory: process.env.CHAIN1_TRACE_DIR ?? ".harness/traces",
  assetDirectory: process.env.CHAIN1_ASSET_DIR ?? "public/generated/chain1-cards",
};
