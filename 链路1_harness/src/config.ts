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
  };
  image: {
    enabled: boolean;
    maxAttempts: number;
    targetWidth: 930;
    targetHeight: 540;
    requestSize: "2K";
    requestRatio: "16:9";
    hintSticker: {
      enabled: boolean;
      maxAttempts: number;
      targetWidth: 120;
      targetHeight: 120;
      requestSize: "2K";
      requestRatio: "1:1";
    };
  };
  traceDirectory: string;
  assetDirectory: string;
}

export const DEFAULT_CONFIG: Chain1HarnessConfig = {
  versions: {
    routeClassifier: "route-classifier-v1",
    abstractToIntuitive: "abstract-to-intuitive-v16",
    knowledgeGap: "knowledge-gap-v2",
    claimVerification: "claim-verification-v8",
  },
  route: {
    minimumConfidence: 0.62,
    ambiguityDelta: 0.08,
    allowSecondaryRoute: true,
  },
  arbitration: {
    overlapWindowMs: 4000,
  },
  image: {
    enabled: true,
    maxAttempts: 3,
    targetWidth: 930,
    targetHeight: 540,
    requestSize: "2K",
    requestRatio: "16:9",
    hintSticker: {
      enabled: true,
      maxAttempts: 2,
      targetWidth: 120,
      targetHeight: 120,
      requestSize: "2K",
      requestRatio: "1:1",
    },
  },
  traceDirectory: process.env.CHAIN1_TRACE_DIR ?? ".harness/traces",
  assetDirectory: process.env.CHAIN1_ASSET_DIR ?? "public/generated/chain1-cards",
};
