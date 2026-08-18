from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

import httpx

from .models import HarnessError, VideoFrame

_DOTENV_LOADED = False


class LLMProvider(Protocol):
    def complete(self, *, system_prompt: str, user_prompt: str, temperature: float) -> str:
        """Return the model's message content."""

    def complete_with_video(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        video_data_url: str,
        video_fps: float,
        temperature: float,
    ) -> str:
        """Return the model's message content for a video + text prompt."""

    def complete_with_frames(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        frames: list[VideoFrame],
        temperature: float,
    ) -> str:
        """Return the model's message content for sampled frames + text."""

    def complete_with_file(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        video_path: Path,
        temperature: float,
    ) -> str:
        """Return the model's message content for an uploaded file + text prompt."""


@dataclass
class DoubaoProvider:
    api_key: str | None = None
    endpoint: str | None = None
    model: str | None = None
    timeout_seconds: float = 90
    frame_timeout_seconds: float | None = None
    use_response_format: bool = True
    _file_upload_cache: dict[str, str] = field(default_factory=dict)

    def complete(self, *, system_prompt: str, user_prompt: str, temperature: float) -> str:
        endpoint = self._endpoint()
        if _uses_responses_api(endpoint):
            return self._complete_responses(
                endpoint=endpoint,
                content=[
                    {
                        "type": "input_text",
                        "text": _combined_text_prompt(system_prompt, user_prompt),
                    }
                ],
                temperature=temperature,
            )
        return self._complete_chat(
            endpoint=endpoint,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
        )

    def complete_with_video(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        video_data_url: str,
        video_fps: float,
        temperature: float,
    ) -> str:
        endpoint = self._endpoint()
        if _uses_responses_api(endpoint):
            return self._complete_responses(
                endpoint=endpoint,
                content=[
                    {
                        "type": "input_video",
                        "video_url": video_data_url,
                        "fps": video_fps,
                    },
                    {
                        "type": "input_text",
                        "text": _combined_text_prompt(system_prompt, user_prompt),
                    },
                ],
                temperature=temperature,
            )
        return self._complete_chat(
            endpoint=endpoint,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "video_url",
                            "video_url": {
                                "url": video_data_url,
                                "fps": video_fps,
                            },
                        },
                        {"type": "text", "text": user_prompt},
                    ],
                },
            ],
            temperature=temperature,
        )

    def complete_with_frames(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        frames: list[VideoFrame],
        temperature: float,
    ) -> str:
        endpoint = self._endpoint()
        frame_items = _frame_content_items(
            frames=frames,
            text_type="input_text" if _uses_responses_api(endpoint) else "text",
            image_type="input_image" if _uses_responses_api(endpoint) else "image_url",
            image_url_key="image_url",
        )
        if _uses_responses_api(endpoint):
            content = [
                {
                    "type": "input_text",
                    "text": _combined_text_prompt(system_prompt, user_prompt),
                }
            ] + frame_items
            return self._complete_responses(
                endpoint=endpoint,
                content=content,
                temperature=temperature,
                timeout_seconds=self._frame_timeout(),
            )

        content = [{"type": "text", "text": user_prompt}] + frame_items
        return self._complete_chat(
            endpoint=endpoint,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": content},
            ],
            temperature=temperature,
            timeout_seconds=self._frame_timeout(),
        )

    def complete_with_file(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        video_path: Path,
        temperature: float,
    ) -> str:
        endpoint = self._endpoint()
        if not _uses_responses_api(endpoint):
            raise HarnessError("Doubao File API mode requires the Responses API endpoint")
        file_id = self.upload_file(video_path)
        content = [
            {
                "type": "input_text",
                "text": _combined_text_prompt(system_prompt, user_prompt),
            },
            _file_content_item(file_id),
        ]
        attempts = _file_ready_retries()
        for attempt in range(attempts):
            try:
                return self._complete_responses(
                    endpoint=endpoint,
                    content=content,
                    temperature=temperature,
                )
            except HarnessError as exc:
                if "invalid state: processing" not in str(exc).lower() or attempt == attempts - 1:
                    raise
                time.sleep(_file_ready_retry_delay())
        raise HarnessError("Doubao File API request failed after retries")

    def upload_file(self, file_path: Path) -> str:
        resolved = str(file_path.expanduser().resolve())
        cached = self._file_upload_cache.get(resolved)
        if cached:
            return cached

        endpoint = self._files_endpoint()
        api_key = self._api_key()
        purpose = self._file_purpose()
        try:
            with Path(resolved).open("rb") as handle:
                response = httpx.post(
                    endpoint,
                    headers={"Authorization": f"Bearer {api_key}"},
                    data={"purpose": purpose},
                    files={"file": (Path(resolved).name, handle)},
                    timeout=self.timeout_seconds,
                )
        except httpx.HTTPError as exc:
            raise HarnessError(f"Doubao file upload failed: {exc}") from exc

        if response.status_code >= 400:
            raise HarnessError(f"Doubao file upload HTTP {response.status_code}: {response.text[:500]}")

        try:
            decoded = response.json()
        except json.JSONDecodeError as exc:
            raise HarnessError("Doubao file upload response is not valid JSON") from exc
        file_id = _extract_file_id(decoded)
        self._file_upload_cache[resolved] = file_id
        return file_id

    def _api_key(self) -> str:
        _load_dotenv_once()
        api_key = self.api_key or os.getenv("ARK_API_KEY") or os.getenv("DOUBAO_API_KEY", "")
        if not api_key:
            raise HarnessError("DOUBAO_API_KEY or ARK_API_KEY is required for the doubao provider")
        return api_key

    def _endpoint(self) -> str:
        _load_dotenv_once()
        return self.endpoint or os.getenv(
            "DOUBAO_ENDPOINT",
            "https://ark.cn-beijing.volces.com/api/v3/responses",
        )

    def _model(self) -> str:
        _load_dotenv_once()
        return self.model or os.getenv("ARK_API_ENDPOINT_ID") or os.getenv("DOUBAO_MODEL", "doubao-seed-2-0-pro")

    def _files_endpoint(self) -> str:
        _load_dotenv_once()
        configured = os.getenv("ARK_FILES_ENDPOINT") or os.getenv("DOUBAO_FILES_ENDPOINT")
        if configured:
            return configured
        endpoint = self._endpoint().rstrip("/")
        if endpoint.endswith("/responses"):
            return endpoint[: -len("/responses")] + "/files"
        return "https://ark.cn-beijing.volces.com/api/v3/files"

    def _file_purpose(self) -> str:
        _load_dotenv_once()
        return os.getenv("ARK_FILE_PURPOSE") or os.getenv("DOUBAO_FILE_PURPOSE") or "user_data"

    def _complete_responses(
        self,
        *,
        endpoint: str,
        content: list[dict],
        temperature: float,
        timeout_seconds: float | None = None,
    ) -> str:
        body = {
            "model": self._model(),
            "input": [
                {
                    "role": "user",
                    "content": content,
                }
            ],
            "temperature": temperature,
        }
        decoded = self._post_json(
            endpoint,
            self._api_key(),
            body,
            include_response_format=False,
            timeout_seconds=timeout_seconds,
        )
        return _extract_responses_content(decoded)

    def _complete_chat(
        self,
        *,
        endpoint: str,
        messages: list[dict],
        temperature: float,
        timeout_seconds: float | None = None,
    ) -> str:
        body = {
            "model": self._model(),
            "messages": messages,
            "temperature": temperature,
        }

        decoded = self._post_json(
            endpoint,
            self._api_key(),
            body,
            include_response_format=self.use_response_format,
            timeout_seconds=timeout_seconds,
        )
        return _extract_chat_content(decoded)

    def _complete_messages(self, *, messages: list[dict], temperature: float) -> str:
        body = {
            "model": self._model(),
            "messages": messages,
            "temperature": temperature,
        }

        decoded = self._post_json(
            self._endpoint(),
            self._api_key(),
            body,
            include_response_format=self.use_response_format,
        )
        return _extract_chat_content(decoded)

    def _post_json(
        self,
        endpoint: str,
        api_key: str,
        body: dict,
        *,
        include_response_format: bool,
        timeout_seconds: float | None = None,
    ) -> dict:
        request_body = dict(body)
        if include_response_format:
            request_body["response_format"] = {"type": "json_object"}
        try:
            response = httpx.post(
                endpoint,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=request_body,
                timeout=timeout_seconds or self.timeout_seconds,
            )
        except httpx.HTTPError as exc:
            raise HarnessError(f"Doubao request failed: {exc}") from exc

        if response.status_code >= 400:
            body_text = response.text
            if include_response_format and _is_response_format_unsupported(body_text):
                return self._post_json(
                    endpoint,
                    api_key,
                    body,
                    include_response_format=False,
                    timeout_seconds=timeout_seconds,
                )
            raise HarnessError(f"Doubao HTTP {response.status_code}: {body_text[:500]}")

        try:
            decoded = response.json()
        except json.JSONDecodeError as exc:
            raise HarnessError("Doubao response is not valid JSON") from exc
        if not isinstance(decoded, dict):
            raise HarnessError("Doubao response root is not an object")
        return decoded

    def _frame_timeout(self) -> float:
        _load_dotenv_once()
        configured = self.frame_timeout_seconds or float(os.getenv("ARK_FRAME_TIMEOUT_SECONDS", "20"))
        return min(configured, self.timeout_seconds)


