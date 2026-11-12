/**
 * Thread Details action that opens the Session's trajectory.
 */
import type { ReactNode } from 'react'
import { Button } from '@greeneek/gnk-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@greeneek/gnk-client-ui-slots'
import { NS } from './locales.ts'

/** The cross-surface navigation the action owns. */
export interface TrajectoryDetailsActionInjected {
  selectView: (view: string) => void
}

export type TrajectoryDetailsActionProps =
  PropsRuntime<'conversation.details.actions'>
  & PropsLocale<typeof NS>
  & InjectFace<TrajectoryDetailsActionInjected>

/**
 * Render the trajectory action inside Thread Details.
 * @param props - Session identity, view navigation, and localized copy.
 * @returns the action button.
 */
export function TrajectoryDetailsAction({
  selectView,
  t,
}: TrajectoryDetailsActionProps): ReactNode {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={t('action.trajectory')}
      onClick={() => { selectView('trajectory') }}
    >
      {t('action.trajectory')}
    </Button>
  )
}
