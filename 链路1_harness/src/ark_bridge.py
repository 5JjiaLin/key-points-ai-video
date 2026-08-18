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
    provider = (os.getenv("CHAIN1_LLM_PROVIDER") or "doubao").strip().lower()
    if provider == "agnes":
        _run_agnes(request)
    else:
        _run_doubao(request)


def _combined_prompt(request: dict[str, Any]) -> str:
    return (
        f"{request['systemPrompt']}\n\n输入数据：\n"
        f"{json.dumps(request['input'], ensure_ascii=False)}\n\n"
        f"只输出符合 {request['schemaName']} 的 JSON，不要 Markdown。"
    )


def _image_data_url(raw_path: str) -> str | None:
    path = Path(raw_path)
    if not path.is_file():
        return None
    mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _post_with_retries(
    endpoint: str,
    headers: dict[str, str],
    body: dict[str, Any],
    *,
    timeout: float,
    attempts: int,
    extractor: Any,
) -> None:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            response = httpx.post(endpoint, headers=headers, json=body, timeout=timeout)
            if response.status_code >= 400:
                raise RuntimeError(f"LLM HTTP {response.status_code}: {response.text[:500]}")
            print(extractor(response.json()))
            return
        except (httpx.HTTPError, RuntimeError, ValueError, KeyError) as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(0.5 * (2**attempt))
    raise RuntimeError(str(last_error or "LLM bridge failed"))


def _run_agnes(request: dict[str, Any]) -> None:
    api_key = os.getenv("AGNES_API_KEY") or os.getenv("ARK_API_KEY")
    if not api_key:
        raise RuntimeError("Missing server-side AGNES_API_KEY for agnes provider")
    endpoint = (
        os.getenv("AGNES_CHAT_ENDPOINT")
        or "https://apihub.agnes-ai.com/v1/chat/completions"
    )
    text = _combined_prompt(request)
    content: list[dict[str, Any]] = [{"type": "text", "text": text}]
    for raw_path in request.get("imagePaths") or []:
        data_url = _image_data_url(raw_path)
        if data_url:
            content.append({"type": "image_url", "image_url": {"url": data_url}})
    has_image = len(content) > 1
    # Agnes 走 OpenAI 兼容 chat/completions。纯文本时把 content 折叠成字符串,
    # 兼容不支持多模态数组格式的文本模型。
    message_content: Any = content if has_image else text
    model = (
        request.get("agnesModel")
        or os.getenv("AGNES_CHAT_MODEL")
        or "agnes-2.0-flash"
    )
    body: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": message_content}],
        "temperature": float(request.get("temperature") or 0),
    }
    max_tokens = os.getenv("AGNES_CHAT_MAX_TOKENS")
    if max_tokens:
        body["max_tokens"] = int(max_tokens)
    timeout = float(request.get("timeoutSeconds") or 180)
    attempts = int(request.get("maxRetries") or 0) + 1
    _post_with_retries(
        endpoint,
        {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        body,
        timeout=timeout,
        attempts=attempts,
        extractor=_extract_openai_text,
    )


def _run_doubao(request: dict[str, Any]) -> None:
    api_key = os.getenv("ARK_API_KEY") or os.getenv("DOUBAO_API_KEY")
    if not api_key:
        raise RuntimeError("Missing server-side ARK_API_KEY")
    content: list[dict[str, Any]] = [{"type": "input_text", "text": _combined_prompt(request)}]
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
        "temperature": float(request.get("temperature") or 0),
    }
    timeout = float(request.get("timeoutSeconds") or 180)
    attempts = int(request.get("maxRetries") or 0) + 1
    _post_with_retries(
        request["endpoint"],
        {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        body,
        timeout=timeout,
        attempts=attempts,
        extractor=_extract_text,
    )


def _extract_openai_text(payload: dict[str, Any]) -> str:
    choices = payload.get("choices") or []
    if choices and isinstance(choices[0], dict):
        message = choices[0].get("message") or {}
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            return content
        if isinstance(content, list):
            parts = [c.get("text") for c in content if isinstance(c, dict) and isinstance(c.get("text"), str)]
            if parts:
                return "\n".join(parts)
    raise RuntimeError("Agnes response contained no text")


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
