/** Locale dictionaries for the GitHub Branches and Issues pages. */

/** Simplified Chinese — the key-set source of truth. */
export const zh = {
  branches: '分支',
  issues: '问题',
  close: '关闭',
  noWorkspace: '没有选中的工作区。',
  noRepository: '当前工作区没有 GitHub 仓库。',
  unconfigured: '未配置 GitHub 令牌。',
  loadFailed: '无法加载 GitHub 数据。',
  retry: '重试',
  emptyBranches: '没有分支。',
  emptyIssues: '没有问题。',
  protected: '受保护',
  openOnGitHub: '在 GitHub 上打开',
} as const

export type GithubPagesLocaleKey = keyof typeof zh

export const en: Record<GithubPagesLocaleKey, string> = {
  branches: 'Branches',
  issues: 'Issues',
  close: 'Close',
  noWorkspace: 'No workspace is selected.',
  noRepository: 'The current workspace has no GitHub repository.',
  unconfigured: 'No GitHub token is configured.',
  loadFailed: 'GitHub data could not be loaded.',
  retry: 'Retry',
  emptyBranches: 'No branches found.',
  emptyIssues: 'No issues found.',
  protected: 'Protected',
  openOnGitHub: 'Open on GitHub',
}

export const ar: Record<GithubPagesLocaleKey, string> = {
  branches: 'الفروع',
  issues: 'المسائل',
  close: 'إغلاق',
  noWorkspace: 'لا توجد مساحة عمل محددة.',
  noRepository: 'مساحة العمل الحالية لا تحتوي على مستودع GitHub.',
  unconfigured: 'لم يتم إعداد رمز GitHub.',
  loadFailed: 'تعذّر تحميل بيانات GitHub.',
  retry: 'إعادة المحاولة',
  emptyBranches: 'لم يتم العثور على فروع.',
  emptyIssues: 'لم يتم العثور على مسائل.',
  protected: 'محمي',
  openOnGitHub: 'فتح في GitHub',
}
