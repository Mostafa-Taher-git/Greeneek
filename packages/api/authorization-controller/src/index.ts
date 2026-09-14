/**
 * Host Remote owner for the authorization surfaces: the flows a page can sign
 * into, one attempt stream per run, prompt answers, and cancellation.
 *
 * @module @greeneek/gnk-api-authorization-controller
 */

import { AuthorizationController } from './authorization.ts'

export { AttemptRegistry, AuthorizationController, projectEntry } from './authorization.ts'
export type * from './types.ts'

export default AuthorizationController
