import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { parse, compileScript } from '@vue/compiler-sfc'
import { transformSync } from 'esbuild'
import type { Snapshot, TaskRecord, TaskStatus } from '../src/shared/contracts'

const require = createRequire(import.meta.url)
const root = path.resolve('src/renderer/components')
const componentCache = new Map<string, Vue.Component>()
const icon = Vue.defineComponent({ render: () => Vue.h('svg', { 'aria-hidden': 'true' }) })
function component(name: string): Vue.Component {
  const cached = componentCache.get(name)
  if (cached) return cached
  const file = path.join(root, name)
  const { descriptor } = parse(fs.readFileSync(file, 'utf8'), { filename: file })
  const source = compileScript(descriptor, { id: `gallery-test-${name}`, inlineTemplate: true }).content
  const compiled = transformSync(source, { loader: 'ts', format: 'cjs' }).code
  const module = { exports: {} as { default: Vue.Component } }
  const localRequire = (specifier: string) => {
    if (specifier === 'vue') return Vue
    if (specifier === '@phosphor-icons/vue') return new Proxy({}, { get: () => icon })
    if (specifier === '../src/api') return { desktop: false, invoke: async () => { throw new Error('SSR must not call native actions') } }
    if (specifier.endsWith('.vue')) return component(path.basename(specifier))
    return require(path.resolve(path.dirname(file), specifier) + '.ts')
  }
  // Compile the production SFC rather than copying its template into a fixture.
  new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports)
  componentCache.set(name, module.exports.default)
  return module.exports.default
}
function snapshot(): Snapshot {
  return {
    settings: { installationPath: 'C:/AI/ComfyUI', modelPath: 'C:/AI/models', inputPath: 'C:/AI/input', outputPath: 'C:/AI/output', engineUrl: 'http://127.0.0.1:8188', initialized: true },
    hardware: { gpuName: 'NVIDIA GeForce RTX 4060', vramMb: 8192, ramGb: 32, driver: 'test' },
    engine: { status: 'offline', managed: false, queue: 0, message: '未连接' },
    templates: [{ id: 'h3-i2v', name: '真实 H3 模板', description: '本地 H3', ready: false, issues: [], models: ['real-model.safetensors'], resolutions: [], defaultSteps: 4, frames: 124, fps: 24 }],
    userWorkflows: [], tasks: [], resources: [], logs: [], presets: []
  }
}
const preferences = { motion: 'auto', transparency: 'auto', contrast: 'auto' }
const mediaUrl = () => 'http://localhost/actual-user-output.mp4'
async function page(name: string, state: Snapshot) {
  return renderToString(Vue.createSSRApp(component('SecondaryPages.vue'), { page: name, snapshot: state, busy: false, mediaUrl, uiPreferences: preferences }))
}
function task(status: TaskStatus, id = 'actual-task'): TaskRecord {
  return { id, title: '真实任务名称', status, createdAt: '2026-10-14T02:00:00Z', updatedAt: '2026-10-14T02:00:00Z', stage: '测试阶段', params: { mode: 'text', templateId: 'h3-i2v', prompt: '真实提示词', width: 512, height: 288, frames: 49, steps: 4, seed: 42 }, outputs: status === 'completed' ? [{ filename: 'actual-user-output.mp4', subfolder: '', type: 'output', url: '/actual-user-output.mp4' }] : [] }
}

