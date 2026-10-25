/**
 * Emergency-stop control shared by the two fleet surfaces.
 *
 * One click on a mass cancel is the cheapest way to destroy a fleet the reader
 * did not mean to stop, so the button arms first and disarms itself when the
 * second click never comes. Both the details-panel Fleet tab and the composer
 * pill render the affordance, and the Host answer belongs beside the button
 * that produced it, so the panel feeds its row-level stops through `report`.
 * @module @greeneek/gnk-client-ui-wave/client/use-stop
 */
import { useEffect, useRef, useState } from 'react'
import type { RemoteResult } from '@greeneek/gnk-typert-protocol'
import type { TranslateNS } from '@greeneek/gnk-client-ui-slots'
import type { StopAllOutcome } from './contract.ts'

/** How long the arming lasts before the button returns to its idle label. */
const STOP_CONFIRM_MS = 5_000

/** Live state of one emergency-stop button and the notice line beside it. */
export interface EmergencyStop {
  /** The button waits for its confirming second click. */
  armed: boolean
  /** Last Host answer in words, or nothing since the previous stop. */
  notice: string | null
  /** Arm on the first call, fire on the second. */
  click: () => void
  /**
   * Record one stop verb's answer.
   * @param outcome - the Remote result the Host returned.
   */
  report: (outcome: RemoteResult<unknown>) => void
}

/**
 * Bind the arming sequence and the Host answer to one stop callback.
 * @param t - the fleet namespace translator.
 * @param stopAll - the emergency-stop verb.
 * @returns the button's state, its click handler, and the answer recorder.
 */
export function useEmergencyStop(
  t: TranslateNS<'fleet'>,
  stopAll: () => Promise<StopAllOutcome>,
): EmergencyStop {
  const [armed, setArmed] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // The arming decision must read the value as it is at click time: a state
  // snapshot captured in the render closure still says "not armed" to the
  // confirming click that follows an arming click in the same commit.
  const armedNow = useRef(false)

  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => {
      armedNow.current = false
      setArmed(false)
    }, STOP_CONFIRM_MS)
    return () => { clearTimeout(timer) }
  }, [armed])

  const report = (outcome: RemoteResult<unknown>): void => {
    setNotice(outcome.ok
      ? t('stop.stopped')
      : t('stop.failed', { message: outcome.error.message, code: outcome.error.code }))
  }

  return {
    armed,
    notice,
    report,
    click: () => {
      if (!armedNow.current) {
        armedNow.current = true
        setArmed(true)
        setNotice(null)
        return
      }
      armedNow.current = false
      setArmed(false)
      void stopAll().then(report)
    },
  }
}
