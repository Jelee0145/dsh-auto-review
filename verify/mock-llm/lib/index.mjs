import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { CallId, LlmAdapter, ReasoningEffortId } from '@deepseek-ai/dsh-llm'

const OFF = ReasoningEffortId('off')
const STRUCTURED_OUTPUT_TOOL = 'structured_output'
const MARKER = 'MARKER_LEAKED_AGENTS'

let mainCalls = 0

/** Append one observation line for the verify harness. */
function log(record) {
  const target = process.env.DSH_AR_MOCK_LOG
  if (target === undefined) return
  try {
    mkdirSync(dirname(target), { recursive: true })
    appendFileSync(target, `${JSON.stringify(record)}\n`)
  } catch {
    // The verify harness reads the log; a write failure must not break the run.
  }
}

/** Which request roles carry the marker. */
function markerRoles(options) {
  return options.messages
    .filter((message) => message.content.some((block) => block.type === 'text' && block.text.includes(MARKER)))
    .map((message) => message.role)
}

const toolCallChunks = (id, name, args) => {
  const json = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: CallId(id), name, argumentsDelta: json.slice(0, 6) },
    { type: 'tool-call-delta', index: 0, id: CallId(id), argumentsDelta: json.slice(6) },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(id), name, arguments: json } },
  ]
}

class MockAdapter extends LlmAdapter {
  async resolveModel(provider, model) {
    return { provider, id: model, name: model, reasoning: { efforts: [{ id: OFF, name: 'Off' }], defaultEffort: OFF } }
  }

  async *stream(options) {
    const text = options.messages
      .flatMap((message) => message.content)
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
    const isReviewer = text.includes('Review ONE sandbox-escalation request')
    log({
      role: isReviewer ? 'reviewer' : 'main',
      markerRoles: markerRoles(options),
      ...(isReviewer
        ? { userMsgs: options.messages.filter((m) => m.role === 'user').map((m) => m.content[0]?.type === 'text' ? m.content[0].text.slice(0, 70) : '') }
        : {}),
    })
    if (isReviewer) {
      const deny = text.includes('evil.example')
      const args = {
        verdict: deny ? 'deny' : 'allow',
        riskLevel: deny ? 'high' : 'low',
        userAuthorization: deny ? 'unknown' : 'high',
        reason: deny ? 'mock deny' : 'mock allow',
      }
      for (const chunk of toolCallChunks('mock-review-verdict', STRUCTURED_OUTPUT_TOOL, args)) yield chunk
      yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    mainCalls += 1
    if (mainCalls === 1) {
      const command = text.includes('DENYCASE')
        ? "Set-Content -Path 'C:\\Users\\35992\\Documents\\dsh-ar-evil.example' -Value x; Test-Path 'C:\\Users\\35992\\Documents\\dsh-ar-evil.example'"
        : "Set-Content -Path 'C:\\Users\\35992\\Documents\\dsh-ar-allow.txt' -Value ok; Test-Path 'C:\\Users\\35992\\Documents\\dsh-ar-allow.txt'"
      const args = {
        command,
        description: 'mock escalation probe',
        sandbox_permissions: 'danger-full-access',
        justification: 'verify the auto-review escalation path',
      }
      for (const chunk of toolCallChunks('mock-pwsh-call', 'pwsh', args)) yield chunk
      yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'DONE' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'DONE' } }
    yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'dsh-ar-mock-llm'
export const inject = ['llm']

export function apply(ctx) {
  ctx.llm.registerAdapter(['mock'], new MockAdapter())
}
