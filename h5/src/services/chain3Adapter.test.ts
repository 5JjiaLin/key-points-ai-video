import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgePoolItem, RawReconstructionResult } from '../domain/learning'
import type { VideoProject } from '../domain/video'
import { adaptLearningPath, adaptRecommendedQuestions, addToKnowledgePool } from './chain3Adapter'

afterEach(() => vi.restoreAllMocks())

describe('chain3Adapter', () => {
  it('adds a complete video to the knowledge pool through the backend', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    await addToKnowledgePool('video-1')
    expect(fetchMock).toHaveBeenCalledWith('/api/knowledge-pool/items', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ jobId: 'video-1' }),
    }))
  })

  it('maps real chain3 timestamps back to chain1 and chain2 artifacts', () => {
    const project: VideoProject = {
      id: 'video-1', title: '真实视频', creator: '作者', duration: 100, videoUrl: '/api/media/video-1/media/source.mp4',
      transcript: [],
      knowledgePoints: [{ id: 'kp-1', title: '知识', factualStatement: '事实', question: '为什么？', answer: '因为证据。', startTime: 10, endTime: 30, order: 1, evidenceSegmentIds: [] }],
      supplements: [{ id: 's-1', type: 'knowledge_gap', sourceText: '原文', startTime: 12, endTime: 20, triggerTime: 15, displayMode: 'auto_prompt', question: '补充什么？', answer: '补充内容', helperText: '查看补充', renderMode: 'text_fallback' }],
    }
    const pool: KnowledgePoolItem[] = [{ jobId: project.id, addedAt: '', state: 'ready', progress: 1, message: '', retryable: false, project }]
    const result: RawReconstructionResult = {
      learning_path: {
        path_id: 'path-1', title: '真实路径', estimated_minutes: 5,
        stages: [{ stage_id: 'stage-1', title: '阶段', knowledge_nodes: [{ canonical_node_id: 'node-1', display_title: '节点', recommended_source: { video_id: 'video-1', start_ms: 12000, end_ms: 24000 } }] }],
      },
    }
    const path = adaptLearningPath(result, pool)
    expect(path.stages[0].nodes[0].source.startTime).toBe(12)
    expect(path.stages[0].nodes[0].source.question).toBe('为什么？')
    expect(path.stages[0].nodes[0].source.supplements[0].id).toBe('s-1')
  })

  it('uses server recommended questions without local fixture copy', () => {
    expect(adaptRecommendedQuestions({ recommended_questions: [{ question_id: 'q1', question: '真实问题' }] })[0].question).toBe('真实问题')
  })
})
