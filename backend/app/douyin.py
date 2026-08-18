from __future__ import annotations

import json
import mimetypes
import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx


DOUYIN_HOSTS = {"douyin.com", "iesdouyin.com"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm"}
TRAILING_SHARE_PUNCTUATION = "。，,;；！!？?）)]}>\"'"
MOBILE_USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 Mobile/15E148"
)


class DouyinDownloadError(RuntimeError):
    pass


def extract_douyin_url(source_text: str) -> str:
    text = str(source_text or "").strip()
    match = re.search(r"https?://[^\s]+", text)
    candidate = (match.group(0) if match else text).rstrip(TRAILING_SHARE_PUNCTUATION)
    parsed = urlparse(candidate)
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme not in {"http", "https"} or not any(
        host == allowed or host.endswith(f".{allowed}") for allowed in DOUYIN_HOSTS
    ):
        raise ValueError("请输入有效的抖音视频链接或包含链接的分享文案")
    return candidate


def parse_public_share_page(html: str) -> dict[str, Any]:
    match = re.search(r"window\._ROUTER_DATA\s*=\s*(\{.*?\})</script>", html, re.DOTALL)
    if not match:
        raise DouyinDownloadError("抖音公开分享页缺少视频数据")
    try:
        payload = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        raise DouyinDownloadError("抖音公开分享页数据无法解析") from exc

    loader_data = payload.get("loaderData") if isinstance(payload, dict) else None
    if not isinstance(loader_data, dict):
        raise DouyinDownloadError("抖音公开分享页没有视频载荷")
    for entry in loader_data.values():
        if not isinstance(entry, dict):
            continue
        video_info = entry.get("videoInfoRes")
        items = video_info.get("item_list") if isinstance(video_info, dict) else None
        if isinstance(items, list) and items and isinstance(items[0], dict):
            return items[0]
    raise DouyinDownloadError("抖音公开分享页没有可处理的视频")


def _extract_aweme_id(url: str, html: str = "") -> str:
    for source in (url, html):
        match = re.search(r"/(?:video|note|aweme/detail)/(\d{15,22})", source)
        if match:
            return match.group(1)
        match = re.search(r'"aweme_id"\s*:\s*"(\d{15,22})"', source)
        if match:
            return match.group(1)
    raise DouyinDownloadError("无法从抖音链接中识别视频 ID")


def _download_public_share_video(url: str, media_dir: Path, max_bytes: int) -> dict[str, Any]:
    headers = {"User-Agent": MOBILE_USER_AGENT, "Referer": "https://www.douyin.com/"}
    timeout = httpx.Timeout(30.0, read=90.0)
    with httpx.Client(headers=headers, follow_redirects=True, timeout=timeout) as client:
        resolved = client.get(url)
        resolved.raise_for_status()
        aweme_id = _extract_aweme_id(str(resolved.url), resolved.text)
        share = client.get(f"https://www.iesdouyin.com/share/video/{aweme_id}/")
        share.raise_for_status()
        item = parse_public_share_page(share.text)
        video = item.get("video")
        play_addr = video.get("play_addr") if isinstance(video, dict) else None
        url_list = play_addr.get("url_list") if isinstance(play_addr, dict) else None
        if not isinstance(url_list, list) or not url_list:
            raise DouyinDownloadError("该抖音内容不是可下载的视频")
        play_url = str(url_list[0]).replace("/playwm/", "/play/")
        target = media_dir / "source.mp4"
        size = 0
        with client.stream("GET", play_url) as response:
            response.raise_for_status()
            declared_size = int(response.headers.get("content-length") or 0)
            if declared_size > max_bytes:
                raise DouyinDownloadError("抖音视频超过500MB限制")
            content_type = response.headers.get("content-type", "").split(";", 1)[0]
            if content_type and not content_type.startswith("video/") and content_type != "application/octet-stream":
                raise DouyinDownloadError("抖音播放地址未返回视频文件")
            with target.open("wb") as handle:
                for chunk in response.iter_bytes(1024 * 1024):
                    size += len(chunk)
                    if size > max_bytes:
                        raise DouyinDownloadError("抖音视频超过500MB限制")
                    handle.write(chunk)
        if size <= 0:
            target.unlink(missing_ok=True)
            raise DouyinDownloadError("下载到的抖音视频为空")
        title = str(item.get("desc") or "抖音视频").strip()
        author = item.get("author") if isinstance(item.get("author"), dict) else {}
        creator = str(author.get("nickname") or author.get("unique_id") or "抖音创作者").strip()
        return {
            "path": target,
            "url": url,
            "title": title[:120] or "抖音视频",
            "creator": creator[:80] or "抖音创作者",
            "contentType": "video/mp4",
            "sizeBytes": size,
        }


def download_douyin_video(source_text: str, media_dir: Path, max_bytes: int) -> dict[str, Any]:
    url = extract_douyin_url(source_text)
    media_dir.mkdir(parents=True, exist_ok=True)
    try:
        return _download_public_share_video(url, media_dir, max_bytes)
    except (DouyinDownloadError, httpx.HTTPError, ValueError) as public_error:
        (media_dir / "source.mp4").unlink(missing_ok=True)

    try:
        import yt_dlp
    except ImportError as exc:
        raise DouyinDownloadError("服务器缺少抖音视频下载组件") from exc

    cookie_path = os.getenv("DOUYIN_COOKIES_PATH", "").strip()
    if cookie_path and not Path(cookie_path).expanduser().is_file():
        raise DouyinDownloadError("服务器配置的抖音 Cookies 文件不存在")

    options: dict[str, Any] = {
        "format": "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
        "merge_output_format": "mp4",
        "outtmpl": str(media_dir / "source.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 30,
        "retries": 3,
        "fragment_retries": 3,
        "max_filesize": max_bytes,
        "http_headers": {"Referer": "https://www.douyin.com/"},
    }
    if cookie_path:
        options["cookiefile"] = str(Path(cookie_path).expanduser().resolve())

    try:
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(url, download=True)
    except Exception as exc:
        message = str(exc).strip().splitlines()[-1] if str(exc).strip() else "未知错误"
        raise DouyinDownloadError(
            f"抖音视频下载失败：{message[:180]}。"
            f"公开分享页解析也失败：{str(public_error)[:140]}。"
            "受限视频需要更新 DOUYIN_COOKIES_PATH。"
        ) from exc

    candidates = sorted(
        path
        for path in media_dir.glob("source.*")
        if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS
    )
    if not candidates:
        raise DouyinDownloadError("抖音链接已解析，但没有获得可处理的视频文件")
    media_path = candidates[0]
    size = media_path.stat().st_size
    if size <= 0:
        media_path.unlink(missing_ok=True)
        raise DouyinDownloadError("下载到的抖音视频为空")
    if size > max_bytes:
        media_path.unlink(missing_ok=True)
        raise DouyinDownloadError("抖音视频超过500MB限制")

    title = str((info or {}).get("title") or (info or {}).get("description") or "抖音视频").strip()
    creator = str(
        (info or {}).get("uploader")
        or (info or {}).get("channel")
        or (info or {}).get("creator")
        or "抖音创作者"
    ).strip()
    content_type = mimetypes.guess_type(media_path.name)[0] or "video/mp4"
    return {
        "path": media_path,
        "url": url,
        "title": title[:120] or "抖音视频",
        "creator": creator[:80] or "抖音创作者",
        "contentType": content_type,
        "sizeBytes": size,
    }
