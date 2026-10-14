import type { Snapshot, TaskRecord, TaskStatus, UserWorkflow } from '../../shared/contracts'

export const STRESS_MODES = ['demo', 'worst', 'empty', 'one', 'many'] as const
export type StressMode = typeof STRESS_MODES[number]
export function readStressMode(search: string): StressMode {
  const value = new URLSearchParams(search).get('data')
  return STRESS_MODES.find(mode => mode === value) ?? 'demo'
}
export function stressUrl(url: string, mode: StressMode): string {
  const next = new URL(url)
  if (mode === 'demo') next.searchParams.delete('data')
  else next.searchParams.set('data', mode)
  return next.href
}

// These are renderer-only defensive inputs, never accepted as a save/import payload.
export const STRESS_NOTES = [
  '工作流名遵守后端 80 字符上限；提示词遵守 10000 字符上限。',
  '260 字符目录、1024 排队任务和 1000 行用于布局与分页压力。',
  '空 GPU、NaN 显存/内存、142% 与 -3% 进度仅测试显示防御，不代表真实设备或生成。',
  '示例模式只读；不会保存、安装、运行、导入或打开原生编辑器。'
] as const
const titles = [
  '跨境品牌秋冬新品发布 · 雾林晨光与城市夜景 · Aleksandra Wiśniewska-Kowalczyk · 最终审核第十二版',
  'J', '王秀英的家庭影像', '🦊 Fox · 👩🏽‍💻 创作', 'نور الهدى عبد الرحمن',
  'Đặng Thị Ngọc Hân · Ólafur Darri Ólafsson', '<script>alert(1)</script> &amp; **原样文本**',
  'Benachrichtigungseinstellungen_20261014_FinalApprovedVideo'
]
function nameAt(index: number): string { return Array.from(titles[index % titles.length]).slice(0, 76).join('') }
const prompt = '雨后清晨，镜头沿树林缓慢前进，人物停下聆听风声；保留自然光和环境音。'.repeat(400).slice(0, 10000)
const statuses: TaskStatus[] = ['running', 'failed', 'queued', 'completed', 'interrupted', 'unknown', 'submitting']
function workflow(index: number): UserWorkflow {
  return { id: `stress-workflow-${index}`, name: nameAt(index), format: index % 2 ? 'ui' : 'api', nodeCount: index % 2 ? 2000 : 1, createdAt: '2023-01-01T00:00:00Z', updatedAt: '2026-10-14T08:00:00Z' }
}
function task(index: number): TaskRecord {
  const status = statuses[index % statuses.length]
  return {
    id: `stress-task-${index}`, title: nameAt(index), status,
    createdAt: index % 3 ? '2026-10-14T08:00:00Z' : '2023-01-01T00:00:00Z', updatedAt: '2026-10-14T08:00:00Z',
    params: { templateId: 'h3-i2v', mode: index % 2 ? 'image' : 'text', prompt: index ? titles[index % titles.length] : prompt, width: 864, height: 480, frames: 124, steps: 4, seed: 20261014 },
    stage: '示例数据 · 显示防御测试 · 不是真实生成结果',
    error: status === 'failed' ? '模型加载失败：请核对模型目录、节点依赖与显存容量。该长错误信息用于测试诊断区域换行和完整阅读。'.repeat(5) : undefined,
    progress: index % 3 === 0 ? { value: 142, max: 100 } : index % 3 === 1 ? { value: -3, max: 100 } : { value: Number.NaN, max: 100 },
    outputs: [] // No fictitious playable result or network media.
  }
}
export function getStressSnapshot(real: Snapshot, mode: StressMode): Snapshot {
  const snapshot = structuredClone(real)
  if (mode === 'demo') return snapshot
  const count = mode === 'empty' ? 0 : mode === 'one' ? 1 : mode === 'many' ? 1000 : 8
  const longPath = ('C:\\Users\\创作团队\\视频项目\\跨境品牌秋冬新品发布\\审核资料\\').repeat(8).slice(0, 240) + '\\最终版本\\输出文件'
  snapshot.settings = { ...snapshot.settings, installationPath: longPath, modelPath: longPath, inputPath: longPath, outputPath: longPath }
  snapshot.hardware = { gpuName: '', vramMb: Number.NaN, ramGb: Number.NaN, driver: '' }
  snapshot.engine = { status: 'offline', managed: false, queue: mode === 'empty' ? 0 : mode === 'one' ? 1 : 1024, message: '示例模式 · 未连接真实引擎' }
  snapshot.templates = snapshot.templates.map(template => ({ ...template, ready: false, issues: ['示例模式只读：运行、安装与保存已阻止。'] }))
  snapshot.userWorkflows = Array.from({ length: count }, (_, index) => workflow(index))
  snapshot.tasks = Array.from({ length: count }, (_, index) => task(index))
  snapshot.resources = mode === 'empty' ? [] : [{ id: 'stress-resource', name: 'minimax_h3_fl2va_pruned_int8_convrot_项目归档_最终审核版.safetensors', path: longPath, sizeBytes: 20970379616, status: 'missing', kind: 'model' }]
  snapshot.presets = mode === 'empty' ? [] : [{ id: 'stress-preset', name: '品牌秋冬发布 · 长镜头自然光与声音 · 第十二版', params: structuredClone(snapshot.tasks[0].params) }]
  snapshot.logs = mode === 'empty' ? [] : [{ at: '2026-10-14T08:00:00Z', level: 'warn', message: STRESS_NOTES.join(' ') }]
  return snapshot
}
export type StressInvoke = (command: string, payload?: unknown) => Promise<unknown>
export function createStressInvoker(getMode: () => StressMode, getReal: () => Snapshot | null, realInvoke: StressInvoke): StressInvoke {
  return async (command, payload) => {
    const mode = getMode()
    if (mode === 'demo') return realInvoke(command, payload)
    const real = getReal()
    if (command === 'snapshot') { if (!real) throw new Error('请先读取真实快照后启用示例数据。'); return getStressSnapshot(real, mode) }
    if (command === 'workflow.list') return real ? getStressSnapshot(real, mode).userWorkflows : []
    if (command === 'workflow.recipes') return []
    if (command === 'bootstrap.status') return { status: 'idle', phase: '示例模式', message: '示例模式只读，安装已阻止', receivedBytes: 0, totalBytes: 0, completedFiles: 0, tutorialUrl: 'https://docs.comfy.org/installation/manual_install' }
    throw new Error('示例数据模式只读：请切回 Demo data 后再操作。')
  }
}
