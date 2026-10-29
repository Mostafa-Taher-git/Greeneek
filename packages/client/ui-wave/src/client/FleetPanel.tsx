import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { StateDot } from '@greeneek/gnk-client-ui-primitives'
import type { WaveArtifactPointer, WaveView } from '@greeneek/gnk-subagent-wave/client'
import type { RemoteResult } from '@greeneek/gnk-typert-protocol'
import type { FleetInjected, FleetPanelProps } from './contract.ts'
import { isCancellable, MEMBER_STATE } from './member-state.ts'
import css from './FleetPanel.module.css'
import { useEmergencyStop } from './use-stop.ts'

/**
 * Render a settled member duration: whole milliseconds under one second, whole
 * seconds above it.
 * @param durationMs - launch-to-settlement milliseconds from the engine.
 * @param t - the fleet translator.
 * @returns the compact duration cell text.
 */
function formatDuration(durationMs: number, t: FleetPanelProps['t']): string {
  const elapsed = Math.max(0, durationMs)
  return elapsed < 1_000
    ? t('duration.milliseconds', { milliseconds: Math.round(elapsed) })
    : t('duration.seconds', { seconds: Math.round(elapsed / 1_000) })
}

/**
 * Render one validated artifact pointer as its address. The kind is the
 * pointer's own vocabulary, so the label is the raw address.
 * @param pointer - the engine-validated pointer.
 * @returns the pointer's address text.
 */
function pointerLabel(pointer: WaveArtifactPointer): string {
  return pointer.kind === 'file' ? pointer.path ?? '' : pointer.uri ?? ''
}

/**
 * Parse one budget field: a positive safe integer, or nothing. An empty or
 * malformed field means "unset", and the action stays disabled until at least
 * one field parses.
 * @param value - the field's raw text.
 * @returns the parsed ceiling, or undefined.
 */
