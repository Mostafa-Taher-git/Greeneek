/**
 * Display masking of recognized credentials in sent user text.
 *
 * Ported from DeepSeek Harness `packages/client/ui-secret-mask` (MIT,
 * commit `a93958c7d0` and follow-ups) at fork `818c4f344e` — the linear
 * scanner tables (`secret-formats.ts`, `secret-format-tables.ts`,
 * `secret-masks.ts`, `secret-scanner.ts`) — adapted to Greeneek's
 * `projectUserText` projection, which has no UserText rule registry.
 * Masking changes only drawn text; the logged message, copy, and model
 * input keep the original characters. Copyright notices live in the
 * repository LICENSE; no upstream file is shipped verbatim beyond these
 * four modules under MIT.
 */
import { CredentialScanner, type SecretRange } from './secret-scanner.ts'
import { formatTables } from './secret-format-tables.ts'

let scanner: CredentialScanner | undefined

/** Shared scanner; one instance memoizes per text across queries. */
function sharedScanner(): CredentialScanner {
  scanner ??= new CredentialScanner(formatTables())
  return scanner
}

/**
 * Every non-overlapping credential range in `text`, left to right.
 * @param text - the complete sent text to scan.
 * @returns masked ranges covering each recognized credential.
 */
export function findSecretRanges(text: string): SecretRange[] {
  const scan = sharedScanner()
  const ranges: SecretRange[] = []
  let from = 0
  for (;;) {
    const found = scan.match(text, from)
    if (found === undefined) break
    ranges.push(found)
    if (found.end <= from) break
    from = found.end
  }
  return ranges
}
