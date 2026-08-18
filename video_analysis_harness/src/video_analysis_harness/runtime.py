from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

from huazhongdian_harness.environment_analysis import analyze_environment
from huazhongdian_harness.providers import provider_from_name
from video_pipeline import PreprocessingConfig, VideoSource, preprocess_video

from .models import VideoAnalysisRequest
from .orchestrator import ProgressCallback, VideoAnalysisHarness


class SharedVideoPreprocessor:
    def run(
        self,
        request: VideoAnalysisRequest,
        run_dir: Path,
        progress: ProgressCallback | None,
    ) -> dict[str, Any]:
        return preprocess_video(
            source=VideoSource(
                video_id=request.video_id,
                path=request.source_path,
                title=request.title,
                creator=request.creator,
            ),
            out_dir=run_dir / "evidence",
            config=PreprocessingConfig.from_environment(),
            progress=progress,
        )


class Chain1NodeRunner:
    def __init__(self, repo_root: Path) -> None:
        self.repo_root = repo_root.expanduser().resolve()

    def run(
        self,
        environment_path: Path,
        run_dir: Path,
        _progress: ProgressCallback | None,
    ) -> dict[str, Any]:
        chain1_dir = self.repo_root / "链路1_harness"
        entrypoint = chain1_dir / "dist" / "run-environment.js"
        if not entrypoint.is_file():
            raise RuntimeError("chain1 is not built; run npm run build in 链路1_harness")
        output = run_dir / "chain1" / "result.json"
        output.parent.mkdir(parents=True, exist_ok=True)
        environment = dict(os.environ)
        environment["CHAIN1_TRACE_DIR"] = str(run_dir / "chain1" / "traces")
        environment["CHAIN1_ASSET_DIR"] = str(run_dir / "media" / "cards")
        completed = subprocess.run(
            ["node", str(entrypoint), str(environment_path), str(output)],
            cwd=chain1_dir,
            env=environment,
            capture_output=True,
            text=True,
            timeout=int(os.getenv("CHAIN1_SUBPROCESS_TIMEOUT_SECONDS", "5400")),
        )
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout)[-500:]
            raise RuntimeError(f"chain1 failed: {detail}")
        return json.loads(output.read_text(encoding="utf-8"))


class Chain2PythonRunner:
    def __init__(self, provider_name: str) -> None:
        self.provider = provider_from_name(provider_name)

    def run(
        self,
        environment_path: Path,
        run_dir: Path,
        progress: ProgressCallback | None,
    ) -> dict[str, Any]:
        return analyze_environment(
            environment_path=environment_path,
            out_dir=run_dir / "chain2",
            provider=self.provider,
            progress=progress,
        )


def create_default_harness(*, repo_root: Path, chain2_provider: str) -> VideoAnalysisHarness:
    return VideoAnalysisHarness(
        preprocessor=SharedVideoPreprocessor(),
        understanding_supplements=Chain1NodeRunner(repo_root),
        knowledge_navigation=Chain2PythonRunner(chain2_provider),
    )