def _is_response_format_unsupported(body_text: str) -> bool:
    return "response_format" in body_text and (
        "not supported" in body_text
        or "not valid" in body_text
        or "InvalidParameter" in body_text
    )


def _uses_responses_api(endpoint: str) -> bool:
    return endpoint.rstrip("/").endswith("/responses")


def _load_dotenv_once() -> None:
    global _DOTENV_LOADED
    if _DOTENV_LOADED:
        return
    _DOTENV_LOADED = True
    for path in _dotenv_candidates():
        if path.exists():
            _load_dotenv_file(path)
            return


def _dotenv_candidates() -> list[Path]:
    candidates: list[Path] = []
    for root in [Path.cwd(), *Path.cwd().parents]:
        candidates.append(root / ".env")
    return candidates


def _load_dotenv_file(path: Path) -> None:
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def _combined_text_prompt(system_prompt: str, user_prompt: str) -> str:
    return f"系统指令：\n{system_prompt}\n\n用户任务：\n{user_prompt}"


def _extract_chat_content(decoded: dict) -> str:
    choices = decoded.get("choices")
    if not isinstance(choices, list) or not choices:
        raise HarnessError("Doubao response has no choices")
    message = choices[0].get("message", {})
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise HarnessError("Doubao response content is empty")
    return content


