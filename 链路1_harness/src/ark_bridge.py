from __future__ import annotations

import base64
import json
import mimetypes
import os
import sys
import time
from pathlib import Path
from typing import Any

import httpx


def main() -> None:
    request = json.load(sys.stdin)
    api_key = os.getenv("ARK_API_KEY") or os.getenv("DOUBAO_API_KEY")
    if not api_key:
        raise RuntimeError("Missing server-side ARK_API_KEY")
    content: list[dict[str, Any]] = [
        {
            "type": "input_text",
            "text": (
                f"{request['systemPrompt']}\n\n输入数据：\n"
                f"{json.dumps(request['input'], ensure_ascii=False)}\n\n"
                f"只输出符合 {request['schemaName']} 的 JSON，不要 Markdown。"
            ),
        }
    ]
    for raw_path in request.get("imagePaths") or []:
        path = Path(raw_path)
        if not path.is_file():
            continue
        mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        content.append({"type": "input_image", "image_url": f"data:{mime};base64,{encoded}"})
    body = {
        "model": request["model"],
        "input": [{"role": "user", "content": content}],
        "temperature": 0.2,
    }
    timeout = float(request.get("timeoutSeconds") or 180)
    attempts = int(request.get("maxRetries") or 0) + 1
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            response = httpx.post(
                request["endpoint"],
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=body,
                timeout=timeout,
            )
            if response.status_code >= 400:
                raise RuntimeError(f"Ark HTTP {response.status_code}: {response.text[:500]}")
            print(_extract_text(response.json()))
            return
        except (httpx.HTTPError, RuntimeError, ValueError, KeyError) as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(0.5 * (2**attempt))
    raise RuntimeError(str(last_error or "Ark bridge failed"))


def _extract_text(payload: dict[str, Any]) -> str:
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text
    parts: list[str] = []
    for item in payload.get("output") or []:
        if not isinstance(item, dict):
            continue
        for content in item.get("content") or []:
            if isinstance(content, dict) and isinstance(content.get("text"), str):
                parts.append(content["text"])
    if not parts:
        raise RuntimeError("Ark response contained no text")
    return "\n".join(parts)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
