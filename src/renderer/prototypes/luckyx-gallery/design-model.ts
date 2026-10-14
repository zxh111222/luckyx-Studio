export const pages = [
  { key:'home', name:'首页' }, { key:'workflows', name:'工作流库' }, { key:'create', name:'创作工作台' },
  { key:'tasks', name:'任务与作品' }, { key:'resources', name:'资源中心' }, { key:'setup', name:'安装与连接' },
  { key:'settings', name:'设置与诊断' }, { key:'transform', name:'视频改造' }
] as const
export type PageKey = typeof pages[number]['key']
export function readPage(search: string): PageKey {
  const value = new URLSearchParams(search).get('p')
  return pages.find(page => page.key === value)?.key ?? 'home'
}
export function parsePreferences(value: unknown) {
  let parsed: Record<string,unknown> = {}
  try { parsed = typeof value === 'string' ? JSON.parse(value) : (value || {}) as Record<string,unknown> } catch { }
  return { motion:parsed?.motion === 'reduce', contrast:parsed?.contrast === 'more', solid:parsed?.transparency === 'solid' }
}
