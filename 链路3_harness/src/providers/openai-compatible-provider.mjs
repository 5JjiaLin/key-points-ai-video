import { ModelProvider } from './model-provider.mjs'
import { SkillExecutionError } from '../domain/errors.mjs'

export class OpenAICompatibleProvider extends ModelProvider {
  constructor({ baseUrl, apiKey, model, timeoutMs = 90000, temperature = 0.1, maxOutputTokens = 8000 }) {
    super()
    if (!baseUrl || !apiKey || !model) throw new Error('baseUrl, apiKey and model are required')
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.apiKey = apiKey
    this.model = model
    this.timeoutMs = timeoutMs
    this.temperature = temperature
    this.maxOutputTokens = maxOutputTokens
  }

  async complete({ skillId, systemPrompt, userPrompt }) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          temperature: this.temperature,
          max_tokens: this.maxOutputTokens,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        }),
        signal: controller.signal
      })
      if (!response.ok) {
        const body = await response.text()
        throw new SkillExecutionError(skillId, `Model request failed with ${response.status}`, { body: body.slice(0, 2000) })
      }
      const data = await response.json()
      const content = data?.choices?.[0]?.message?.content
      if (!content) throw new SkillExecutionError(skillId, 'Model response contains no content', { data })
      return content
    } finally {
      clearTimeout(timer)
    }
  }
}
