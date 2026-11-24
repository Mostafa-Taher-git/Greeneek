/**
 * `/browser-ai <provider>` opens an official AI provider's web interface in its
 * own isolated browser session for manual use. Available providers are listed
 * when no argument is given. This command never handles passwords or cookies.
 * @module @greeneek/gnk-command-browser-ai
 */
import type { Context } from '@greeneek/cordis'
import type {} from '@greeneek/gnk-browser-ai'
import type {} from '@greeneek/gnk-commands'
import type { CommandResult } from '@greeneek/gnk-commands'

/** Cordis plugin name. */
export const name = 'command-browser-ai'
/** Required services. */
export const inject = ['commands', 'browserAI']

/** Register the command. */
export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'browser-ai',
    description: 'Open an official AI website (chatgpt, claude, gemini) in an isolated browser session',
    input: { hint: '[chatgpt|claude|gemini]' },
    handler: async (invocation): Promise<CommandResult> => {
      const requested = invocation.rawInput.trim().toLowerCase()
      const providers = ctx.browserAI.list()
      if (requested === '' || requested === 'list') {
        const lines = providers.map((provider) => {
          const caps = `manual=${provider.manual ? 'yes' : 'no'}, automation=${provider.automation ? 'yes' : 'no'}`
          return `- ${provider.id} (${provider.vendor}) ${caps}${provider.automationReason ? ` - ${provider.automationReason}` : ''}`
        })
        return { kind: 'success', text: `Browser AI providers:\n${lines.join('\n')}\n\nUsage: /browser-ai <provider>` }
      }
      const provider = providers.find(p => p.id === requested)
      if (provider === undefined) {
        return { kind: 'error', text: `Unknown provider "${requested}". Available: ${providers.map(p => p.id).join(', ')}` }
      }
      try {
        const session = await ctx.browserAI.openManual(provider.id)
        return {
          kind: 'success',
          text: `Opened ${provider.id} in its isolated browser session (${session.profile}, status ${session.status}). Sign in through the provider's own page; Greeneek never collects your password.`,
        }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

/** Browser-AI command plugin with its Cordis metadata. */
export default { name, inject, apply }
