import type { AutomationTask } from './types.ts'

type LocalTime = { year: number; month: number; day: number; hour: number; minute: number; second: number }

function localTime(epoch: number, timeZone: string): LocalTime {
  const values = new Map(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(epoch).map(part => [part.type, part.value]))
  return {
    year: Number(values.get('year')), month: Number(values.get('month')), day: Number(values.get('day')),
    hour: Number(values.get('hour')), minute: Number(values.get('minute')), second: Number(values.get('second')),
  }
}

function equalLocal(left: LocalTime, right: LocalTime): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day
    && left.hour === right.hour && left.minute === right.minute && left.second === right.second
}

function localToEpoch(value: LocalTime, timeZone: string): number | undefined {
  const target = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second)
  const observed = localTime(target, timeZone)
  const offset = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second) - target
  const candidate = target - offset
  if (equalLocal(localTime(candidate, timeZone), value)) return candidate
  for (let delta = -180; delta <= 180; delta++) {
    const alternate = candidate + delta * 60_000
    if (equalLocal(localTime(alternate, timeZone), value)) return alternate
  }
  return undefined
}

/**
 * Find the next scheduled instant after a claimed occurrence.
 * @param task - task timing and time zone.
 * @param after - previous occurrence timestamp in milliseconds.
 * @returns next occurrence in milliseconds, or undefined when a one-shot ended.
 */
export function nextOccurrence(task: AutomationTask, after: number): number | undefined {
  if (task.timing.at === null) return undefined
  const anchor = Date.parse(task.timing.at)
  if (!Number.isFinite(anchor)) return undefined
  if (task.timing.repeat === 'once') return anchor > after ? anchor : undefined
  if (task.timing.repeat === 'hourly') {
    const next = anchor + Math.max(0, Math.floor((after - anchor) / 3_600_000) + 1) * 3_600_000
    return next > after ? next : undefined
  }

  const zone = task.timing.timeZone
  const initial = localTime(anchor, zone)
  const anchorDay = Date.UTC(initial.year, initial.month - 1, initial.day)
  const afterLocal = localTime(after, zone)
  const afterDay = Date.UTC(afterLocal.year, afterLocal.month - 1, afterLocal.day)
  const firstDay = Math.max(0, Math.floor((afterDay - anchorDay) / 86_400_000))
  const interval = task.timing.repeat === 'weekly' ? 7 : 1
  for (let day = Math.floor(firstDay / interval) * interval; day < firstDay + 370; day += interval) {
    const date = new Date(anchorDay + day * 86_400_000)
    const candidate = localToEpoch({ ...initial, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }, zone)
    if (candidate !== undefined && candidate > after) return candidate
  }
  return undefined
}
