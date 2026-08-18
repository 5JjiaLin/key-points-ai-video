# 划重点视频理解 Harness 契约

## 1. Public boundary

The Backend API is the only supported integration boundary:

```text
Caller / Agent
  -> Backend API
     -> single-video Harness
        -> shared video-environment.v1
        -> chain 1 understanding supplements
        -> chain 2 knowledge navigation
     -> video-project.v1
     -> knowledge pool
     -> chain 3 multi-video reconstruction
        -> traceable learning path
```

Callers must not coordinate internal Skills themselves. The Backend owns
orchestration, retries, schema conversion, persistence, and secret access.

Default local URLs:

- Backend: `http://127.0.0.1:8000`
- Chain 3 internal service: `http://127.0.0.1:8787`

Override the client-facing URL with `HARNESS_API_URL`. Chain 3 remains an
internal service and is exposed in the client only for deep health checks.

## 2. Single-video lifecycle

### Upload local video

`POST /api/videos` with multipart field `file`.

Supported extensions: MP4, MOV, M4V, and WebM.

Response:

```json
{
  "jobId": "uuid",
  "status": "queued"
}
```

### Import public Douyin media

`POST /api/videos/from-douyin`

```json
{
  "url": "public URL or copied share text"
}
```

The route downloads and validates the source on the server. It must not be used
to bypass authentication, access controls, or content authorization.

### Poll job

`GET /api/jobs/{jobId}`

Terminal success states:

- `ready`
- `ready_with_fallbacks`

Terminal failure state:

- `failed`

The status body includes progress and a user-facing message. A failed job may
be retried only when `retryable` is true:

`POST /api/jobs/{jobId}/retry`

### Read result

`GET /api/jobs/{jobId}/result`

The public result is `video-project.v1`. Its stable product fields include:

- video identity, title, creator, and duration;
- optional `category` (one of the eight domains in section 7);
- source media URL;
- millisecond timeline;
- knowledge points with source ranges;
- chain 1 understanding supplements (knowledge_gap and abstract_to_intuitive
  carry a generated card image and hint sticker; claim_verification renders a
  two-column verification template without an image);
- chain 2 knowledge navigation results.

Internal `video-analysis.v1` traces and `video-environment.v1` evidence are
server-side contracts. Do not return raw API keys, prompts, candidate-card
selection details, or audit traces to H5.

## 3. Shared evidence contract

Each successfully analyzed video has one immutable `video-environment.v1`
snapshot for that run. It contains the reusable source evidence:

- ASR segments;
- OCR segments;
- keyframes and visual flags;
- semantic segments;
- video metadata and content hash.

Chain 1 and chain 2 must read the same snapshot. Chain 3 consumes the saved
snapshot and the `video-project.v1` knowledge points; it must not repeat video
download, ASR, OCR, or keyframe extraction.

## 4. Knowledge pool

### List

`GET /api/knowledge-pool`

### Add

`POST /api/knowledge-pool/items`

```json
{
  "jobId": "completed-job-id"
}
```

### Remove

`DELETE /api/knowledge-pool/items/{jobId}`

Removal changes only pool membership. It does not delete source media, evidence,
or the single-video result.

## 5. Multi-video reconstruction

### Start stable-layer analysis

`POST /api/reconstructions`

```json
{
  "videoIds": ["job-1", "job-2", "job-3"],
  "requestedAnalysisMode": "auto",
  "themeHint": "optional topic hint"
}
```

Rules:

- choose 3-10 distinct IDs;
- every ID must already be in the knowledge pool;
- every job must be `ready` or `ready_with_fallbacks`;
- every job must retain its shared evidence snapshot;
- `requestedAnalysisMode` is `auto`, `single_creator_series`, or
  `multi_creator_topic`.

Response:

```json
{
  "analysisId": "analysis-id",
  "status": "created"
}
```

### Poll reconstruction

`GET /api/reconstructions/{analysisId}`

