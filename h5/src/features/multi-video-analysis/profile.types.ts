export interface ProfileVideoPreview {
  id: string
  title: string
}

export interface ProfileVideoSection {
  id: string
  title: string
  items: ProfileVideoPreview[]
}

export interface MultiVideoProfileData {
  displayName: string
  accountId: string
  stats: Array<{
    label: string
    value: number
  }>
  reconstruction: {
    eyebrow: string
    title: string
    description: string
    recommendedTopic: string
    actionLabel: string
  }
  sections: ProfileVideoSection[]
}
