import type { VideoProject } from '../domain/video'

export interface LocalVideoUpload {
  name: string
  objectUrl: string
  size: number
  lastModified: number
}

export function bindLocalVideoToFixture(
  upload: LocalVideoUpload,
  fixture: VideoProject,
): VideoProject {
  const title = upload.name.replace(/\.[^.]+$/, '').trim() || '本地视频'

  return {
    ...fixture,
    id: `local-${upload.lastModified}-${upload.size}`,
    title,
    creator: '本地上传',
    videoUrl: upload.objectUrl,
  }
}
