import { describe, expect, it } from 'vitest'
import type { VideoProjectDto } from '../domain/video'
import { adaptVideoProjectDto } from './backendVideoAnalysisAdapter'

describe('adaptVideoProjectDto', () => {
  it('converts backend milliseconds exactly once and preserves evidence ids', () => {
    const dto: VideoProjectDto = {
      schemaVersion: 'video-project.v1',
      id: 'job-1',
      title: '测试视频',
      creator: '本地上传',
      durationMs: 120000,
      videoUrl: '/api/media/job-1/media/source.mp4',
      transcriptSegments: [{ id: 'semantic-1', startMs: 1000, endMs: 3000, text: '测试' }],
      knowledgePoints: [{
        id: 'kp-1',
        title: '事实',
        factualStatement: '事实',
        question: '为什么？',
        answer: '因为测试。',
        startMs: 1000,
        endMs: 3000,
        order: 1,
        evidenceSegmentIds: ['semantic-1'],
      }],
      supplements: [{
        id: 'supp-1',
        type: 'knowledge_gap',
        sourceText: '概念',
        startMs: 2000,
        endMs: 4000,
        triggerAtMs: 4500,
        displayMode: 'auto_prompt',
        question: '概念是什么？',
        answer: '答案',
        renderMode: 'text_fallback',
        evidenceSegmentIds: ['semantic-1'],
      }],
      analysisStatus: { state: 'ready', fallbacks: [], errors: {} },
    }
    const project = adaptVideoProjectDto(dto)
    expect(project.duration).toBe(120)
    expect(project.knowledgePoints[0]?.startTime).toBe(1)
    expect(project.supplements[0]?.triggerTime).toBe(4.5)
    expect(project.knowledgePoints[0]?.evidenceSegmentIds).toEqual(['semantic-1'])
  })
})
