import type {
  ClarificationColumn,
  SupplementRenderMode,
  SupplementType,
} from '../domain/video'

interface SupplementPresentationInput {
  type: SupplementType
  subtitle?: string
  answerLabel?: string
  cardVariant?: 'viewpoint_clarification' | 'verification_result'
  leftColumn?: ClarificationColumn
  rightColumn?: ClarificationColumn
  sourceCount?: number
  sourceAction?: string
  renderMode: SupplementRenderMode
  cardImageUrl?: string
}

interface SupplementPresentation {
  helperText: string
  cardVariant?: 'viewpoint_clarification' | 'verification_result'
  sourceCount?: number
  sourceAction?: string
  renderMode: SupplementRenderMode
  cardImageUrl?: string
}

export function resolveSupplementPresentation(
  item: SupplementPresentationInput,
): SupplementPresentation {
  if (item.type !== 'claim_verification') {
    return {
      helperText: item.subtitle ?? item.answerLabel ?? '查看补充',
      cardVariant: item.cardVariant,
      sourceCount: item.sourceCount,
      sourceAction: item.sourceAction,
      renderMode: item.renderMode,
      cardImageUrl: item.cardImageUrl,
    }
  }

  const hasClarificationColumns = Boolean(item.leftColumn && item.rightColumn)
  const cardVariant = (
    item.cardVariant === 'viewpoint_clarification' ||
    (item.cardVariant === undefined && hasClarificationColumns)
  ) && hasClarificationColumns
    ? 'viewpoint_clarification'
    : 'verification_result'
  const sourceCount = Math.max(0, Math.floor(item.sourceCount ?? 0))

  return {
    helperText: item.subtitle ?? (
      cardVariant === 'viewpoint_clarification'
        ? '换个角度看'
        : '查看核验结果'
    ),
    cardVariant,
    sourceCount,
    sourceAction: sourceCount > 0 ? (item.sourceAction ?? '查看依据') : undefined,
    renderMode: 'verification_template' as const,
    cardImageUrl: undefined,
  }
}
