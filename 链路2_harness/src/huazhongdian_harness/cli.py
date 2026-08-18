from __future__ import annotations

import argparse
import sys
from dataclasses import asdict
from pathlib import Path

from .evaluator import judge_harness
from .providers import provider_from_name
from .preprocessing import PreprocessingConfig, preprocess_manifest
from .reporting import build_report
from .runner import run_harness


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="harness")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run", help="Run selection and card generation")
    run_parser.add_argument("--manifest", required=True, help="Path to videos JSONL manifest")
    run_parser.add_argument("--runs", type=int, default=3, help="Number of repeated runs per case")
    run_parser.add_argument("--out", required=True, help="Output run directory")
    run_parser.add_argument(
        "--provider",
        choices=["doubao", "mock"],
        default="doubao",
        help="LLM provider to use",
    )

    judge_parser = subparsers.add_parser("judge", help="Evaluate a harness run")
    judge_parser.add_argument("--run", required=True, help="Run directory created by `harness run`")
    judge_parser.add_argument(
        "--provider",
        choices=["doubao", "mock"],
        default="doubao",
        help="LLM provider to use for judging",
    )

    report_parser = subparsers.add_parser("report", help="Build a Markdown report")
    report_parser.add_argument("--run", required=True, help="Run directory after `harness judge`")

    preprocess_parser = subparsers.add_parser(
        "preprocess", help="Build shared ASR/OCR timelines for chain 1 and chain 2"
    )
    preprocess_parser.add_argument("--manifest", required=True, help="Path to videos JSONL manifest")
    preprocess_parser.add_argument("--out", required=True, help="Output preprocessing directory")
    preprocess_parser.add_argument(
        "--asr-model",
        default=None,
        help="faster-whisper model size; defaults to VIDEO_ASR_MODEL_SIZE or base",
    )
    preprocess_parser.add_argument(
        "--chunk-seconds", type=float, default=None, help="Long-video analysis chunk size"
    )
    preprocess_parser.add_argument(
        "--chunk-overlap-seconds", type=float, default=None, help="Long-video chunk overlap"
    )
    preprocess_parser.add_argument(
        "--no-ocr", action="store_true", help="Disable selective OCR and keyframe extraction"
    )

    args = parser.parse_args(argv)
    try:
        if args.command == "run":
            provider = provider_from_name(args.provider)
            run_harness(
                manifest_path=Path(args.manifest),
                runs=args.runs,
                out_dir=Path(args.out),
                provider=provider,
            )
            print(f"Run written to {Path(args.out).expanduser().resolve()}")
        elif args.command == "judge":
            provider = provider_from_name(args.provider)
            summary = judge_harness(run_dir=Path(args.run), provider=provider)
            print(
                "Judged {case_count} cases: {passed_count} passed, {failed_count} failed".format(
                    **summary
                )
            )
        elif args.command == "report":
            report_path = build_report(run_dir=Path(args.run))
            print(f"Report written to {report_path}")
        elif args.command == "preprocess":
            defaults = PreprocessingConfig.from_environment()
            config = PreprocessingConfig(
                **{
                    **asdict(defaults),
                    **({"asr_model_size": args.asr_model} if args.asr_model else {}),
                    **(
                        {"analysis_chunk_seconds": args.chunk_seconds}
                        if args.chunk_seconds is not None
                        else {}
                    ),
                    **(
                        {"analysis_chunk_overlap_seconds": args.chunk_overlap_seconds}
                        if args.chunk_overlap_seconds is not None
                        else {}
                    ),
                    **({"ocr_enabled": False} if args.no_ocr else {}),
                }
            )
            summary = preprocess_manifest(
                manifest_path=Path(args.manifest),
                out_dir=Path(args.out),
                config=config,
            )
            print(f"Preprocessed {len(summary['cases'])} cases")
            print(f"Generated manifest: {summary['generatedManifestPath']}")
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
