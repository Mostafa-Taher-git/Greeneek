/**
 * Temporary workspace harness shared by the repository gate specs.
 *
 * The gate specs each need a throwaway workspace tree: a directory, a few
 * files, and a cleanup that runs after every case. The harness lives here so
 * the specs differ only in what they assert.
 * @module scripts/lib/temp-workspace
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** Temporary roots this process created, oldest first. */
const roots: string[] = []

/**
 * Remove every temporary workspace this process created.
 */
export function cleanupTempWorkspaces(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}

/**
 * Write one file inside a temporary workspace, creating its directories.
 * @param root - the workspace root.
 * @param file - the workspace-relative file path.
 * @param content - the file content.
 */
export function writeWorkspaceFile(root: string, file: string, content: string): void {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/**
 * Create a temporary workspace root.
 * @param prefix - the directory-name prefix, identifying the gate.
 * @param file - an optional first file, with its content.
 * @param content - the content of that first file.
 * @returns the workspace root path.
 */
export function createTempWorkspace(prefix: string, file?: string, content?: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  if (file !== undefined) writeWorkspaceFile(root, file, content ?? '')
  return root
}
