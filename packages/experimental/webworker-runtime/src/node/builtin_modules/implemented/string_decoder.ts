/**
 * `node:string_decoder` for the worker, backed by the `string_decoder` npm
 * package (feross), the userland copy of Node's decoder. A transport reads
 * UTF-8 in whatever chunks the stream delivers, so a partial multi-byte
 * sequence must stay buffered until its continuation arrives; this module owns
 * that state and no caller decodes bytes by hand.
 */
import { StringDecoder } from 'string_decoder'

export { StringDecoder }

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts). */
export const __esModule = true

/** The `node:string_decoder` declarations this module stands in for. */
type NodeFace = Partial<typeof import('node:string_decoder')>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default { StringDecoder } satisfies NodeFace
