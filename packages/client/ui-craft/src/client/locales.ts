/** `craft` namespace dictionaries: the Craft settings section and artifact card. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'craft'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'section.nav': 'Craft',
  'section.lead': '本机 Craft 应用的无头桥接：查看安装状态、检查安装，并在会话中直接使用它们的工具。',
  'section.loading': '正在读取 Craft 应用状态…',
  'section.error': 'Craft 应用状态读取失败',
  'section.retry': '重试',
  'section.empty': '此版本没有可用的 Craft 应用',
  'section.unavailable': '桌面版 Craft 桥接在当前环境中不可用——安装 Greeneek 桌面版后即可在此管理应用。',
  'state.not-installed': '未安装',
  'state.app-installed-cli-missing': '已安装应用，缺少命令行工具',
  'state.ready': '就绪',
  'state.running': '运行中',
  'state.unavailable': '桥接不可用',
  'action.check': '检查安装',
  'action.checking': '正在检查…',
  'action.launch': '连接并打开',
  'action.launching': '正在打开…',
  'action.launcher': '打开应用',
  'action.download': '下载',
  'action.failed': '操作失败，请重试',
  'artifact.title': 'Craft 产物',
  'artifact.count': '{count} 个文件',
  'artifact.running': '正在生成…',
  'artifact.failed': 'Craft 调用失败',
  'artifact.empty': '本次调用没有产物',
  'artifact.openAria': '打开 {name}',
} satisfies Record<string, string>

/** The craft namespace key union. */
export type CraftKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'section.nav': 'Craft',
  'section.lead': 'Headless bridge for local Craft apps: inspect installation state, check an install, and use their tools inside a session.',
  'section.loading': 'Reading Craft app state…',
  'section.error': 'Craft app state failed to load',
  'section.retry': 'Retry',
  'section.empty': 'No Craft apps are available in this build',
  'section.unavailable': 'The desktop Craft bridge is unavailable here — install the Greeneek desktop app to manage Craft apps.',
  'state.not-installed': 'Not installed',
  'state.app-installed-cli-missing': 'App installed, CLI missing',
  'state.ready': 'Ready',
  'state.running': 'Running',
  'state.unavailable': 'Bridge unavailable',
  'action.check': 'Check installation',
  'action.checking': 'Checking…',
  'action.launch': 'Open connected',
  'action.launching': 'Opening…',
  'action.launcher': 'Open app',
  'action.download': 'Download',
  'action.failed': 'Action failed — try again',
  'artifact.title': 'Craft artifacts',
  'artifact.count': '{count} files',
  'artifact.running': 'Rendering…',
  'artifact.failed': 'Craft call failed',
  'artifact.empty': 'No artifacts from this call',
  'artifact.openAria': 'Open {name}',
} satisfies Record<CraftKey, string>
