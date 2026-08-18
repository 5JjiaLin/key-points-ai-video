#!/usr/bin/env python3
"""Small standard-library client for the 划重点 video Harness."""

from __future__ import annotations

import argparse
import http.client
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any


DEFAULT_API_URL = "http://127.0.0.1:8000"
DEFAULT_CHAIN3_URL = "http://127.0.0.1:8787"
READY_JOB_STATES = {"ready", "ready_with_fallbacks"}
FAILED_JOB_STATES = {"failed"}
QUESTION_READY_STATES = {"awaiting_question", "completed"}
FINAL_RECONSTRUCTION_STATES = {"completed", "needs_review", "failed"}


class HarnessClientError(RuntimeError):
    """A request or Harness lifecycle failure."""


class HarnessClient:
    def __init__(self, base_url: str, timeout_seconds: float = 30.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, Any] | None = None,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        request_headers = {"accept": "application/json", **(headers or {})}
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            request_headers["content-type"] = "application/json; charset=utf-8"
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=body,
            headers=request_headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(detail)
                detail = str(parsed.get("detail") or parsed.get("error") or parsed)
            except json.JSONDecodeError:
                pass
            raise HarnessClientError(f"{method} {path} failed ({exc.code}): {detail}") from exc
        except urllib.error.URLError as exc:
            raise HarnessClientError(
                f"Cannot reach Harness at {self.base_url}: {exc.reason}"
            ) from exc
        if not raw:
            return {}
        try:
            result = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise HarnessClientError(f"{method} {path} returned invalid JSON") from exc
        if not isinstance(result, dict):
            raise HarnessClientError(f"{method} {path} returned a non-object response")
        return result

    def upload(self, source: Path) -> dict[str, Any]:
        if not source.is_file():
            raise HarnessClientError(f"Video file does not exist: {source}")
        boundary = f"----huazhongdian-{uuid.uuid4().hex}"
        content_type = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
        safe_name = source.name.replace('"', "_").replace("\r", "_").replace("\n", "_")
        preamble = (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="file"; '
            f'filename="{safe_name}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8")
        closing = f"\r\n--{boundary}--\r\n".encode("utf-8")
        parsed = urllib.parse.urlsplit(self.base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise HarnessClientError(f"Invalid Harness URL: {self.base_url}")
        connection_type = (
            http.client.HTTPSConnection
            if parsed.scheme == "https"
            else http.client.HTTPConnection
        )
        connection = connection_type(
            parsed.hostname,
            parsed.port,
            timeout=self.timeout_seconds,
        )
        path = f"{parsed.path.rstrip('/')}/api/videos"
        try:
            connection.putrequest("POST", path)
            connection.putheader("accept", "application/json")
            connection.putheader(
                "content-type", f"multipart/form-data; boundary={boundary}"
            )
            connection.putheader(
                "content-length", str(len(preamble) + source.stat().st_size + len(closing))
            )
            connection.endheaders()
            connection.send(preamble)
            with source.open("rb") as handle:
                while chunk := handle.read(1024 * 1024):
                    connection.send(chunk)
            connection.send(closing)
            response = connection.getresponse()
            raw = response.read()
        except OSError as exc:
            raise HarnessClientError(
                f"Cannot upload to Harness at {self.base_url}: {exc}"
            ) from exc
        finally:
            connection.close()
        try:
            result = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise HarnessClientError("POST /api/videos returned invalid JSON") from exc
        if response.status >= 400:
            detail = (
                result.get("detail") or result.get("error")
                if isinstance(result, dict)
                else result
            )
            raise HarnessClientError(
                f"POST /api/videos failed ({response.status}): {detail}"
            )
        if not isinstance(result, dict):
            raise HarnessClientError("POST /api/videos returned a non-object response")
        return result

    def wait_for_job(
        self,
        job_id: str,
        *,
        poll_seconds: float,
        deadline_seconds: float,
    ) -> dict[str, Any]:
        deadline = time.monotonic() + deadline_seconds
        while True:
            status = self.request("GET", f"/api/jobs/{_quote(job_id)}")
            state = str(status.get("state") or "")
            print(
                f"job {job_id}: {state} {status.get('progress', 0)}",
                file=sys.stderr,
            )
            if state in READY_JOB_STATES:
                return status
            if state in FAILED_JOB_STATES:
                raise HarnessClientError(
                    f"Job {job_id} failed: {status.get('error') or status.get('message')}"
                )
            if time.monotonic() >= deadline:
                raise HarnessClientError(f"Timed out waiting for job {job_id}")
            time.sleep(poll_seconds)

    def wait_for_reconstruction(
        self,
        analysis_id: str,
        *,
        desired_states: set[str],
        poll_seconds: float,
        deadline_seconds: float,
    ) -> dict[str, Any]:
        deadline = time.monotonic() + deadline_seconds
        while True:
            status = self.request(
                "GET", f"/api/reconstructions/{_quote(analysis_id)}"
            )
            state = str(status.get("status") or "")
            print(
                f"analysis {analysis_id}: {state} {status.get('progress', 0)}",
                file=sys.stderr,
            )
            if state in desired_states:
                if state in {"failed", "needs_review"}:
                    raise HarnessClientError(
                        f"Reconstruction {analysis_id} stopped in {state}: "
                        f"{status.get('error') or 'review required'}"
                    )
                return status
            if time.monotonic() >= deadline:
                raise HarnessClientError(
                    f"Timed out waiting for reconstruction {analysis_id}"
                )
            time.sleep(poll_seconds)


def _quote(value: str) -> str:
    return urllib.parse.quote(value, safe="")


def _deep_health(chain3_url: str, timeout_seconds: float) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{chain3_url.rstrip('/')}/health",
        headers={"accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            body = json.loads(response.read())
    except (urllib.error.URLError, json.JSONDecodeError) as exc:
        raise HarnessClientError(
            f"Cannot reach chain 3 Harness at {chain3_url}: {exc}"
        ) from exc
    if not isinstance(body, dict):
        raise HarnessClientError("Chain 3 health response is invalid")
    return body


def _finish_created_job(
    client: HarnessClient,
    created: dict[str, Any],
    args: argparse.Namespace,
) -> dict[str, Any]:
    job_id = str(created["jobId"])
    if args.wait or args.add_to_pool:
        client.wait_for_job(
            job_id,
            poll_seconds=args.poll_seconds,
            deadline_seconds=args.deadline_seconds,
        )
        result = client.request("GET", f"/api/jobs/{_quote(job_id)}/result")
    else:
        return created
    if args.add_to_pool:
        pool = client.request(
            "POST", "/api/knowledge-pool/items", payload={"jobId": job_id}
        )
        return {"jobId": job_id, "result": result, "knowledgePool": pool}
    return result


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Call the 划重点 unified video Harness."
    )
    parser.add_argument(
        "--api-url",
        default=os.getenv("HARNESS_API_URL", DEFAULT_API_URL),
        help="Backend API URL (default: HARNESS_API_URL or %(default)s)",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=30,
        help="HTTP request timeout",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    health = subparsers.add_parser("health", help="Check service health")
    health.add_argument("--deep", action="store_true", help="Also check chain 3")
    health.add_argument(
        "--chain3-url",
        default=os.getenv("CHAIN3_HARNESS_URL", DEFAULT_CHAIN3_URL),
    )

    for name, help_text in (
        ("upload", "Upload a local video"),
        ("douyin", "Import a public Douyin URL or copied share text"),
    ):
        command = subparsers.add_parser(name, help=help_text)
        command.add_argument("source")
        command.add_argument("--wait", action="store_true")
        command.add_argument("--add-to-pool", action="store_true")
        _add_wait_options(command)

    job = subparsers.add_parser("job", help="Read job status")
    job.add_argument("job_id")
    result = subparsers.add_parser("result", help="Read completed video result")
    result.add_argument("job_id")

    subparsers.add_parser("pool", help="List the knowledge pool")
    pool_add = subparsers.add_parser("pool-add", help="Add a completed job")
    pool_add.add_argument("job_id")
    pool_remove = subparsers.add_parser("pool-remove", help="Remove a pool item")
    pool_remove.add_argument("job_id")

    reconstruct = subparsers.add_parser(
        "reconstruct", help="Analyze 3-10 pooled videos"
    )
    reconstruct.add_argument("video_ids", nargs="+")
    reconstruct.add_argument(
        "--mode",
        choices=("auto", "single_creator_series", "multi_creator_topic"),
        default="auto",
    )
    reconstruct.add_argument("--theme")
    reconstruct.add_argument("--wait", action="store_true")
    _add_wait_options(reconstruct)

    reconstruction = subparsers.add_parser(
        "reconstruction", help="Read reconstruction status"
    )
    reconstruction.add_argument("analysis_id")
    reconstruction_result = subparsers.add_parser(
        "reconstruction-result", help="Read recommendations or final path"
    )
    reconstruction_result.add_argument("analysis_id")

    build_path = subparsers.add_parser(
        "build-path", help="Build a path from a confirmed research question"
    )
    build_path.add_argument("analysis_id")
    build_path.add_argument("research_question")
    build_path.add_argument("--wait", action="store_true")
    _add_wait_options(build_path)
    return parser


def _add_wait_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--poll-seconds", type=float, default=2)
    parser.add_argument("--deadline-seconds", type=float, default=900)


def _run(args: argparse.Namespace) -> dict[str, Any]:
    client = HarnessClient(args.api_url, timeout_seconds=args.timeout_seconds)
    if args.command == "health":
        result = {"backend": client.request("GET", "/api/health")}
        if args.deep:
            result["chain3"] = _deep_health(args.chain3_url, args.timeout_seconds)
        return result
    if args.command == "upload":
        return _finish_created_job(client, client.upload(Path(args.source)), args)
    if args.command == "douyin":
        created = client.request(
            "POST", "/api/videos/from-douyin", payload={"url": args.source}
        )
        return _finish_created_job(client, created, args)
    if args.command == "job":
        return client.request("GET", f"/api/jobs/{_quote(args.job_id)}")
    if args.command == "result":
        return client.request("GET", f"/api/jobs/{_quote(args.job_id)}/result")
    if args.command == "pool":
        return client.request("GET", "/api/knowledge-pool")
    if args.command == "pool-add":
        return client.request(
            "POST", "/api/knowledge-pool/items", payload={"jobId": args.job_id}
        )
    if args.command == "pool-remove":
        client.request(
            "DELETE", f"/api/knowledge-pool/items/{_quote(args.job_id)}"
        )
        return {"jobId": args.job_id, "removed": True}
    if args.command == "reconstruct":
        created = client.request(
            "POST",
            "/api/reconstructions",
            payload={
                "videoIds": args.video_ids,
                "requestedAnalysisMode": args.mode,
                "themeHint": args.theme,
            },
        )
        if not args.wait:
            return created
        status = client.wait_for_reconstruction(
            str(created["analysisId"]),
            desired_states=QUESTION_READY_STATES | {"failed", "needs_review"},
            poll_seconds=args.poll_seconds,
            deadline_seconds=args.deadline_seconds,
        )
        result = client.request(
            "GET",
            f"/api/reconstructions/{_quote(str(created['analysisId']))}/result",
        )
        return {"status": status, "result": result}
    if args.command == "reconstruction":
        return client.request(
            "GET", f"/api/reconstructions/{_quote(args.analysis_id)}"
        )
    if args.command == "reconstruction-result":
        return client.request(
            "GET", f"/api/reconstructions/{_quote(args.analysis_id)}/result"
        )
    if args.command == "build-path":
        started = client.request(
            "POST",
            f"/api/reconstructions/{_quote(args.analysis_id)}/path",
            payload={"researchQuestion": args.research_question},
        )
        if not args.wait:
            return started
        status = client.wait_for_reconstruction(
            args.analysis_id,
            desired_states=FINAL_RECONSTRUCTION_STATES,
            poll_seconds=args.poll_seconds,
            deadline_seconds=args.deadline_seconds,
        )
        result = client.request(
            "GET", f"/api/reconstructions/{_quote(args.analysis_id)}/result"
        )
        return {"status": status, "result": result}
    raise HarnessClientError(f"Unsupported command: {args.command}")


def main() -> int:
    args = _build_parser().parse_args()
    try:
        result = _run(args)
    except (HarnessClientError, KeyError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
