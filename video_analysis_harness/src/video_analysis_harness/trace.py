from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class RootTrace:
    def __init__(self, path: Path) -> None:
        self.path = path.expanduser().resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.unlink(missing_ok=True)

    def append(self, event: dict[str, Any]) -> None:
        record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **event,
        }
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
