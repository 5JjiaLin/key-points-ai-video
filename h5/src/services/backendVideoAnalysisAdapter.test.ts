import { describe, expect, it, vi } from 'vitest'
import type { VideoProjectDto } from '../domain/video'
import { adaptVideoProjectDto, getShowcase, uploadDouyinVideo } from './backendVideoAnalysisAdapter'

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
        type: 'claim_verification',
        sourceText: '冰水就是不健康的',
        startMs: 2000,
        endMs: 4000,
        triggerAtMs: 4500,
        displayMode: 'auto_prompt',
        question: '冰水就是不健康的吗？',
        answer: '需要结合人群和饮用方式判断。',
        subtitle: '换个角度看',
        cardVariant: 'viewpoint_clarification',
        leftColumn: { title: '一般情况', content: '多数健康人适量饮用，通常没有明显问题。' },
        rightColumn: { title: '条件变化', content: '胃肠敏感或大量快速饮用时，可能短暂不适。' },
        sourceCount: 1,
        sourceAction: '查看依据',
        renderMode: 'verification_template',
        hintStickerImageUrl: '/api/media/job-1/media/cards/claim-hint.png',
        hintStickerWidth: 96,
        hintStickerHeight: 96,
        evidenceSegmentIds: ['semantic-1'],
      }, {
        id: 'supp-legacy-claim',
        type: 'claim_verification',
        sourceText: '所有现象都是激励的产物',
        startMs: 5000,
        endMs: 7000,
        triggerAtMs: 7500,
        displayMode: 'list_only',
        question: '所有现象真的都是激励的产物吗？',
        answer: '现有本地证据不足以独立判定真假。',
        answerLabel: '证据不足/待复核',
        renderMode: 'full_generated_image',
        cardImageUrl: '/api/media/job-1/media/cards/legacy.png',
        evidenceSegmentIds: ['semantic-1'],
      }],
      analysisStatus: { state: 'ready', fallbacks: [], errors: {} },
    }
    const project = adaptVideoProjectDto(dto)
    expect(project.duration).toBe(120)
    expect(project.knowledgePoints[0]?.startTime).toBe(1)
    expect(project.supplements[0]?.triggerTime).toBe(4.5)
    expect(project.supplements[0]?.cardVariant).toBe('viewpoint_clarification')
    expect(project.supplements[0]?.leftColumn?.title).toBe('一般情况')
    expect(project.supplements[0]?.rightColumn?.title).toBe('条件变化')
    expect(project.supplements[0]?.sourceCount).toBe(1)
    expect(project.supplements[0]?.hintStickerImageUrl).toBe('/api/media/job-1/media/cards/claim-hint.png')
    expect(project.supplements[0]?.hintStickerWidth).toBe(96)
    expect(project.supplements).toHaveLength(1)
    expect(project.knowledgePoints[0]?.evidenceSegmentIds).toEqual(['semantic-1'])
  })

  it('loads showcase items in backend order', async () => {
    const dto: VideoProjectDto = {
      schemaVersion: 'video-project.v1',
      id: 'short',
      title: '短视频',
      creator: '本地上传',
      durationMs: 1000,
      videoUrl: '/api/media/short/media/source.mp4',
      transcriptSegments: [],
      knowledgePoints: [],
      supplements: [],
      analysisStatus: { state: 'ready', fallbacks: [], errors: {} },
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      schemaVersion: 'video-showcase.v1',
      items: [dto, { ...dto, id: 'long', title: '长视频' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(getShowcase()).resolves.toMatchObject([{ id: 'short' }, { id: 'long' }])
    fetchMock.mockRestore()
  })

  it('submits pasted Douyin share text as JSON', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      jobId: 'douyin-job',
    }), { status: 202, headers: { 'Content-Type': 'application/json' } }))

    await expect(uploadDouyinVideo('2.34 复制打开抖音 https://v.douyin.com/example/')).resolves.toEqual({
      jobId: 'douyin-job',
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/videos/from-douyin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: '2.34 复制打开抖音 https://v.douyin.com/example/' }),
    })
    fetchMock.mockRestore()
  })
})
