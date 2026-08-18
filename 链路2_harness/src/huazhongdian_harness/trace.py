from __future__ import annotations

import json
import time
import traceback
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .models import to_jsonable


class TraceRecorder:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def tool(
        self,
        name: str,
        *,
        input_summary: dict[str, Any] | None = None,
        output_path: str | Path | None = None,
    ) -> Iterator[None]:
        started_at = datetime.now(timezone.utc)
        started = time.perf_counter()
        status = "success"
        error: dict[str, str] | None = None
        try:
            yield
        except Exception as exc:
            status = "error"
            error = {
                "type": exc.__class__.__name__,
                "message": str(exc),
                "traceback": "".join(traceback.format_exception_only(exc.__class__, exc)).strip(),
            }
            raise
        finally:
            ended_at = datetime.now(timezone.utc)
            self.append(
                {
                    "trace_id": uuid.uuid4().hex,
                    "tool": name,
                    "status": status,
                    "started_at": started_at.isoformat(),
                    "ended_at": ended_at.isoformat(),
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                    "input_summary": input_summary or {},
                    "output_path": str(output_path) if output_path is not None else None,
                    "error": error,
                }
            )

    def append(self, event: dict[str, Any]) -> None:
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(to_jsonable(event), ensure_ascii=False) + "\n")
