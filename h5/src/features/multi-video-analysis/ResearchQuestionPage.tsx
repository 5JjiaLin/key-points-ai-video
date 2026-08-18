import { useEffect, useMemo, useRef, useState } from 'react'
import type { LearningField, LearningFieldId } from './learning.types'
import { LEARNING_TOPIC_MAX_LENGTH } from './learning.constants'
import './researchQuestion.css'

const assetRoot = '/assets/multi-video'
const researchAssetRoot = `${assetRoot}/research-page`

type QuestionMode = 'recommended' | 'custom'

interface ResearchQuestionPageProps {
  field: LearningField
  recommendedQuestions?: string[]
  loading?: boolean
  error?: string | null
  onBack: () => void
  onSubmit: (question: string) => void
}

const subjectByField: Record<LearningFieldId, string> = {
  astronomy: '黑洞形成',
  geography: '地球 46 亿年',
  history: '文明演进',
  'life-science': '生命演化',
  technology: '现代科技发展',
  economy: '社会经济发展',
  'physics-chemistry': '物质与能量规律',
  'food-nutrition': '饮食与营养',
}

const knowledgeSystemByField: Record<LearningFieldId, string> = {
  astronomy: '黑洞与时空',
  geography: '地球演化',
  history: '历史文明',
  'life-science': '生命科学',
  technology: '科技原理',
  economy: '社会经济',
  'physics-chemistry': '物理化学',
  'food-nutrition': '食品营养',
}

function buildRecommendedQuestions(field: LearningField) {
  const subject = subjectByField[field.id]
  return [
    [`${subject}经历了哪些关键阶段？`, '不同博主分别补充了什么？'],
    [`不同博主对${subject.replace(' 46 亿年', '形成')}的解释`, '有哪些共同点和差异？'],
    ['这些视频中哪些内容重复，', '哪些提供了独有知识？'],
    [`当前视频能否构成完整的${knowledgeSystemByField[field.id]}`, '知识体系，还缺少什么？'],
  ]
}

export function ResearchQuestionPage({
  field,
  recommendedQuestions,
  loading = false,
  error,
  onBack,
  onSubmit,
}: ResearchQuestionPageProps) {
  const questions = useMemo(
    () => recommendedQuestions === undefined
      ? buildRecommendedQuestions(field)
      : recommendedQuestions.map((question) => [question, '']),
    [field, recommendedQuestions],
  )
  const customInputRef = useRef<HTMLTextAreaElement>(null)
  const [mode, setMode] = useState<QuestionMode>('recommended')
  const [selectedQuestion, setSelectedQuestion] = useState(0)
  const [customQuestion, setCustomQuestion] = useState('')

  useEffect(() => {
    setMode('recommended')
    setSelectedQuestion(0)
    setCustomQuestion('')
  }, [field.id])

  const selectCustomMode = () => {
    setMode('custom')
    window.setTimeout(() => customInputRef.current?.focus(), 0)
  }

  const chooseSuggestion = (question: string) => {
    setMode('custom')
    setCustomQuestion(question)
    window.setTimeout(() => customInputRef.current?.focus(), 0)
  }

  const canSubmit = mode === 'recommended' ? questions.length > 0 : customQuestion.trim().length > 0
  const submittedQuestion = mode === 'custom'
    ? customQuestion.trim()
    : questions[selectedQuestion]?.join('') ?? ''

  return (
    <div className="learning-flow-page research-question-page">
      <img className="learning-flow-status research-question-status" src={`${assetRoot}/status-bar.svg`} alt="9:41，手机状态栏" />
      <img className="research-top-glow" src={`${researchAssetRoot}/research-top-glow.svg`} alt="" />
      <img className="research-list-glow" src={`${researchAssetRoot}/research-list-glow.svg`} alt="" />

      <button className="learning-flow-back research-question-back" aria-label="返回分析方式" onClick={onBack} type="button">
        <img src={`${assetRoot}/flow-back.svg`} alt="" />
      </button>

      <header className="research-question-header">
        <h1>选择研究问题</h1>
        <p>这是本次分析要帮你弄清楚的问题</p>
      </header>

      <main className="research-question-content">
        <section className="research-recommendations" aria-labelledby="recommended-question-title">
          <h2 id="recommended-question-title">推荐问题</h2>
          {loading && <p className="research-question-status">正在根据所选视频生成推荐问题…</p>}
          {error && <p className="research-question-status error">{error}</p>}
          <div className="research-question-list">
            {questions.map((lines, index) => {
              const selected = mode === 'recommended' && selectedQuestion === index
              return (
                <button
                  aria-pressed={selected}
                  className={`research-question-card ${selected ? 'selected' : ''}`}
                  key={lines.join('')}
                  onClick={() => {
                    setMode('recommended')
                    setSelectedQuestion(index)
                  }}
                  type="button"
                >
                  <span className="research-radio" aria-hidden="true">
                    {selected ? (
                      <>
                        <img src={`${researchAssetRoot}/radio-selected-outer.svg`} alt="" />
                        <img src={`${researchAssetRoot}/radio-selected-inner.svg`} alt="" />
                      </>
                    ) : (
                      <img src={`${researchAssetRoot}/radio-unselected.svg`} alt="" />
                    )}
                  </span>
                  <span className="research-question-copy">
                    <span>{lines[0]}</span>
                    <span>{lines[1]}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="research-custom-question" aria-labelledby="custom-question-title">
          <h2 id="custom-question-title">我有自己的问题</h2>
          <div className={`research-custom-input ${mode === 'custom' ? 'active' : ''}`}>
            <textarea
              aria-label="自定义研究问题"
              maxLength={LEARNING_TOPIC_MAX_LENGTH}
              onFocus={selectCustomMode}
              onChange={(event) => {
                setMode('custom')
                setCustomQuestion(event.target.value)
              }}
              placeholder="输入你想通过这些视频弄清楚的问题…"
              ref={customInputRef}
              value={customQuestion}
            />
            <span>{customQuestion.length}/{LEARNING_TOPIC_MAX_LENGTH}</span>
          </div>
          <div className="research-question-suggestions" aria-label="示例问题">
            <button onClick={() => chooseSuggestion('恐龙灭绝的原因有哪些？')} type="button">
              例如：恐龙灭绝的原因有哪些？
            </button>
            <button onClick={() => chooseSuggestion('大氧化事件为什么如此重要？')} type="button">
              大氧化事件为什么如此重要？
            </button>
          </div>
        </section>
      </main>

      <footer className="research-question-footer">
        <button
          disabled={!canSubmit}
          onClick={() => onSubmit(submittedQuestion)}
          type="button"
        >
          开始解构分析
        </button>
      </footer>
    </div>
  )
}