test('正式工作流库展示真实导入记录与图文模式入口，离线禁用编辑器并转义名称', async () => {
  const state = snapshot()
  state.userWorkflows = [{ id: 'mine', name: '我的流程 <script>alert(1)</script>', format: 'api', nodeCount: 21, createdAt: '2026-10-14T02:00:00Z', updatedAt: '2026-10-14T02:00:00Z' }]
  const html = await page('library', state)
  assert.match(html, /图片开始创作/)
  assert.match(html, /文字开始创作/)
  assert.match(html, /我的流程 &lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /导入 JSON/)
  assert.match(html, /新建工作流/)
  assert.match(html, /disabled[^>]*>打开节点编辑器/)
  assert.match(html, /aria-label="导出 我的流程/)
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
})

test('个人工作流分页限制单页 12 项，搜索匹配真实名称', async () => {
  const state = snapshot()
  state.userWorkflows = Array.from({ length: 1000 }, (_, i) => ({ id: `flow-${i}`, name: `流程 ${i}`, format: 'ui' as const, nodeCount: i, createdAt: '2026-10-14T02:00:00Z', updatedAt: '2026-10-14T02:00:00Z' }))
  const render = (query: string) => renderToString(Vue.createSSRApp(component('WorkflowLibrary.vue'), { snapshot: state, query, busy: false }))
  const html = await render('')
  assert.equal((html.match(/class="panel personal-card"/g) ?? []).length, 12)
  assert.match(html, /1,000/)
  const filtered = await render('流程 999')
  assert.equal((filtered.match(/class="panel personal-card"/g) ?? []).length, 1)
  assert.match(filtered, /流程 999/)
})

test('已完成历史保留真实视频和导出、回填、删除入口，不伪造封面结果', async () => {
  const state = snapshot(); state.tasks = [task('completed')]
  const html = await page('tasks', state)
  assert.match(html, /actual-user-output\.mp4/)
  assert.match(html, /导出 MP4/)
  assert.match(html, /回填参数/)
  assert.match(html, /删除历史记录/)
  assert.doesNotMatch(html, /重新生成/)
  assert.doesNotMatch(html, /forest-preview\.webp/)
})

test('运行中与状态待确认任务不能删除，失败任务保留重试操作', async () => {
  for (const status of ['running', 'queued', 'submitting', 'unknown'] as const) {
    const state = snapshot(); state.tasks = [task(status)]
    const html = await page('tasks', state)
    assert.doesNotMatch(html, />删除历史记录</)
    assert.doesNotMatch(html, />确认删除记录</)
  }
  const state = snapshot(); state.tasks = [task('failed')]
  const html = await page('tasks', state)
  assert.match(html, /重新生成/)
  assert.match(html, /删除历史记录/)
})

test('1000 条任务仅渲染单页 20 项与分页入口', async () => {
  const state = snapshot(); state.tasks = Array.from({ length: 1000 }, (_, i) => task('completed', `task-${i}`))
  const html = await page('tasks', state)
  assert.equal((html.match(/class="task-row(?: selected)?"/g) ?? []).length, 20)
  assert.match(html, /共 1000 条/)
  assert.match(html, /下一页/)
})

test('银灰常规设置保留全部真实路径与界面偏好，浏览器不写假关闭设置', async () => {
  const html = await page('settings', snapshot())
  for (const field of ['installationPath', 'modelPath', 'outputPath', 'inputPath']) assert.match(html, new RegExp(`id="settings-${field}"`))
  assert.match(html, /id="settings-url"/)
  for (const field of ['ui-motion', 'ui-transparency', 'ui-contrast']) assert.match(html, new RegExp(`id="${field}"`))
  assert.match(html, /请在桌面版中设置窗口关闭方式/)
  assert.doesNotMatch(html, /id="close-behavior"/)
})

test('正式主页显示真实设备与作品，灵感图片明确标为风格示例', async () => {
  const state = snapshot(); state.tasks = [task('completed')]; state.tasks[0].title = '我的作品 <script>danger</script>'
  const html = await renderToString(Vue.createSSRApp(component('StudioHome.vue'), { snapshot: state, busy: false }))
  assert.match(html, /让想象，有画面/); assert.match(html, /NVIDIA GeForce RTX 4060/); assert.match(html, /8\.0 GB 显存/)
  assert.match(html, /我的作品 &lt;script&gt;danger&lt;\/script&gt;/); assert.match(html, /导入工作流/)
  assert.equal((html.match(/风格示例/g) ?? []).length, 4); assert.doesNotMatch(html, /演示配置/)
  const recent = html.slice(html.indexOf('<section class="recent-section"'))
  assert.doesNotMatch(recent, /forest-preview|coast-inspiration|camera-studio/)
})

test('安装页识别已解压环境而非首次安装，8GB首次方案明确社区且无音频', async () => {
  const existing = await page('setup', snapshot())
  assert.match(existing, /运行环境已解压/); assert.match(existing, /C:\/AI\/ComfyUI/)
  assert.doesNotMatch(existing, /id="bootstrap-profile"/); assert.doesNotMatch(existing, /第一次使用/)
  const state = snapshot(); state.settings.initialized = false; state.hardware.ramGb = 16
  const first = await page('setup', state)
  assert.match(first, /H3 Lite/); assert.match(first, /社区低配方案/); assert.match(first, /仅视频/)
  assert.match(first, /608 × 352/); assert.match(first, /8 GB 显存起/); assert.doesNotMatch(first, /模型（16 GB 显存起/)
})

test('关闭确认提供后台、退出和记住选择，提示活动下载及保留外部引擎', async () => {
  const html = await renderToString(Vue.createSSRApp(component('CloseApplicationDialog.vue'), { request: { id: 'native-request', source: 'window', activeTasks: 2, activeDownloads: true, managedEngine: false, externalEngine: true }, opener: null }))
  for (const text of ['继续后台运行', '退出并停止后台', '记住我的选择', '2 个任务尚未结束', '下次打开可继续', '外部启动的 ComfyUI 会保留']) assert.ok(html.includes(text), text)
  assert.match(html, /role="dialog" aria-modal="true"/); assert.match(html, /取消关闭/)
})
