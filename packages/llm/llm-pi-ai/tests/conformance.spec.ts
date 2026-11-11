import { describeAdapterConformance } from '@greeneek/gnk-llm/conformance'
import { PiAiAdapter } from '@greeneek/gnk-llm-pi-ai'
import { resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

describeAdapterConformance('@greeneek/gnk-llm-pi-ai', async () => {
  const server = await mockServer([{ events: textEvents }])
  const profiles = resolveProfiles({
    conformance: {
      api: 'openai-completions',
      baseURL: server.url,
      models: [
        { id: 'conformance-model' },
        { id: 'conformance-model-2' },
        { id: 'conformance-tool-model' },
      ],
    },
  })
  const adapter = new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: () => Promise.resolve('test-key'),
    auth: memoryAuth(),
  })
  return {
    adapter,
    cleanup: async () => {
      await closeMockServers()
    },
  }
})
