from __future__ import annotations

import json
from typing import Any

from .models import ModelOutputError


def strip_markdown_fences(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        first_newline = text.find("\n")
        if first_newline != -1:
            text = text[first_newline + 1 :]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def parse_json_object(raw: str) -> dict[str, Any] | list[Any]:
    cleaned = strip_markdown_fences(raw)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        parsed = _parse_embedded_json(cleaned)

    if not isinstance(parsed, dict | list):
        raise ModelOutputError("Model output must be a JSON object or array")
    return parsed


def _parse_embedded_json(text: str) -> dict[str, Any] | list[Any]:
    starts = [idx for idx in (text.find("{"), text.find("[")) if idx >= 0]
    if not starts:
        raise ModelOutputError("No JSON object or array found in model output")
    start = min(starts)
    end = max(text.rfind("}"), text.rfind("]"))
    if end <= start:
        raise ModelOutputError("No complete JSON object or array found in model output")
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise ModelOutputError("Invalid JSON in model output") from exc