def _extract_responses_content(decoded: dict) -> str:
    output_text = decoded.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text

    output = decoded.get("output")
    if isinstance(output, list):
        text_parts: list[str] = []
        for item in output:
            if not isinstance(item, dict):
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for part in content:
                if not isinstance(part, dict):
                    continue
                text = part.get("text")
                if isinstance(text, str) and text.strip():
                    text_parts.append(text)
        if text_parts:
            return "\n".join(text_parts)

    raise HarnessError("Doubao responses content is empty")


def _extract_file_id(decoded: dict) -> str:
    for key in ["id", "file_id"]:
        value = decoded.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    data = decoded.get("data")
    if isinstance(data, dict):
        for key in ["id", "file_id"]:
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    raise HarnessError("Doubao file upload response has no file id")


def _file_content_item(file_id: str) -> dict:
    _load_dotenv_once()
    input_type = os.getenv("ARK_FILE_INPUT_TYPE") or os.getenv("DOUBAO_FILE_INPUT_TYPE") or "input_video"
    if input_type == "input_video":
        return {"type": "input_video", "file_id": file_id}
    return {"type": "input_file", "file_id": file_id}


def _file_ready_retries() -> int:
    _load_dotenv_once()
    raw = os.getenv("ARK_FILE_READY_RETRIES") or os.getenv("DOUBAO_FILE_READY_RETRIES") or "8"
    try:
        return max(1, int(raw))
    except ValueError:
        return 8


