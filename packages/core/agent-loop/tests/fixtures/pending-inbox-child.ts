import { Context } from '@greeneek/cordis'
import LlmRuntime, { createUserMessage } from '@greeneek/gnk-llm'
import SessionStore, { SessionId } from '@greeneek/gnk-session'
import SystemPrompt from '@greeneek/gnk-system-prompt'
import ToolRuntime from '@greeneek/gnk-tools'
import AgentRegistry from '@greeneek/gnk-agent'
import JsonlSessionPersistence from '@greeneek/gnk-session-persistence-jsonl'
import AgentLoop from '@greeneek/gnk-agent-loop'
import SessionProjectionRegistry from '@greeneek/gnk-session-projection'
import { MockAdapter, textResponse } from '../mock-adapter.ts'

const root = process.argv[2]
if (root === undefined) throw new Error('persistence root is required')

const ctx = new Context()
await ctx.plugin(LlmRuntime)
await ctx.plugin(SessionStore)
await ctx.plugin(SessionProjectionRegistry)
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await ctx.plugin(AgentRegistry)
await ctx.plugin(JsonlSessionPersistence, { root })
await ctx.plugin(AgentLoop, { agents: [] })
ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('answer')]))

const agent = (await ctx.agents.create({
  sessionId: SessionId('inject-sess'),
  meta: { cwd: '/w' },
})).agent
agent.followup(createUserMessage({ content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } }))
await agent.whenIdle()
agent.inject(createUserMessage({
  content: [{ type: 'text', text: 'background job 42 finished' }],
  source: { kind: 'plugin', plugin: 'tool-bash' },
}))
await ctx.sessions.flush(agent.session)

process.stdout.write('PENDING_INBOX_READY\n')
setInterval(() => undefined, 60_000)
