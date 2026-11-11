/**
 * Host-native command execution and path-opening utilities.
 * @module @greeneek/gnk-native-command
 */

export { runNativeCommand } from './runner.ts'
export type { NativeCommandRunner } from './runner.ts'
export {
  canOpenNativePath,
  openNativePath,
  openNativeTextFile,
} from './path-opener.ts'
export type {
  PathOpenerInternals,
  PathOpenerRunner,
} from './path-opener.ts'
export {
  canRevealNativePath,
  EXTERNAL_APPS,
  externalAppAvailability,
  launchExternalApp,
  revealNativePath,
} from './external-app.ts'
export type {
  ExternalAppAvailability,
  ExternalAppInternals,
  ExternalAppSpec,
} from './external-app.ts'
export { gitFacts } from './git-facts.ts'
export type { GitFacts, GitFactsInternals } from './git-facts.ts'
