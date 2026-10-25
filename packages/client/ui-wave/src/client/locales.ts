/** `fleet` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'fleet'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'panel.loading': '正在载入舰队…',
  'panel.empty': '本会话当前没有进行中的 Army 舰队。',
  'panel.degraded': '舰队视图暂时不可用：与宿主的连接中断。',
  'wave.members': '{count} 名成员',
  'wave.closed': '已结束',
  'status.queued': '排队中',
  'status.running': '运行中',
  'status.completed': '已完成',
  'status.failed': '失败',
  'status.cancelled': '已取消',
  'status.budgetKilled': '超预算终止',
  'tokens': '{tokens} tok',
  'stop.member': '停止成员',
  'stop.wave': '停止本舰队',
  'stop.all': '紧急停止',
  'stop.all.confirm': '再次点击，确认停止全部成员',
  'stop.stopped': '已发送停止指令',
  'stop.failed': '停止失败：{message}（{code}）',
  'open.child': '打开子会话',
  'pill.open.aria': '打开 Army 舰队面板',
  'pill.label': '{label} · 运行中 {running}',
  'pill.label.degraded': '{label} · 视图过时',
  'pill.stop.aria': '紧急停止全部舰队',
  'pill.close.aria': '关闭舰队面板',
} satisfies Record<string, string>

/** The fleet namespace key union. */
export type FleetKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'panel.loading': 'Loading the fleet…',
  'panel.empty': 'No active Army waves for this session.',
  'panel.degraded': 'The fleet view is temporarily unavailable: the host connection dropped.',
  'wave.members': '{count} members',
  'wave.closed': 'Closed',
  'status.queued': 'Queued',
  'status.running': 'Running',
  'status.completed': 'Completed',
  'status.failed': 'Failed',
  'status.cancelled': 'Cancelled',
  'status.budgetKilled': 'Budget-killed',
  'tokens': '{tokens} tok',
  'stop.member': 'Stop member',
  'stop.wave': 'Stop wave',
  'stop.all': 'Emergency stop',
  'stop.all.confirm': 'Click again to confirm stopping every member',
  'stop.stopped': 'Stop issued',
  'stop.failed': 'Stop failed: {message} ({code})',
  'open.child': 'Open child session',
  'pill.open.aria': 'Open the Army fleet panel',
  'pill.label': '{label} · {running} running',
  'pill.label.degraded': '{label} · view stale',
  'pill.stop.aria': 'Emergency-stop the whole fleet',
  'pill.close.aria': 'Close the fleet panel',
} satisfies Record<FleetKey, string>
