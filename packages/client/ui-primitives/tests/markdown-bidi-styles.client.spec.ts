/**
 * Bidi isolation in assistant markdown: the shell renders right-to-left for
 * Arabic, so an English paragraph must keep its own left-to-right order and
 * inline code must never absorb the surrounding reading direction.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/markdown/MarkdownText.module.css', import.meta.url)), 'utf8')
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

function rule(selector: string): string {
  const escaped = selector.replace(/[.[\]():*+^$\\]/g, '\\$&')
  const match = new RegExp(`(?:^|[{}])\\s*${escaped}\\s*\\{([^{}]*)\\}`).exec(declarations)
  if (match === null) throw new Error(`MarkdownText.module.css has no \`${selector}\` rule`)
  return match[1] ?? ''
}

describe('assistant markdown bidi isolation', () => {
  it('derives paragraph direction from the first strong character', () => {
    expect(rule('.markdown')).toContain('unicode-bidi: plaintext')
    expect(rule('.markdown :where(p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, dt, dd)'))
      .toContain('unicode-bidi: plaintext')
  })

  it('keeps code left-to-right and isolated from surrounding prose', () => {
    expect(rule('.markdown pre')).toContain('direction: ltr')
    expect(rule('.markdown pre')).toContain('unicode-bidi: isolate')
    expect(rule('.markdown :not(pre) > code')).toContain('direction: ltr')
    expect(rule('.markdown :not(pre) > code')).toContain('unicode-bidi: isolate')
  })
})
