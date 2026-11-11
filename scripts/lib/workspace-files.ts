/**
 * Filesystem helpers shared by the repository gates and generators.
 *
 * The gates read the workspace the same way: manifests as JSON objects, and
 * source trees as sorted file lists. One implementation keeps their reports
 * comparable.
 * @module scripts/lib/workspace-files
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Read one JSON file that must hold an object.
 * @param root - the directory the path is relative to.
 * @param file - the file path, relative to the root.
 * @param label - the gate name, used in the failure message.
 * @returns the parsed object.
 * @throws when the file is not valid JSON or does not hold an object.
 */
export function readJsonObject(root: string, file: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(join(root, file), 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label}: ${file} must contain a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

/**
 * List every file below one directory, sorted by path.
 * @param dir - the directory to walk.
 * @returns the absolute file paths, in walk order.
 */
export function walkFiles(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries.sort()) {
    const path = join(dir, entry)
    let isDirectory = false
    try {
      isDirectory = statSync(path).isDirectory()
    } catch {
      continue
    }
    if (isDirectory) {
      walkFiles(path, out)
    } else {
      out.push(path)
    }
  }
  return out
}
