/** `command` namespace dictionaries (the popupSelect shell's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'search.placeholder': '搜索…',
  'search.aria': '筛选选项',
  'status.loading': '正在加载选项…',
  'status.applying': '正在应用…',
  'status.empty': '无选项',
  'overlay.aria': '/{command} 选项',
  'listbox.aria': '/{command} 匹配项',
  'notice.imagesUnsupported': '/{command} 不接受图片附件，请先移除图片',
  'section.nav': '命令',
  'section.lead': '当前会话可用的斜杠指令（输入 / 同样可以打开指令菜单）',
  'section.loading': '正在加载指令…',
  'section.error': '指令加载失败',
  'section.retry': '重试',
  'section.empty': '该会话没有可用指令',
  'section.noSession': '没有当前会话——打开一个会话后可在此查看它的指令',
} satisfies Record<string, string>

/** The command namespace key union. */
export type CommandKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'search.placeholder': 'Search…',
  'search.aria': 'Filter options',
  'status.loading': 'Loading options…',
  'status.applying': 'Applying…',
  'status.empty': 'No options',
  'overlay.aria': '/{command} options',
  'listbox.aria': '/{command} matches',
  'notice.imagesUnsupported': '/{command} does not accept image attachments; remove them first',
  'section.nav': 'Commands',
  'section.lead': 'Slash commands available to the current session (typing / opens the same command menu)',
  'section.loading': 'Loading commands…',
  'section.error': 'Commands failed to load',
  'section.retry': 'Retry',
  'section.empty': 'No commands available to this session',
  'section.noSession': 'No active session — open one to see its commands here',
} satisfies Record<CommandKey, string>