function budgetOf(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * One closed budget-interrupted wave's resume card: the exact remaining
 * members, two budget inputs, and the admission answer as a notice line. The
 * card disappears once the view carries `resumedToWaveId` — admission is the
 * commit point, and the resumed wave's own section shows its progress.
 * @param props - the interrupted wave, the fleet copy, and the resume verb.
 * @returns the card, or nothing for a wave that is not resumable.
 */
function ResumeCard({ wave, t, resume }: {
  wave: WaveView
  t: FleetPanelProps['t']
  resume: FleetInjected['resume']
}): ReactNode {
  const [perMember, setPerMember] = useState('')
  const [waveBudget, setWaveBudget] = useState('')
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const perMemberBudget = budgetOf(perMember)
  const waveTokens = budgetOf(waveBudget)
  const record = (outcome: RemoteResult<unknown>): void => {
    setPending(false)
    setNotice(outcome.ok
      ? t('resume.started')
      : t('resume.failed', { message: outcome.error.message, code: outcome.error.code }))
  }
  return (
    <div className={css.resume}>
      <div className={css.resumeRemaining}>
        {t('resume.remaining', {
          members: wave.members
            .filter(member => member.status !== 'completed')
            .map(member => member.role ?? member.provider)
            .join(', '),
        })}
      </div>
      <label className={css.resumeField}>
        <span>{t('resume.budget.member')}</span>
        <input
          type="number"
          min={1}
          step={1}
          value={perMember}
          onChange={(event) => { setPerMember(event.target.value) }}
        />
      </label>
      <label className={css.resumeField}>
        <span>{t('resume.budget.wave')}</span>
        <input
          type="number"
          min={1}
          step={1}
          value={waveBudget}
          onChange={(event) => { setWaveBudget(event.target.value) }}
        />
      </label>
      <button
        type="button"
        className={css.resumeAction}
        disabled={pending || (perMemberBudget === undefined && waveTokens === undefined)}
        onClick={() => {
          setPending(true)
          setNotice(null)
          void resume(wave.waveId, perMemberBudget, waveTokens).then(record)
        }}
      >
        {t('resume.action')}
      </button>
      {notice !== null && <span className={css.resumeNotice} role="status">{notice}</span>}
    </div>
  )
}

/**
 * Fleet rows for one Lead session: the wave headers with their live members, one
 * stop affordance per level, and the emergency stop that stays reachable while
 * any wave is open.
 * @param props - the live mirror, the stop verbs, and the fleet copy.
 * @returns the details-panel Fleet body.
 */
export function FleetPanel({
  t, useFleet, refresh, stopAll, stopWave, stopMember, resume, openChild,
}: FleetPanelProps) {
  const snapshot = useFleet(view => view)
  const stop = useEmergencyStop(t, stopAll)

  // The mirror already samples on its own cadence; this only shortens the wait
  // for a surface the reader has just opened.
  useEffect(() => { refresh() }, [refresh])

  if (snapshot.loading) return <div className={css.notice}>{t('panel.loading')}</div>
  if (snapshot.waveViews.length === 0) {
    return <div className={css.notice}>{snapshot.degraded ? t('panel.degraded') : t('panel.empty')}</div>
  }

  return (
    <div className={css.root}>
      <div className={css.toolbar}>
        <button
          type="button"
          className={css.stopAll}
          data-armed={stop.armed || undefined}
          disabled={!snapshot.stoppable}
          onClick={stop.click}
        >
          {t(stop.armed ? 'stop.all.confirm' : 'stop.all')}
        </button>
        {stop.notice !== null && <span className={css.toolbarNotice} role="status">{stop.notice}</span>}
      </div>
      {snapshot.degraded && <div className={css.degraded}>{t('panel.degraded')}</div>}
      {snapshot.waveViews.map(wave => (
        <section key={wave.waveId} className={css.wave}>
          <div className={css.waveHeader}>
            <span className={css.waveLabel} title={wave.label}>{wave.label}</span>
            <span className={css.waveMeta}>{t('wave.members', { count: wave.members.length })}</span>
            {wave.closed && <span className={css.waveMeta}>{t('wave.closed')}</span>}
            {!wave.closed && (
              <button
                type="button"
                className={css.waveStop}
                onClick={() => { void stopWave(wave.waveId).then(stop.report) }}
              >
                {t('stop.wave')}
              </button>
            )}
          </div>
          <ul className={css.rows}>
            {wave.members.map((member) => {
              const childSessionId = member.childSessionId
              const state = MEMBER_STATE[member.status]
              // Spend reads against the wave's member ceiling when one exists;
              // an unmetered or uncapped member reports its plain token count.
              const spend = member.budgetUsed !== undefined && member.budgetLimit !== undefined
                ? t('budget', { used: member.budgetUsed, cap: member.budgetLimit })
                : t('tokens', { tokens: member.tokensUsed })
              const rowName = `${member.role ?? member.provider} · ${t(state.label)} · ${spend}`
              return (
                <li key={member.memberId} className={css.row}>
                  <span className={css.rowMain}>
                    <StateDot state={state.dot} className={css.rowDot} />
                    <span className={css.role} title={member.role ?? member.provider}>{member.role ?? member.provider}</span>
                    {member.model !== undefined && <span className={css.model} title={member.model}>{member.model}</span>}
                    <span className={css.status}>{t(state.label)}</span>
                    {member.lastTool !== undefined && (
                      <span className={css.lastTool} title={t('lastTool', { tool: member.lastTool })}>
                        {member.lastTool}
                      </span>
                    )}
                    {member.durationMs !== undefined && (
                      <span className={css.duration}>{formatDuration(member.durationMs, t)}</span>
                    )}
                    {member.artifacts !== undefined && member.artifacts.length > 0 && (
                      <span
                        className={css.artifacts}
                        title={member.artifacts.map(pointerLabel).join('\n')}
                      >
                        {t('artifacts.count', { count: member.artifacts.length })}
                      </span>
                    )}
                    <span className={css.tokens}>{spend}</span>
                  </span>
                  {isCancellable(member.status) && (
                    <button
                      type="button"
                      className={css.rowAction}
                      aria-label={`${t('stop.member')}: ${rowName}`}
                      onClick={() => { void stopMember(wave.waveId, member.memberId).then(stop.report) }}
                    >
                      {t('stop.member')}
                    </button>
                  )}
                  {childSessionId !== undefined && (
                    <button
                      type="button"
                      className={css.rowAction}
                      onClick={() => { openChild(childSessionId) }}
                    >
                      {t('open.child')}
                    </button>
                  )}
                  {member.diagnostic !== undefined && (
                    <div className={css.diagnostic} title={member.diagnostic}>{member.diagnostic}</div>
                  )}
                </li>
              )
            })}
          </ul>
          {wave.closed && wave.resumedToWaveId === undefined
            && wave.members.some(member => member.status === 'budget-killed') && (
            <ResumeCard wave={wave} t={t} resume={resume} />
          )}
        </section>
      ))}
    </div>
  )
}