The first phase normally stops at `awaiting_question`. Terminal error states are
`failed` and `needs_review`.

### Read recommendations or final path

`GET /api/reconstructions/{analysisId}/result`

Before the user supplies a research question, this returns the reusable topic
knowledge layer and recommended questions. After successful reconstruction, it
returns the completed learning path.

### Build path

`POST /api/reconstructions/{analysisId}/path`

```json
{
  "researchQuestion": "neutral, user-confirmed research question"
}
```

Poll until `completed`, `needs_review`, or `failed`.

Every published path node must remain traceable through:

- source video/job ID;
- source segment or evidence ID;
- source start and end times in milliseconds.

## 6. Model gateway and stability contract

All model access is server-side. The Backend and internal Skills read model
credentials and endpoints from server environment variables only. The public
HTTP contracts never change when a model provider is swapped.

### Providers

- Text reasoning (chain 1 routing, chain 2 knowledge points, chain 3 skills):
  Doubao / Ark OpenAI-compatible endpoint (`doubao-seed-2-0-lite-260428` by
  default). Chain 1 supplement copy may use the Agnes chat provider.
- Image generation (chain 1 full cards and hint stickers): Tongyi Qwen
  `qwen-image` via the DashScope asynchronous `text2image/image-synthesis` API
  (submit task, then poll). Claim-verification supplements never generate an
  image; they render as a two-column verification template.

### Stability parameters

Tune these server-side variables; do not hardcode them in callers:

- `ARK_TIMEOUT_MS` (default raised to `240000`): single Doubao/Ark call timeout.
  Chain 2 knowledge-point selection can take 50-90s per batch.
- `ARK_MAX_RETRIES` (default `1`): retry transient model failures once.
- `CHAIN2_MAX_SEMANTIC_SEGMENTS_PER_REQUEST` (default `8`): smaller batches keep
  each chain 2 call under the timeout.
- `LLM_TIMEOUT_MS` (default `300000`): chain 3 per-skill model timeout; a
  reconstruction spans many skills over multiple videos.
- `CHAIN1_SUBPROCESS_TIMEOUT_SECONDS` (default `5400`): chain 1 processes each
  semantic segment as an independent candidate; large videos need headroom.
- `PLAYBACK_TRANSCODE_PRESET` (default `veryfast`): playback transcode speed.

### Tolerant parsing at model boundaries

Model output is non-deterministic. Classification-label fields (for example a
knowledge dimension) must not use brittle strict-enum validation, because a
hallucinated out-of-enum value would otherwise fail the whole chain. Only
flow-critical fields are validated strictly; descriptive labels accept any
string. Malformed JSON is repaired once before a hard failure is raised.

## 7. Category taxonomy contract

Every completed `video-project.v1` carries an optional `category` field, one of
eight science-popularization domains:

- `astronomy` 天文宇宙
- `geography` 自然地理
- `history` 历史人文
- `life-science` 生命科学
- `technology` 科技原理
- `economy` 社会经济
- `physics-chemistry` 物理化学
- `food-nutrition` 食品营养

`GET /api/showcase` and `GET /api/knowledge-pool` pass `category` through so the
client can group videos by domain. Multi-video reconstruction is only meaningful
across videos that share a topic; the domain grouping helps callers assemble a
relevant set before starting chain 3.

## 8. Production adapter boundary

Keep the Skill and public HTTP contracts unchanged when moving from the local
prototype to production. Replace these Backend-side adapters:

- local file upload -> platform video ID or authorized object storage;
- local ASR/OCR/keyframes -> production media understanding services;
- local JSON files -> database and object storage;
- in-process worker -> durable queue and worker pool;
- local model endpoint -> approved model gateway;
- local identity -> platform authentication and authorization;
- local Trace files -> observable, access-controlled telemetry.

API keys remain server-side environment variables or secret-manager references.
Never put a real key in this package, Git history, H5 code, model prompt, or
Trace.
