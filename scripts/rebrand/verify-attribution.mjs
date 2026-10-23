#!/usr/bin/env node
// P2 attribution gate: proves the MIT obligation to upstream survives the
// rebrand. Fails when the upstream copyright line leaves LICENSE, when README
// drops the sources/attribution section, or when the notices file loses the
// upstream-harness disclosure.
//
//   node scripts/rebrand/verify-attribution.mjs
import { readFileSync } from 'node:fs'

const REQUIRED = [
  { file: 'LICENSE', pattern: /Copyright \(c\) 2026 DeepSeek \(https:\/\/github\.com\/deepseek-ai\/deepseek-harness\)/, why: 'upstream copyright line' },
  { file: 'README.md', pattern: /rebrand:ignore-start[\s\S]*## Origins and attribution[\s\S]*deepseek-ai\/deepseek-harness[\s\S]*rebrand:ignore-end/, why: 'origins and attribution section' },
  { file: 'THIRD_PARTY_NOTICES.md', pattern: /## Upstream harness[\s\S]*deepseek-ai\/deepseek-harness/, why: 'upstream-harness disclosure' },
]

const missing = []
for (const { file, pattern, why } of REQUIRED) {
  let text
  try {
    text = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
  } catch {
    missing.push(`${file} is missing`)
    continue
  }
  if (!pattern.test(text)) missing.push(`${file} lost the ${why}`)
}

if (missing.length) {
  console.error(`❌ upstream attribution is incomplete (${missing.length}):`)
  console.error(missing.map((entry) => `  - ${entry}`).join('\n'))
  process.exit(1)
}
console.log('✅ upstream attribution present in LICENSE, README, and THIRD_PARTY_NOTICES')