def _file_ready_retry_delay() -> float:
    _load_dotenv_once()
    raw = os.getenv("ARK_FILE_READY_RETRY_DELAY_SECONDS") or os.getenv(
        "DOUBAO_FILE_READY_RETRY_DELAY_SECONDS"
    ) or "5"
    try:
        return max(0.0, float(raw))
    except ValueError:
        return 5.0


def _frame_content_items(
    *,
    frames: list[VideoFrame],
    text_type: str,
    image_type: str,
    image_url_key: str,
) -> list[dict]:
    if not frames:
        raise HarnessError("frame input is empty")
    content: list[dict] = []
    total = len(frames)
    for index, frame in enumerate(frames, start=1):
        content.append(
            {
                "type": text_type,
                "text": (
                    f"【时序关键画面 {index}/{total} · "
                    f"时间戳: {_format_timestamp(frame.timestamp_seconds)}】"
                ),
            }
        )
        if image_type == "image_url":
            content.append(
                {
                    "type": image_type,
                    image_url_key: {"url": frame.image_data_url},
                }
            )
        else:
            content.append(
                {
                    "type": image_type,
                    image_url_key: frame.image_data_url,
                }
            )
    return content


def _format_timestamp(seconds: float) -> str:
    total = max(0, int(seconds))
    hours = total // 3600
    minutes = (total % 3600) // 60
    secs = total % 60
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


@dataclass
class MockProvider:
    """Deterministic provider for local harness smoke tests."""

    responses: list[str] = field(default_factory=list)
    knowledge_point_count: int = 3

    def complete_with_frames(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        frames: list[VideoFrame],
        temperature: float,
    ) -> str:
        return self.complete(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=temperature,
        )

    def complete_with_file(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        video_path: Path,
        temperature: float,
    ) -> str:
        return self.complete(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=temperature,
        )

    def complete(self, *, system_prompt: str, user_prompt: str, temperature: float) -> str:
        if self.responses:
            return self.responses.pop(0)
        if "JSON 修复器" in system_prompt or "JSON 修复器" in user_prompt:
            return _repair_mock_json(user_prompt)
        if "视频粗分模型" in user_prompt or "is_science_candidate" in user_prompt:
            title_line = next(
                (line for line in user_prompt.splitlines() if line.strip().startswith("- title:")),
                "",
            )
            is_science = not any(term in title_line for term in ["非科普", "娱乐", "舞蹈", "搞笑"])
            return json.dumps(
                {
                    "is_science_candidate": is_science,
                    "category": "健康科普" if is_science else "娱乐",
                    "confidence": 0.9,
                    "reason": (
                        "视频解释了甜饮、果糖和尿酸之间的关系，具备明确知识增量。"
                        if is_science
                        else "视频主要是娱乐内容，没有可抽象成知识点的解释信息。"
                    ),
                    "reject_reason": None if is_science else "非科普/知识型视频",
                },
                ensure_ascii=False,
            )
        if "质量评审模型" in user_prompt or "质量审核模型" in user_prompt:
            candidate_groups = _candidate_groups_from_audit_prompt(user_prompt)
            if candidate_groups:
                return json.dumps(_mock_candidate_group_audit(candidate_groups[0]), ensure_ascii=False)
            return json.dumps(
                {
                    "audit_score_32": 30,
                    "audit_grade": "S",
                    "treatment": "可直接使用",
                    "should_keep": True,
                    "scores": {
                        "knowledge_point_fact_sentence": 2,
                        "knowledge_point_answer_core": 2,
                        "knowledge_point_explanatory_value": 2,
                        "hook_readability": 2,
                        "hook_question_quality": 2,
                        "hook_no_answer_leak": 2,
                        "hook_alignment": 2,
                        "answer_directness": 2,
                        "answer_focus_accuracy": 2,
                        "answer_natural_hook": 2,
                        "qa_pairing": 2,
                        "promise_fulfillment": 2,
                        "boundary_safety": 2,
                        "abstract_concept_quality": 2,
                        "timestamp_quality": 2,
                        "consistency": 2,
                    },
                    "overall_score": 4.6,
                    "main_issues": [],
                    "blocking_reasons": [],
                    "revision_suggestions": {
                        "knowledge_point": None,
                        "hook_question": None,
                        "highlight_answer": None,
                    },
                    "failure_reasons": [],
                },
                ensure_ascii=False,
            )
        if "知识点选择器" in system_prompt or "知识点选择器" in user_prompt:
            return json.dumps(
                {"knowledge_points": _mock_knowledge_points(self.knowledge_point_count)},
                ensure_ascii=False,
            )
        knowledge_points = _knowledge_points_from_generation_prompt(user_prompt)
        if not knowledge_points:
            knowledge_points = _mock_knowledge_points(self.knowledge_point_count)
        return json.dumps(
            {
                "candidate_groups": _mock_candidate_groups(
                    knowledge_points,
                    video_id=_mock_video_id(user_prompt),
                )
            },
            ensure_ascii=False,
        )

    def complete_with_video(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        video_data_url: str,
        video_fps: float,
        temperature: float,
    ) -> str:
        return self.complete(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=temperature,
        )


