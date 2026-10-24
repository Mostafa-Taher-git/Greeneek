/**
 * Craft gateway tools (`craft_list_apps`, `craft_open_app`), per-app headless
 * tool bridges, artifact confinement, and recipe skills.
 * @module @greeneek/gnk-tool-craft
 */

export { projectCallResult, renderCallText } from './artifacts.ts'
export { registerAppTools, registerRecipeSkill } from './bridge.ts'
export { apply, CRAFT_LIST_APPS, CRAFT_OPEN_APP, parseOpenArguments, renderAppList, renderOpenSummary } from './plugin.ts'
export type { CraftAppBridge, CraftOpenMode, CraftOpenSummary, CraftProjectedCall } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-craft'

/** Services required by the gateway and its per-app bridges. */
export const inject = ['craft', 'skills', 'tools']
