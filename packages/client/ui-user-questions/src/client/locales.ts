/** `question` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'error.incomplete': '请先完成这道问题。',
  'error.unanswered': '请选择一个选项或填写自定义答案。',
  'nav.prev': '上一题',
  'nav.next': '下一题',
  'nav.minimize': '收起问题卡片',
  'nav.maximize': '展开问题卡片',
  'nav.cancel': '放弃整组问题',
  'option.recommended': '推荐',
  'custom.placeholder': '输入你的答案',
  'action.skip': '跳过本题',
  'action.next': '下一题',
  'plan.header': '计划待审',
  'plan.approve': '确认执行',
  'plan.decline': '拒绝',
  'plan.discuss': '去聊天里说',
} satisfies Record<string, string>

/** The question namespace key union. */
export type QuestionKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'error.incomplete': 'Please complete this question first.',
  'error.unanswered': 'Please select an option or enter a custom answer.',
  'nav.prev': 'Previous question',
  'nav.next': 'Next question',
  'nav.minimize': 'Collapse the question card',
  'nav.maximize': 'Expand the question card',
  'nav.cancel': 'Dismiss all questions',
  'option.recommended': 'Recommended',
  'custom.placeholder': 'Type your answer',
  'action.skip': 'Skip this question',
  'action.next': 'Next',
  'plan.header': 'Plan review',
  'plan.approve': 'Approve',
  'plan.decline': 'Refuse',
  'plan.discuss': 'Chat about it',
} satisfies Record<QuestionKey, string>

/** Arabic dictionary, checked complete against the zh key set. */
export const ar = {
  'error.incomplete': 'أكمل هذا السؤال أولًا.',
  'error.unanswered': 'اختر خيارًا أو أدخل إجابة مخصصة.',
  'nav.prev': 'السؤال السابق',
  'nav.next': 'السؤال التالي',
  'nav.minimize': 'طيّ بطاقة الأسئلة',
  'nav.maximize': 'توسيع بطاقة الأسئلة',
  'nav.cancel': 'تجاهل كل الأسئلة',
  'option.recommended': 'موصى به',
  'custom.placeholder': 'اكتب إجابتك',
  'action.skip': 'تخطي هذا السؤال',
  'action.next': 'التالي',
  'plan.header': 'مراجعة الخطة',
  'plan.approve': 'اعتماد التنفيذ',
  'plan.decline': 'رفض',
  'plan.discuss': 'المناقشة في المحادثة',
} satisfies Record<QuestionKey, string>
