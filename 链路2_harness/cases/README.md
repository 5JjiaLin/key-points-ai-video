# Harness Cases

Create `videos.jsonl` in this directory when you are ready to run real cases.

Each line should be one JSON object:

```json
{"case_id":"case_001","video_id":"video_001","video_path":"videos/video_001.mp4","title":"视频标题","duration_seconds":180,"language":"zh-CN","sidecar_text_path":"transcripts/video_001.md"}
```

Paths are resolved relative to the manifest file.

`sidecar_text_path` is optional. When omitted, the harness uses `HARNESS_VIDEO_INPUT_MODE`:

- `frames` (default): extract timestamped JPEG frames and send them as multimodal image input.
- `file`: upload the original video with Ark/Doubao Files API, then reference the returned `file_id`.
- `inline`: send the local video as an inline `video_url` data URL.

The harness does not enforce a local video size limit; actual limits come from the model/API, request timeout, and context window.
