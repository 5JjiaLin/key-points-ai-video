export type SupplementRoute =
  | "abstract_to_intuitive"
  | "knowledge_gap"
  | "claim_verification";

export type RouteOrDiscard = SupplementRoute | "discard";

export type DisplayMode =
  | "auto_prompt"
  | "list_only"
  | "suppressed"
  | "pending_review";

export interface TimedTextSegment {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface VisualContextSegment {
  id: string;
  startMs: number;
  endMs: number;
  description: string;
  ocrText?: string[];
  containsScaleVisualization?: boolean;
  containsChartOrSource?: boolean;
  containsSimulation?: boolean;
  imagePath?: string;
  evidenceKinds?: string[];
}

export interface SemanticSegment {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  asrSegmentIds: string[];
  ocrSegmentIds?: string[];
}

export interface VideoEnvironmentInput {
  videoId: string;
  videoHash: string;
  title: string;
  description?: string;
  durationMs: number;
  sourceVideoUrl: string;
  asrSegments: TimedTextSegment[];
  ocrSegments: TimedTextSegment[];
  visualContext: VisualContextSegment[];
  semanticSegments: SemanticSegment[];
  metadata?: Record<string, unknown>;
}

export interface EnvironmentSnapshot extends VideoEnvironmentInput {
  snapshotId: string;
  createdAt: string;
  skillVersions: {
    abstractToIntuitive: string;
    knowledgeGap: string;
    claimVerification: string;
    routeClassifier: string;
  };
  modelVersions: Record<string, string>;
}

export interface CandidateWindow {
  id: string;
  videoId: string;
  sourceText: string;
  startMs: number;
  endMs: number;
  segmentIds: string[];
  contextBefore: string;
  contextAfter: string;
  ocrText: string[];
  visualContext: VisualContextSegment[];
  signals: {
    containsNumber: boolean;
    containsUnit: boolean;
    containsPotentialTerm: boolean;
    containsStrongClaim: boolean;
    containsCausalLanguage: boolean;
    containsVisualCue: boolean;
  };
}

export interface RouteDecision {
  isCandidate: boolean;
  primaryRoute: RouteOrDiscard;
  secondaryRoute?: SupplementRoute | null;
  routeScores: Record<RouteOrDiscard, number>;
  confidence: number;
  reason: string;
  evidence: string[];
}

export interface SkillRunInput {
  runId: string;
  snapshotId: string;
  video: Pick<EnvironmentSnapshot, "videoId" | "title" | "description" | "durationMs">;
  candidate: CandidateWindow;
  routeDecision: RouteDecision;
  activeRoute?: SupplementRoute;
  runtimeContext?: Record<string, unknown>;
}

export interface SkillExecutionResult {
  route: SupplementRoute;
  skillId: string;
  skillVersion: string;
  rawOutput: unknown;
  durationMs: number;
}

export interface UnifiedSupplementCandidate {
  id: string;
  route: SupplementRoute;
  source: {
    text: string;
    span?: string;
    startMs: number;
    endMs: number;
    segmentIds: string[];
  };
  content: {
    question: string;
    answer: string;
    subtitle?: string;
    answerLabel?: string;
    cardVariant?: "viewpoint_clarification" | "verification_result";
    leftColumn?: ClarificationColumn;
    rightColumn?: ClarificationColumn;
    sourceCount?: number;
    sourceAction?: string;
    detail?: unknown;
  };
  decision: {
    displayMode: DisplayMode;
    confidence: number;
    skillScore?: number;
    globalPriority: number;
    reasons: string[];
  };
  trigger: {
    triggerAtMs: number;
  };
  visual: {
    required: boolean;
    fullCardPrompt?: string;
    mustShow?: string[];
    mustNotShow?: string[];
  };
  provenance: {
    skillId: string;
    skillVersion: string;
    rawOutput: unknown;
  };
}

export interface ClarificationColumn {
  title: string;
  content: string;
}

export interface GeneratedCardAsset {
  originalUrl?: string;
  localPath: string;
  publicUrl: string;
  width: number;
  height: number;
  model: string;
  attempts: number;
}

export interface FinalSupplement {
  id: string;
  type: SupplementRoute;
  sourceText: string;
  startMs: number;
  endMs: number;
  triggerAtMs: number;
  displayMode: Exclude<DisplayMode, "suppressed" | "pending_review">;
  question: string;
  answer: string;
  subtitle?: string;
  answerLabel?: string;
  cardVariant?: "viewpoint_clarification" | "verification_result";
  leftColumn?: ClarificationColumn;
  rightColumn?: ClarificationColumn;
  sourceCount?: number;
  sourceAction?: string;
  detail?: unknown;
  renderMode: "full_generated_image" | "verification_template" | "text_fallback";
  hintStickerImageUrl?: string;
  hintStickerWidth?: 96;
  hintStickerHeight?: 96;
  cardImageUrl?: string;
  cardWidth?: 310;
  cardHeight?: 180;
  provenance: UnifiedSupplementCandidate["provenance"];
}

export interface SuppressedCandidate {
  id: string;
  route?: SupplementRoute;
  sourceText: string;
  startMs: number;
  endMs: number;
  reason: string;
}

export interface GraderResult {
  passed: boolean;
  score: number;
  errors: string[];
  warnings: string[];
  retryInstruction?: string;
}

export interface Chain1HarnessResult {
  runId: string;
  snapshotId: string;
  videoId: string;
  status: "ready" | "ready_with_fallbacks" | "failed";
  supplements: FinalSupplement[];
  suppressed: SuppressedCandidate[];
  graderSummary: {
    contentPassed: number;
    contentFailed: number;
    visualPassed: number;
    visualFallbacks: number;
    hintStickerPassed: number;
    hintStickerFallbacks: number;
  };
  tracePath: string;
}

export interface TraceEvent {
  runId: string;
  snapshotId: string;
  candidateId?: string;
  timestamp: string;
  step: string;
  status: "started" | "completed" | "skipped" | "failed";
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
}
