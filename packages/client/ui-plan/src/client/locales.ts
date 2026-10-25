/** `plan` namespace dictionaries (the composer plan chip's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'chip.label': 'Plan',
  'chip.on.aria': 'plan mode 已开启，按下关闭',
  'chip.on.title': 'plan mode 已开启 — 点击关闭（/plan off）',
  'chip.off.aria': 'plan mode 已关闭，按下开启',
  'chip.off.title': 'plan mode 已关闭 — 点击开启（/plan）',
  'chip.exitFailed': '退出 plan mode 失败',
} satisfies Record<string, string>

/** The plan namespace key union. */
export type PlanKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'chip.label': 'Plan',
  'chip.on.aria': 'Plan mode on, press to turn off',
  'chip.on.title': 'Plan mode on — click to turn off (/plan off)',
  'chip.off.aria': 'Plan mode off, press to turn on',
  'chip.off.title': 'Plan mode off — click to turn on (/plan)',
  'chip.exitFailed': 'Failed to exit plan mode',
} satisfies Record<PlanKey, string>

/** Arabic dictionary, checked complete against the zh key set. */
export const ar = {
  'chip.label': 'Plan',
  'chip.on.aria': 'وضع plan mode مفعّل، اضغط للإيقاف',
  'chip.on.title': 'وضع plan mode مفعّل — انقر للإيقاف (/plan off)',
  'chip.off.aria': 'وضع plan mode متوقف، اضغط للتفعيل',
  'chip.off.title': 'وضع plan mode متوقف — انقر للتفعيل (/plan)',
  'chip.exitFailed': 'تعذّر الخروج من وضع plan mode',
} satisfies Record<PlanKey, string>