def provider_from_name(name: str) -> LLMProvider:
    if name == "doubao":
        return DoubaoProvider()
    if name == "mock":
        return MockProvider()
    raise HarnessError(f"Unknown provider: {name}")


def _repair_mock_json(prompt: str) -> str:
    source = prompt.split("原始输出：", 1)[-1]
    start = min([idx for idx in (source.find("{"), source.find("[")) if idx >= 0] or [-1])
    end = max(source.rfind("}"), source.rfind("]"))
    if start >= 0 and end > start:
        return source[start : end + 1]
    return "{}"


_MOCK_KNOWLEDGE_POINT_TEMPLATES = [
    ("甜饮里的果糖可能促进尿酸生成并让尿酸升高。", "原因解释型", "甜饮里的果糖影响尿酸"),
    ("年轻人也可能因为长期饮用含糖饮料而提高痛风风险。", "误区纠正型", "年轻人痛风风险的习惯原因"),
    ("睡前刷短视频会刺激大脑兴奋并推迟入睡时间。", "影响结果型", "睡前刷短视频影响入睡"),
    ("空腹喝咖啡可能刺激胃酸分泌并让心慌更明显。", "原因解释型", "空腹咖啡带来的不适"),
    ("饭后立刻躺下会增加胃内容物反流到食管的机会。", "影响结果型", "饭后躺下导致反流"),
    ("久坐会影响下肢静脉回流并让腿部更容易肿胀。", "过程变化型", "久坐影响下肢回流"),
    ("熬夜会扰乱饥饿激素变化并让人更想吃甜食。", "原因解释型", "熬夜影响饥饿激素"),
    ("喝水不足可能影响血液循环并诱发轻度头痛。", "信号识别型", "喝水不足引发头痛"),
    ("剧烈运动后突然停止会让静脉回流短暂跟不上。", "方法决策型", "运动后突然停止的影响"),
    ("长期压力会影响胃肠神经调节并放大胃部不适。", "关系结构型", "压力和胃部不适的关系"),
]

_MOCK_CARD_TEMPLATES = [
    ("为什么甜饮也升尿酸？", "会，果糖代谢可能推高尿酸，咋一步步变高的？看视频。", "想知道果糖怎么影响尿酸？"),
    ("年轻人就不会痛风吗？", "不是，年轻人也会被习惯影响，为啥偏年轻？视频里有数据。", "看看年轻人为什么也会痛风"),
    ("睡前刷视频真更难睡吗？", "会，强刺激会让大脑更兴奋，怎么拖到睡意？看视频。", "看看睡意怎么被拖走"),
    ("空腹喝咖啡会更慌吗？", "可能会，咖啡因和胃酸会放大不适，哪步关键？看视频。", "看看空腹咖啡怎么影响身体"),
    ("饭后立刻躺会反酸吗？", "会，平躺更容易让胃内容物上返，具体过程看视频。", "看看反酸是怎么来的"),
    ("久坐也会让腿更肿吗？", "会，静脉回流变慢会让液体滞留，怎么发生的？看视频。", "看看久坐为什么会肿"),
    ("熬夜后为啥更想吃甜？", "会，激素节律被打乱会推高食欲，为啥想吃甜？看视频。", "看看熬夜怎么影响食欲"),
    ("喝水少真的会头疼吗？", "可能会，缺水会让循环和神经更敏感，哪些信号看视频。", "看看缺水会带来哪些信号"),
    ("运动后为啥不能猛停？", "不建议，猛停会让回流短暂跟不上，身体咋反应？看视频。", "看看运动后该怎么停"),
    ("压力大会让胃更难受吗？", "会，压力会牵动胃肠神经调节，为啥会放大？看视频。", "看看压力怎么影响胃"),
]


