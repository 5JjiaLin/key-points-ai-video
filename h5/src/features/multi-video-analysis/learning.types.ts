export type LearningFieldId =
  | 'astronomy'
  | 'geography'
  | 'history'
  | 'life-science'
  | 'technology'
  | 'economy'
  | 'physics-chemistry'
  | 'food-nutrition'

export interface LearningField {
  id: LearningFieldId
  name: string
  description: string
  iconUrl: string
  topic: string
  videoTitles: string[]
  creators: string[]
  collectionTitles: string[]
}

export interface LearningVideo {
  id: string
  title: string
  creator: string
  duration: string
}

export interface CreatorCollection {
  id: string
  title: string
  creator: string
  videos: LearningVideo[]
}

export interface MultiVideoLearningFixture {
  fields: LearningField[]
}
