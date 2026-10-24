/**
 * Craft bridge service definition (`ctx.craft`): manifest catalog, four-state
 * health, headless session lifecycle, root confinement, and the attach gate.
 * @module @greeneek/gnk-craft
 */

export { CraftError } from './error.ts'
export type { CraftErrorCode } from './error.ts'
export {
  assertPilotManifest,
  CraftCatalog,
  loadPilotCatalog,
  PILOT_APP_IDS,
  parseManifest,
  readPackageFile,
} from './manifest.ts'
export type { ManifestReader } from './manifest.ts'
export { confineArtifact, controlTokenPath, CONTROL_TOKEN_FILE, craftRoots, resolveWorkspaceRoot } from './paths.ts'
export { Config, CraftRuntime, DEFAULT_MAX_ACTIVE_APPS } from './service.ts'
export type {
  CraftAppManifest,
  CraftAppState,
  CraftAttachPolicy,
  CraftCallResult,
  CraftDiscovery,
  CraftHeadlessSpec,
  CraftHostOpenRequest,
  CraftHostProvider,
  CraftHostSession,
  CraftLaunchTemplates,
  CraftManifestRoots,
  CraftManifestSource,
  CraftOpenRequest,
  CraftRecipe,
  CraftRecipeRef,
  CraftRoots,
  CraftRuntimeConfig,
  CraftSession,
  CraftStatus,
  CraftToolDescriptor,
  CraftTransport,
} from './types.ts'
export { CraftRuntime as default } from './service.ts'
