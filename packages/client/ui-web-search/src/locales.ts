/** `settings.web-search` namespace dictionaries (the search-engine row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'engine.title': '搜索引擎',
  'engine.description': '模型用它联网搜索。DuckDuckGo 免密钥即可用；其它引擎需要在启动环境中配置密钥。',
  'engine.auto': '自动',
  'engine.duckduckgo': 'DuckDuckGo',
  'engine.google': 'Google',
  'engine.exa': 'Exa',
  'engine.perplexity': 'Perplexity',
  'engine.custom': '自定义',
  'custom.endpointLabel': '自定义端点',
  'custom.endpointPlaceholder': 'https://…/anthropic',
  'custom.modelLabel': '模型',
  'custom.modelPlaceholder': '模型名称',
  'custom.save': '保存',
  'custom.hint': '兼容 Anthropic Messages 的搜索端点；密钥请放在启动环境的 GREENEEK_API_KEY 中。',
} satisfies Record<string, string>

/** The settings.web-search namespace key union. */
export type SettingsWebSearchKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'engine.title': 'Search engine',
  'engine.description': 'Models search the web through it. DuckDuckGo works with no key; other engines need their keys in the launch environment.',
  'engine.auto': 'Auto',
  'engine.duckduckgo': 'DuckDuckGo',
  'engine.google': 'Google',
  'engine.exa': 'Exa',
  'engine.perplexity': 'Perplexity',
  'engine.custom': 'Custom',
  'custom.endpointLabel': 'Custom endpoint',
  'custom.endpointPlaceholder': 'https://…/anthropic',
  'custom.modelLabel': 'Model',
  'custom.modelPlaceholder': 'Model name',
  'custom.save': 'Save',
  'custom.hint': 'An Anthropic Messages-compatible search endpoint; keep the key in the launch environment as GREENEEK_API_KEY.',
} satisfies Record<SettingsWebSearchKey, string>
