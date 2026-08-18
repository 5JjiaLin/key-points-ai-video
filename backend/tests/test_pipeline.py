from __future__ import annotations

import unittest
from pathlib import Path

from app.pipeline import build_video_project_dto


class PipelineDtoTests(unittest.TestCase):
    def test_chain2_question_answer_are_read_directly_from_knowledge_point(self) -> None:
        environment = {
            "video": {"title": "demo", "durationMs": 10000},
            "semanticSegments": [],
            "diagnostics": {},
        }
        result = build_video_project_dto(
            job_id="job",
            environment=environment,
            chain1={"supplements": []},
            chain2={
                "knowledgePoints": [{
                    "id": "kp-1",
                    "statement": "多巴胺参与动机形成",
                    "question": "多巴胺参与什么？",
                    "answer": "它参与动机形成。",
                    "startMs": 1000,
                    "endMs": 5000,
                    "evidenceSegmentIds": ["semantic-1"],
                }]
            },
            source_path=Path("source.mp4"),
            fallbacks=[],
            errors={},
        )
        [point] = result["knowledgePoints"]
        self.assertEqual(point["question"], "多巴胺参与什么？")
        self.assertEqual(point["answer"], "它参与动机形成。")


if __name__ == "__main__":
    unittest.main()
