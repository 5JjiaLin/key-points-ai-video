---
name: huazhongdian-video-harness
description: Unified video-understanding Harness for the 划重点 product. Use when an agent needs to upload or import a video, wait for shared ASR/OCR/keyframe analysis, read knowledge points, add completed videos to the knowledge pool, or build a traceable learning path from 3-10 videos through chains 1, 2, and 3.
---

# 划重点视频理解 Harness

## Overview

Treat the Backend API as the only public boundary. It orchestrates chain 1
understanding supplements, chain 2 knowledge navigation, and chain 3 multi-video
reconstruction while keeping model keys and internal traces on the server.

Use `scripts/harness_client.py` for deterministic calls. Set
`HARNESS_API_URL` when the Backend is not at `http://127.0.0.1:8000`.

## Choose the workflow

- For one local video, use **Single-video analysis**.
- For a Douyin share link or share text, use **Douyin import**.
- To save a completed video for later study, use **Knowledge pool**.
- To connect 3-10 completed videos into a learning path, use
  **Multi-video reconstruction**.

Do not call chain 1, 2, or 3 directly unless debugging the platform itself.

## What each chain produces

- **Chain 1 (understanding supplements)** scans the video and, only where a
  viewer would likely get stuck, emits a light hint the user can tap without
  leaving playback. It covers three cases: an abstract number the creator never
  made concrete (`abstract_to_intuitive`), a claim the viewer may doubt
  (`claim_verification`), and an unexplained term (`knowledge_gap`). The first
  two visual routes produce a generated card image plus a hint sticker via the
  Qwen image model; claim verification renders a neutral two-column template and
  never generates an image.
- **Chain 2 (knowledge navigation)** extracts and summarizes the video's main
  knowledge points for quick preview. A user who finds them useful adds the
  video to the knowledge pool, which feeds chain 3.
- **Chain 3 (multi-video reconstruction)** takes 3-10 pooled videos plus a
  learning direction, reuses the saved chain 2 knowledge points (it does not
  re-run ASR/OCR), reorders them along the user's direction, and returns a
  learning path whose nodes point back to the exact source clip.

Group videos by their `category` domain before starting chain 3; a path is only
meaningful across videos that share a topic.

## Preflight

Run:

```bash
python3 scripts/harness_client.py health --deep
```

Require both `backend.status == "ok"` and `chain3.ok == true` before starting a
multi-video task. A single-video task only requires the Backend.

Never place `ARK_API_KEY`, `DOUBAO_API_KEY`, `LLM_API_KEY`, or any other secret
in this Skill, a browser bundle, a request body, or a Trace.

## Single-video analysis

Upload, wait for analysis, and immediately add the completed video to the
knowledge pool:

```bash
python3 scripts/harness_client.py upload /absolute/path/video.mp4 \
  --wait --add-to-pool
```

The completed result is the public `video-project.v1` product contract. Preserve
its millisecond timestamps and source media references. Do not expose internal
candidate cards, selection scores, or audit traces to H5 consumers.

To inspect an existing task:

```bash
python3 scripts/harness_client.py job JOB_ID
python3 scripts/harness_client.py result JOB_ID
```

## Douyin import

Pass either the public URL or the full copied share text:

```bash
python3 scripts/harness_client.py douyin \
  '复制的抖音分享文本或 https://v.douyin.com/.../' \
  --wait --add-to-pool
```

Do not use this route for private, login-only, or unauthorized media.

## Knowledge pool

List or update the pool:

```bash
python3 scripts/harness_client.py pool
python3 scripts/harness_client.py pool-add JOB_ID
python3 scripts/harness_client.py pool-remove JOB_ID
```

Only use completed jobs with reusable evidence. Removing an item from the pool
does not delete its source video or analysis result.

## Multi-video reconstruction

First choose 3-10 distinct, completed job IDs already in the pool. Start the
stable knowledge-layer analysis and wait for question recommendations:

```bash
python3 scripts/harness_client.py reconstruct JOB_ID_1 JOB_ID_2 JOB_ID_3 \
  --mode auto --theme '可选主题提示' --wait
```

Read the returned recommended questions from:

```bash
python3 scripts/harness_client.py reconstruction-result ANALYSIS_ID
```

Ask the user to select or edit a neutral research question. Then build the
personalized path:

```bash
python3 scripts/harness_client.py build-path ANALYSIS_ID \
  '这些视频如何从不同角度解释该主题？' --wait
```

Publish only a `completed` result. If the state is `needs_review` or `failed`,
report the returned error and do not invent a path. Every path node must keep
its source video ID and source time range so the product can jump back to the
original clip.

## Contracts and extension boundary

Read `references/contracts.md` when integrating another product, replacing a
model provider, or adding production storage/queue adapters. Keep the public
contracts stable; replace adapters behind the Backend instead of teaching the
calling agent each internal service.