def _mock_knowledge_points(count: int) -> list[dict]:
    points = []
    for index in range(max(1, count)):
        statement, task_type, timestamp_subject = _MOCK_KNOWLEDGE_POINT_TEMPLATES[
            index % len(_MOCK_KNOWLEDGE_POINT_TEMPLATES)
        ]
        start_time = 10 + index * 30
        points.append(
            {
                "knowledge_point_id": f"kp_{index + 1:03d}",
                "statement": statement,
                "start_time": start_time,
                "end_time": start_time + 20,
                "selection_scores": {
                    "fact_complete": 1,
                    "description_valid": 1,
                    "answer_core": 1,
                    "clear_boundary": 1,
                    "task_type_clear": 1,
                    "explanatory_value": 1,
                    "user_relevance": 1,
                    "contrast_or_misconception": 1,
                    "question_feasible": 1,
                    "answer_feasible": 1,
                    "question_tension": 1,
                    "answer_hook": 1,
                    "batch_distinctness": 1,
                    "timestamp_precise": 1,
                },
                "priority": "S",
                "task_type": task_type,
                "tension_triad": {
                    "common_sense": "用户原本的直觉判断",
                    "counterintuitive": statement,
                    "explanation": timestamp_subject,
                },
                "question_direction": _MOCK_CARD_TEMPLATES[index % len(_MOCK_CARD_TEMPLATES)][0],
                "answer_core": _MOCK_CARD_TEMPLATES[index % len(_MOCK_CARD_TEMPLATES)][1],
                "answer_hook": _MOCK_CARD_TEMPLATES[index % len(_MOCK_CARD_TEMPLATES)][2],
                "timestamp_note": f"从“{timestamp_subject}”开始正式讲解，前面只是铺垫话题。",
            }
        )
    return points


def _mock_cards(knowledge_points: list[dict], *, video_id: str) -> list[dict]:
    cards = []
    for index, point in enumerate(knowledge_points):
        hook, answer, entry = _MOCK_CARD_TEMPLATES[index % len(_MOCK_CARD_TEMPLATES)]
        start_time = float(point.get("start_time") or 10 + index * 30)
        end_time = float(point.get("end_time") or start_time + 20)
        task_type = str(point.get("task_type") or "原因解释型")
        cards.append(
            {
                "video_id": video_id,
                "card_id": f"card_{index + 1:03d}",
                "card_type": "recovery",
                "knowledge_point_id": str(point.get("knowledge_point_id") or f"kp_{index + 1:03d}"),
                "hook_question": hook,
                "highlight_answer": answer,
                "source_start_time": start_time,
                "source_end_time": end_time,
                "video_entry_text": entry,
                "video_cta_text": f"看原视频 {int(end_time - start_time)} 秒解释",
                "theme": "health",
                "difficulty_level": "easy",
                "risk_level": "medium",
                "question_style": task_type,
                "curiosity_score": 0.91,
                "is_suitable_for_card": True,
            }
        )
    return cards


