/**
 * Atomic tool views for the tool-owned render port. Every row derives
 * its title, summary, output, and state from the frozen `ToolCallBlock`
 * via {@link deriveModel}; `read_image` composes the same row
 * primitives as `read`.
 */
import type { PropsLocale } from '@greeneek/gnk-client-ui-slots'
import type { ToolCallViewProps } from '@greeneek/gnk-client-ui-tool/client'
import { deriveModel } from './model.ts'

type OwnedProps = ToolCallViewProps & PropsLocale<'conversation'>

function OwnedRow({ toolName, block, t }: OwnedProps): React.ReactNode {
  const model = deriveModel(toolName, block)
  return (
    <div data-testid={`tool-owned-${toolName}`} data-state={model.state}>
      <span>{t(model.titleKey)}</span>
      <span>{model.summary}</span>
      {model.output === null ? null : <pre>{model.output}</pre>}
    </div>
  )
}

/** Row for `read`. */
export function ReadRow(props: OwnedProps): React.ReactNode {
  return OwnedRow(props)
}

/** Row for `read_image` on the same primitives as `read`. */
export function ReadImageRow(props: OwnedProps): React.ReactNode {
  return OwnedRow(props)
}

/** Row for `bash`. */
export function BashRow(props: OwnedProps): React.ReactNode {
  return OwnedRow(props)
}

/** Row for `write` and `edit`. */
export function MutationRow(props: OwnedProps): React.ReactNode {
  return OwnedRow(props)
}

/** Row for `grep`, `glob`, and `web_search`. */
export function SearchRow(props: OwnedProps): React.ReactNode {
  return OwnedRow(props)
}

/** Row for `web_fetch`. */
export function WebRow(props: OwnedProps): React.ReactNode {
  return OwnedRow(props)
}
