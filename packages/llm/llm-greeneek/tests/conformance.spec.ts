import { describeAdapterConformance } from '@greeneek/gnk-llm/conformance'
import { GreeneekAdapter, resolveAdapterOptions } from '@greeneek/gnk-llm-greeneek'
import type { PreparedGreeneekLlmApiExtensions } from '@greeneek/gnk-greeneek-llm-api-extensions'
import type { AnonymousUserId } from '@greeneek/gnk-anonymous-user-id'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001' as AnonymousUserId

function noExtensions(): Promise<PreparedGreeneekLlmApiExtensions> {
  return Promise.resolve({ fields: {}, accept: () => Promise.resolve() })
}

describeAdapterConformance('@greeneek/gnk-llm-greeneek', async () => {
  const server = await mockServer([{ kind: 'sse', events: textEvents }])
  const adapter = new GreeneekAdapter({
    options: () => resolveAdapterOptions({ baseURL: server.url }),
    resolveApiKey: () => Promise.resolve('k'),
    resolveUserId: () => TEST_USER_ID,
    prepareExtensions: noExtensions,
  })
  return {
    adapter,
    cleanup: async () => {
      await server.close()
      await closeMockServers()
    },
  }
})