def _mock_candidate_groups(knowledge_points: list[dict], *, video_id: str) -> list[dict]:
    groups = []
    for card in _mock_cards(knowledge_points, video_id=video_id):
        candidates = []
        for candidate_index in range(1, 4):
            candidate = dict(card)
            candidate["card_id"] = f"{card['knowledge_point_id']}_c{candidate_index}"
            candidate["candidate_index"] = candidate_index
            candidate["self_score"] = 9 - candidate_index
            candidate["hook_question"] = _mock_candidate_hook(
                str(card["hook_question"]),
                candidate_index,
            )
            candidate["video_entry_text"] = (
                f"{card['video_entry_text']}，角度 {candidate_index}"
            )
            candidates.append(candidate)
        groups.append(
            {
                "knowledge_point_id": card["knowledge_point_id"],
                "candidates": candidates,
            }
        )
    return groups


def _mock_candidate_hook(hook: str, candidate_index: int) -> str:
    if candidate_index == 1:
        return hook
    body = hook.rstrip("?？")
    if candidate_index == 2:
        replacements = [("为什么", "怎么会"), ("为啥", "怎么会"), ("真的", "居然")]
    else:
        replacements = [("为什么", "究竟咋"), ("为啥", "究竟咋"), ("真的", "难道")]
    for source, target in replacements:
        if source in body:
            return body.replace(source, target, 1) + "？"
    suffix = "，怎么回事？" if candidate_index == 2 else "，关键在哪？"
    return body + suffix


def _candidate_groups_from_audit_prompt(user_prompt: str) -> list[dict]:
    marker = "三候选：\n"
    start = user_prompt.find(marker)
    if start < 0:
        return []
    remainder = user_prompt[start + len(marker) :]
    end = remainder.find("\n\n必须只输出 JSON")
    raw = remainder[:end] if end >= 0 else remainder
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, dict) or not isinstance(parsed.get("candidates"), list):
        return []
    return [parsed]


def _mock_candidate_group_audit(group: dict) -> dict:
    candidates = [item for item in group.get("candidates", []) if isinstance(item, dict)]
    ids = [str(item.get("card_id") or "") for item in candidates]
    score_template = {
        "knowledge_point_fact_sentence": 2,
        "knowledge_point_answer_core": 2,
        "knowledge_point_explanatory_value": 2,
        "hook_readability": 2,
        "hook_question_quality": 2,
        "hook_no_answer_leak": 2,
        "hook_alignment": 2,
        "answer_directness": 2,
        "answer_focus_accuracy": 2,
        "answer_natural_hook": 2,
        "qa_pairing": 2,
        "promise_fulfillment": 2,
        "boundary_safety": 2,
        "abstract_concept_quality": 2,
        "timestamp_quality": 2,
        "consistency": 2,
    }
    audits = []
    for index, candidate_id in enumerate(ids):
        audits.append(
            {
                "candidate_id": candidate_id,
                "audit_score_32": 30 - index,
                "audit_grade": "S" if index == 0 else "A",
                "treatment": "可直接使用" if index == 0 else "小改后使用",
                "should_keep": True,
                "scores": score_template,
                "overall_score": 4.7 - index * 0.1,
                "main_issues": [],
                "blocking_reasons": [],
                "revision_suggestions": {
                    "knowledge_point": None,
                    "hook_question": None,
                    "highlight_answer": None,
                },
                "failure_reasons": [],
            }
        )
    return {
        "knowledge_point_id": str(group.get("knowledge_point_id") or ""),
        "candidate_ranking": ids,
        "selected_candidate_id": ids[0] if ids else "",
        "candidate_audits": audits,
    }


def _knowledge_points_from_generation_prompt(user_prompt: str) -> list[dict]:
    marker = "知识点：\n"
    start = user_prompt.find(marker)
    if start < 0:
        return []
    start += len(marker)
    end = user_prompt.find("\n\n输出 JSON 结构", start)
    if end < 0:
        return []
    try:
        parsed = json.loads(user_prompt[start:end].strip())
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [item for item in parsed if isinstance(item, dict)]


def _mock_video_id(user_prompt: str) -> str:
    for line in user_prompt.splitlines():
        stripped = line.strip()
        if stripped.startswith("- video_id:"):
            return stripped.split(":", 1)[1].strip() or "mock_video"
    return "mock_video"
