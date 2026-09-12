/**
 * `model` namespace dictionaries.
 *
 * `trigger.selectAria` intentionally matches `trigger.fallback` but remains a
 * separate key: the visible fallback label and the accessible name of
 * an unset trigger are free to diverge per locale, and folding it into
 * `trigger.aria` would announce the degenerate "Select model, current Select
 * model".
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'command.description': '选择本会话使用的模型',
  'option.loadError': '目录加载失败：{message}',
  'trigger.fallback': '选择模型',
  'trigger.loading': '正在加载模型…',
  'trigger.selectAria': '选择模型',
  'trigger.aria': '选择模型，当前 {model}',
  'trigger.ariaEffort': '选择模型，当前 {model}，推理等级 {effort}',
  'menu.aria': '模型与推理等级',
  'menu.model': '模型',
  'menu.effort': '推理等级',
  'model.searchAria': '搜索模型',
  'model.searchPlaceholder': '搜索模型…',
  'model.emptySearch': '没有匹配的模型，换个关键词试试。',
  'effort.providerDefault': 'Default',
  'status.loading': '正在刷新模型列表…',
  'error.action': '模型操作失败：{message}',
  'action.reload': '重新加载',
  'warning.groupLoad': '{name} 加载失败：{message}',
  'empty.models': '没有可用的模型。',
  'blocked.composer': '当前模型不可用，请先选择模型',
  'empty.efforts': '当前模型未提供推理等级。',
  'panel.searchAria': '搜索模型',
  'panel.searchPlaceholder': '搜索模型…',
  'panel.listAria': '模型列表',
  'panel.detailAria': '模型详情',
  'panel.emptySearch': '没有匹配的模型，换个关键词试试。',
  'panel.reasoning': '推理等级',
  'panel.promptAria': '提示词',
  'panel.promptPlaceholder': '你想做什么？',
  'panel.send': '发送',
  'metric.intelligence': '智能',
  'metric.speed': '速度',
  'metric.context': '上下文',
  'metric.cost': '成本',
} satisfies Record<string, string>

/** The model namespace key union. */
export type ModelKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'command.description': 'Select the model for this conversation',
  'option.loadError': 'Catalog failed to load: {message}',
  'trigger.fallback': 'Select model',
  'trigger.loading': 'Loading models…',
  'trigger.selectAria': 'Select model',
  'trigger.aria': 'Select model, current {model}',
  'trigger.ariaEffort': 'Select model, current {model}, reasoning effort {effort}',
  'menu.aria': 'Model and reasoning effort',
  'menu.model': 'Model',
  'menu.effort': 'Effort',
  'model.searchAria': 'Search models',
  'model.searchPlaceholder': 'Search models…',
  'model.emptySearch': 'No matching models — try a different search.',
  'effort.providerDefault': 'Default',
  'status.loading': 'Refreshing model list…',
  'error.action': 'Model operation failed: {message}',
  'action.reload': 'Reload',
  'warning.groupLoad': '{name} failed to load: {message}',
  'empty.models': 'No models available.',
  'blocked.composer': 'This model is unavailable — select one to continue',
  'empty.efforts': 'This model provides no reasoning effort levels.',
  'panel.searchAria': 'Search models',
  'panel.searchPlaceholder': 'Search models…',
  'panel.listAria': 'Model list',
  'panel.detailAria': 'Model details',
  'panel.emptySearch': 'No matching models — try a different search.',
  'panel.reasoning': 'Reasoning',
  'panel.promptAria': 'Prompt',
  'panel.promptPlaceholder': 'What do you want to do?',
  'panel.send': 'Send',
  'metric.intelligence': 'Intelligence',
  'metric.speed': 'Speed',
  'metric.context': 'Context',
  'metric.cost': 'Cost',
} satisfies Record<ModelKey, string>
