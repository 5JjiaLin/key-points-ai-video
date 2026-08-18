import type { MultiVideoProfileData } from './profile.types'

const previewTitle = '我们要站在新时代风口的前沿。'

const createPreviewItems = (sectionId: string) => Array.from({ length: 3 }, (_, index) => ({
  id: `${sectionId}-${index + 1}`,
  title: previewTitle,
}))

export const multiVideoProfileFixture: MultiVideoProfileData = {
  displayName: 'Paige',
  accountId: '123456',
  stats: [
    { label: '作品', value: 0 },
    { label: '互关', value: 0 },
    { label: '关注', value: 0 },
    { label: '粉丝', value: 0 },
  ],
  reconstruction: {
    eyebrow: 'AI重构',
    title: '从收藏里，发现你的科普学习主题',
    description: 'AI自动整理相关视频，带你从零散观看到系统学习',
    recommendedTopic: '黑洞是如何形成的',
    actionLabel: '开始学习',
  },
  sections: [
    { id: 'history', title: '观看历史', items: createPreviewItems('history') },
    { id: 'favorites', title: '我的收藏', items: createPreviewItems('favorites') },
    { id: 'likes', title: '我的点赞', items: createPreviewItems('likes') },
  ],
}
