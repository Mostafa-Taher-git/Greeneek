/** Shared localized relative-time label for workspace and dashboard rows. */

import { relativeTime } from '@greeneek/gnk-client-ui-primitives'
import type { WorkspaceBrowserProps } from './contract/slots.ts'

/**
 * Render one localized compact relative time ("now"/"5min").
 * @param updatedAt - last update epoch milliseconds.
 * @param now - render-clock epoch milliseconds shared by the row pass.
 * @param t - workspace dictionary translator.
 * @returns the compact relative-time label.
 */
export function timeLabel(updatedAt: number, now: number, t: WorkspaceBrowserProps['t']): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
}
