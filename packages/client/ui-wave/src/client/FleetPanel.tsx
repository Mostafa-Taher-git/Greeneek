import { useEffect } from 'react'
import { StateDot } from '@greeneek/gnk-client-ui-primitives'
import type { FleetPanelProps } from './contract.ts'
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
 * Fleet rows for one Lead session: the wave headers with their live members, one
 * stop affordance per level, and the emergency stop that stays reachable while
 * any wave is open.
 * @param props - the live mirror, the stop verbs, and the fleet copy.
 * @returns the details-panel Fleet body.
 */
export function FleetPanel({
  t, useFleet, refresh, stopAll, stopWave, stopMember, openChild,
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
              const rowName = `${member.role ?? member.provider} · ${t(state.label)} · ${t('tokens', { tokens: member.tokensUsed })}`
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
                    <span className={css.tokens}>{t('tokens', { tokens: member.tokensUsed })}</span>
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
        </section>
      ))}
    </div>
  )
}
