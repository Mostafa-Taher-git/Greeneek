/**
 * Resolve the default ACP composition on every checkout mode.
 *
 * `apps/cli/tests/profiles/acp/cordis.yml` is a git symlink to the shipped
 * snapshot composition. A Windows checkout without `core.symlinks` materializes
 * it as a one-line text file containing the target path, which the Loader
 * cannot parse as YAML.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const linkPath = fileURLToPath(new URL('../cordis.yml', import.meta.url))

/** Absolute path of the real composition, following a text-only symlink stand-in. */
export function defaultAcpConfigPath(): string {
  let text: string
  try {
    text = readFileSync(linkPath, 'utf8').trim()
  } catch {
    return linkPath
  }
  if (text.includes('\n') || text.includes(':') || !text.endsWith('cordis.yml')) return linkPath
  const target = resolve(dirname(linkPath), text)
  return existsSync(target) ? target : linkPath
}
