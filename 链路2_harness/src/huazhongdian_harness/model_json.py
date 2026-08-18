from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Generic, TypeVar

from .models import ModelOutputError

T = TypeVar("T")


@dataclass(frozen=True)
class ParsedModelOutput(Generic[T]):
    value: T
    raw: str
    repair_used: bool = False
    initial_raw: str | None = None
    initial_error: str | None = None


def parse_with_optional_repair(
    *,
    raw: str,
    parser: Callable[[str], T],
    provider: object,
    expected_schema: str,
    stage: str,
) -> ParsedModelOutput[T]:
    try:
        return ParsedModelOutput(value=parser(raw), raw=raw)
    except Exception as exc:
        initial_error = str(exc)

    repair_prompt = f"""
你是 JSON 修复器。请把下面模型输出修复为合法 JSON。

要求：
- 只输出 JSON，不要 markdown，不要解释。
- 不要新增原文没有的业务内容。
- 目标结构：{expected_schema}
- 原始错误：{initial_error}

原始输出：
{raw}
""".strip()
    try:
        repaired = provider.complete(
            system_prompt="你是严格输出 JSON 的 JSON 修复器。",
            user_prompt=repair_prompt,
            temperature=0.0,
        )
    except Exception as exc:
        raise ModelOutputError(f"{stage} JSON parse failed and repair call failed: {exc}") from exc

    try:
        value = parser(repaired)
    except Exception as exc:
        raise ModelOutputError(f"{stage} JSON parse failed after one repair: {exc}") from exc

    return ParsedModelOutput(
        value=value,
        raw=repaired,
        repair_used=True,
        initial_raw=raw,
        initial_error=initial_error,
    )
