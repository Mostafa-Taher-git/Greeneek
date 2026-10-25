import { Fragment } from 'react'
import { CodeBlock } from '@greeneek/gnk-client-ui-primitives'
import { shallowEqual } from '@greeneek/gnk-client-store'
import type { DetailsSlotProps } from '../contract/slots.ts'
import type { ChatSnapshot, RunningToolCall, ToolCallBlock, ToolResultNode } from '../contract/snapshot.ts'
import { findToolCall } from './tool-node-reader.ts'
import css from './DetailsPanel.module.css'

export type DetailsPanelProps = DetailsSlotProps

/** The snapshot-owned block reference must remain stable across unrelated frames. */
interface CallMaterial {
  name: string
  argsRaw: string | null
  block: ToolCallBlock
}

function settledMaterial(node: ToolResultNode, callId: string): CallMaterial {
  return { name: node.call?.name ?? callId, argsRaw: node.call?.argsRaw ?? null, block: node }
}

function runningMaterial(call: RunningToolCall): CallMaterial {
  return { name: call.name, argsRaw: call.argsRaw, block: call }
}

function materialFor(s: ChatSnapshot, callId: string): CallMaterial | null {
  const found = findToolCall(s, callId)
  if (found === undefined) return null
  return 'kind' in found ? settledMaterial(found, callId) : runningMaterial(found)
}

function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

/** Flatten a settled result for the no-ui-tool fallback. */
function rawResultText(block: ToolCallBlock): string {
  if (!('kind' in block)) return ''
  const parts = block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  if (parts.length === 0 && block.error !== undefined) parts.push(`${block.error.name}: ${block.error.code}`)
  return parts.join('\n')
}

export function DetailsPanel({
  useChat, useSessions, sessionId, useStore, actions, renderSlot, closeDetails, useFleet, t,
}: DetailsPanelProps) {
  const selection = useStore(s => s.selection)
  const tabPick = useStore(s => s.detailsTab)
  const fleetOccupied = useFleet(occupied => occupied)
  // Session workspace root: a card model resolves omitted or relative
  // tool paths against it without reading Session services.
  const sessionCwd = useSessions(list => list.byId[sessionId]?.cwd)
  const callId = selection?.callId
  // materialFor builds a fresh wrapper; shallowEqual short-circuits on its
  // stable members (result node reference rides the snapshot's structural sharing).
  const material = useChat(
    s => (callId === undefined ? null : materialFor(s, callId)),
    (a, b) => shallowEqual(a, b))
  // Arbitration: the Tool body owns the panel until the reader picks the Fleet
  // tab, and a transcript Tool-row click retires that pick. Occupancy of the
  // Fleet slot decides whether the choice exists at all.
  const showFleet = fleetOccupied && tabPick === 'fleet'
  const callName = selection === null ? t('details.title') : material?.name ?? selection.toolName ?? t('details.title')
  return (
    <div className={css.root}>
      <div className={css.header}>
        {fleetOccupied
          ? (
            <div className={css.tabs} role="tablist" aria-label={t('details.tabs.aria')}>
              <button
                type="button" role="tab" className={css.tab} aria-selected={!showFleet}
                onClick={() => { actions.setDetailsTab('tool') }}
              >
                {t('details.tab.tool')}
              </button>
              <button
                type="button" role="tab" className={css.tab} aria-selected={showFleet}
                onClick={() => { actions.setDetailsTab('fleet') }}
              >
                {t('details.tab.fleet')}
              </button>
            </div>
          )
          : <div className={css.title}>{callName}</div>}
        <button
          type="button" className={css.close} aria-label={t('details.close')}
          onClick={() => { closeDetails() }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div
        className={css.body} role="tabpanel"
        aria-label={showFleet ? t('details.tab.fleet') : t('details.tab.tool')}
      >
        {/* The tab strip took the header's title seat, so a selected call names
            itself at the top of its body — including one outside the window. */}
        {!showFleet && fleetOccupied && callId !== undefined && (
          <div className={css.callName}>{callName}</div>
        )}
        {showFleet
          ? renderSlot('conversation.details.fleet', {})
          : selection === null || callId === undefined
            ? <div className={css.empty}>{t('details.empty')}</div>
            : material === null
              ? <div className={css.empty}>{t('details.notInWindow')}</div>
              : (
                <>
                  {material.argsRaw !== null && (
                    <section className={css.section}>
                      <div className={css.sectionLabel}>{t('details.input')}</div>
                      <CodeBlock code={pretty(material.argsRaw)} lang="json" copyLabel={t('copy')} copiedLabel={t('copied')} />
                    </section>
                  )}
                  <section className={css.section}>
                    <div className={css.sectionLabel}>{t('details.output')}</div>
                    {/* Keyed by the selected call: the body owns per-call view
                        state (the terminal card's expand and copy), which React
                        would otherwise carry into the next selection because the
                        panel does not unmount between calls. */}
                    <Fragment key={callId}>
                      {renderSlot('conversation.details.tool', { block: material.block, cwd: sessionCwd }, {
                        fallback: 'kind' in material.block
                          ? (
                            <pre className={css.code} data-error={material.block.isError || undefined}>
                              {rawResultText(material.block)}
                            </pre>
                          )
                          : <div className={css.empty}>{t('details.running')}</div>,
                      })}
                    </Fragment>
                  </section>
                </>
              )}
      </div>
    </div>
  )
}
