/** `sidebar` namespace dictionaries: shell controls (brand row, New Session, fold toggle). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'brand.name': 'Greeneek',
  'session.new': '新会话',
  'session.new.label': '新建会话',
  'brand.home': '回到主页',
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '收起侧边栏',
  'toggle.threadDetails.aria': '切换线程详情',
  'toggle.terminalDrawer.aria': '切换终端抽屉',
  'toggle.rightPanel.aria': '切换右侧面板',
} satisfies Record<string, string>

/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'brand.name': 'Greeneek',
  'session.new': 'New Session',
  'session.new.label': 'New session',
  'brand.home': 'Go to home',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
  'toggle.threadDetails.aria': 'Toggle thread details',
  'toggle.terminalDrawer.aria': 'Toggle terminal drawer',
  'toggle.rightPanel.aria': 'Toggle right panel',
} satisfies Record<SidebarKey, string>

/** Arabic dictionary, checked complete against the zh key set; the brand name stays verbatim. */
export const ar = {
  'brand.name': 'Greeneek',
  'session.new': 'جلسة جديدة',
  'session.new.label': 'إنشاء جلسة',
  'brand.home': 'العودة إلى الرئيسية',
  'toggle.open': 'فتح الشريط الجانبي',
  'toggle.collapse': 'طيّ الشريط الجانبي',
  'toggle.threadDetails.aria': 'تبديل تفاصيل سلسلة العمل',
  'toggle.terminalDrawer.aria': 'تبديل درج الطرفية',
  'toggle.rightPanel.aria': 'تبديل اللوحة اليمنى',
} satisfies Record<SidebarKey, string>
