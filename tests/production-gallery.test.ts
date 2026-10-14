import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { parse, compileScript } from '@vue/compiler-sfc'
import { transformSync } from 'esbuild'
import type { Snapshot, TaskRecord, TaskStatus } from '../src/shared/contracts'
import type { BootstrapPlan, BootstrapState } from '../src/shared/bootstrap'
import { selectCudaRuntime, NVIDIA_DRIVER_URL } from '../src/shared/cuda-runtime'
import { recommendH3Installation } from '../src/shared/h3-installation'

const require = createRequire(import.meta.url)
const root = path.resolve('src/renderer/components')
const componentCache = new Map<string, Vue.Component>()
const icon = Vue.defineComponent({ render: () => Vue.h('svg', { 'aria-hidden': 'true' }) })
let nativeDesktop = false
let nativeInvoke: (command: string, payload?: unknown) => Promise<unknown> = async () => { throw new Error('SSR must not call native actions') }
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
    if (specifier === '../src/api') return { get desktop() { return nativeDesktop }, invoke: (command: string, payload?: unknown) => nativeInvoke(command, payload) }
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

interface UiNode {
  tag: string
  text: string
  children: UiNode[]
  parent: UiNode | null
  props: Record<string, unknown>
  value: unknown
  checked: boolean
  readonly options: UiNode[]
  addEventListener(): void
  removeEventListener(): void
  getRootNode(): null
}
function uiNode(tag: string, text = ''): UiNode {
  return { tag, text, children: [], parent: null, props: {}, value: '', checked: false,
    get options() { return this.children.filter(child => child.tag === 'option') },
    addEventListener() {}, removeEventListener() {}, getRootNode: () => null }
}
function mountedBootstrap(state: BootstrapState, hardware?: Snapshot['hardware']) {
  const calls: string[] = []
  const actions: Array<{ command: string; payload?: unknown }> = []
  nativeInvoke = async (command, payload) => {
    calls.push(command)
    if (command === 'bootstrap.status') return state
    if (command === 'native.openReference') { actions.push({ command, payload }); return }
    throw new Error(`组件触发了测试范围外的操作：${command}`)
  }
  const renderer = Vue.createRenderer<UiNode, UiNode>({
    createElement: tag => uiNode(tag), createText: text => uiNode('#text', text), createComment: () => uiNode('#comment'),
    setText: (node, text) => { node.text = text },
    setElementText: (node, text) => { node.text = text; node.children = [] },
    insertStaticContent(content, parent, anchor) {
      const node = uiNode('#static', content.replace(/<[^>]*>/g, ''))
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index < 0) parent.children.push(node); else parent.children.splice(index, 0, node)
      node.parent = parent
      return [node, node]
    },
    parentNode: node => node.parent,
    nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
    insert(node, parent, anchor) {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index < 0) parent.children.push(node); else parent.children.splice(index, 0, node)
      node.parent = parent
    },
    remove(node) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null },
    patchProp(node, key, _oldValue, value) { node.props[key] = value; if (key === 'value') node.value = value },
  })
  const container = uiNode('root')
  const stateSnapshot = snapshot(); stateSnapshot.settings.initialized = false
  if (hardware) stateSnapshot.hardware = hardware
  const app = renderer.createApp(component('BootstrapSetup.vue'), { snapshot: stateSnapshot })
  app.mount(container)
  const text = (node: UiNode): string => node.text + node.children.map(text).join('')
  const nodes = (node: UiNode): UiNode[] => [node, ...node.children.flatMap(nodes)]
  const buttons = (node: UiNode): UiNode[] => [...(node.tag === 'button' ? [node] : []), ...node.children.flatMap(buttons)]
  return { app, calls, actions, text: () => text(container), buttons: () => buttons(container), nodes: () => nodes(container), buttonText: text }
}

function stubCustomRendererDomClasses(t: TestContext) {
  // v-model text checks the root's DOM type when an existing plan fills its path.
  // This renderer has no browser DOM; only those constructor checks need stubs.
  for (const name of ['Document', 'ShadowRoot']) {
    if (!(name in globalThis)) {
      Object.defineProperty(globalThis, name, { configurable: true, value: class {} })
      t.after(() => { Reflect.deleteProperty(globalThis, name) })
    }
  }
}
function cachedBootstrapState(hardware: Snapshot['hardware'], fullProgress = true): BootstrapState {
  const selection = selectCudaRuntime(hardware)
  const plan: BootstrapPlan = {
    id: 'restored-plan', version: '0.39.0', profile: 'h3', rootPath: 'C:/AI', targetPath: 'C:/AI/luckyx-environment',
    downloadBytes: 21.6 * 1024 ** 3, requiredFreeBytes: 30 * 1024 ** 3, freeBytes: 100 * 1024 ** 3,
    cachedBytes: 21.6 * 1024 ** 3, hardwareIssues: selection.hardwareIssues, runtime: selection.runtime,
    recommendation: recommendH3Installation({ ...hardware, driver: '582.01', cudaVersion: '13.0' }).recommendation,
    files: [{ id: 'model', name: 'minimax_h3_fl2va_pruned_w4a8_mixed.safetensors', kind: 'model', relativePath: 'ComfyUI/models/diffusion_models/minimax_h3_fl2va_pruned_w4a8_mixed.safetensors', sizeBytes: 1024, sha256: 'a'.repeat(64), url: 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/revision/model.safetensors' }],
    tutorialUrl: 'https://docs.comfy.org',
  }
  return { status: 'error', phase: '环境配置待完成', message: '下载文件已保存，等待 GPU 检查。', receivedBytes: fullProgress ? plan.downloadBytes : 0, totalBytes: fullProgress ? plan.downloadBytes : 0, completedFiles: 1, plan, resumable: true, tutorialUrl: plan.tutorialUrl }
}

test('已完整下载的实际安装组件显示继续配置环境，缓存字节恢复也不误称重新下载', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] }); stubCustomRendererDomClasses(t)
  const hardware = { gpuName: 'NVIDIA GeForce RTX 4060', vramMb: 8192, ramGb: 32, driver: '582.01', cudaVersion: '13.0' }
  nativeDesktop = true
  try {
    for (const fullProgress of [true, false]) {
      const mounted = mountedBootstrap(cachedBootstrapState(hardware, fullProgress), hardware)
      try {
        await Promise.resolve(); await Vue.nextTick()
        const text = mounted.text()
        assert.match(text, /NVIDIA 驱动 582\.01/); assert.match(text, /nvidia-smi CUDA 13\.0/)
        assert.match(text, /CUDA 13 · RTX 官方环境/); assert.match(text, /驱动条件符合/)
        assert.match(text, /文件已缓存，继续后会重新校验并配置环境/)
        assert.match(text, /无需重新下载完整模型/)
        const proceed = mounted.buttons().find(button => mounted.buttonText(button) === '继续配置环境')
        assert.ok(proceed, '主按钮应继续配置已缓存环境')
        assert.ok(!mounted.buttons().some(button => mounted.buttonText(button) === '继续下载并安装'))
        const consent = mounted.nodes().find(node => node.tag === 'input' && node.props.type === 'checkbox')
        assert.ok(consent)
        ;(consent.props['onUpdate:modelValue'] as (value: boolean) => void)(true)
        await Vue.nextTick()
        assert.equal(proceed.props.disabled, false, '符合驱动且用户同意后允许继续配置')
        assert.deepEqual(mounted.calls, ['bootstrap.status'], '展示恢复状态不得自行重下载或启动安装')
      } finally { mounted.app.unmount() }
    }
  } finally { nativeDesktop = false; nativeInvoke = async () => { throw new Error('SSR must not call native actions') } }
})

test('实际安装组件明确3070旧驱动与CUDA12.3，保留缓存并链接官方驱动页', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] }); stubCustomRendererDomClasses(t)
  const hardware = { gpuName: 'NVIDIA GeForce RTX 3070', vramMb: 8192, ramGb: 32, driver: '546.30', cudaVersion: '12.3' }
  nativeDesktop = true
  const mounted = mountedBootstrap(cachedBootstrapState(hardware), hardware)
  try {
    await Promise.resolve(); await Vue.nextTick()
    const text = mounted.text()
    assert.match(text, /NVIDIA 驱动 546\.30/); assert.match(text, /nvidia-smi CUDA 12\.3/)
    assert.match(text, /CUDA 13 · RTX 官方环境/); assert.match(text, /需要更新驱动/)
    assert.match(text, /原安装位置、模型和下载进度会保留/)
    assert.doesNotMatch(text, /CUDA 12\.6 · 旧显卡基础环境/)
    const proceed = mounted.buttons().find(button => mounted.buttonText(button) === '继续配置环境')
    assert.ok(proceed)
    const consent = mounted.nodes().find(node => node.tag === 'input' && node.props.type === 'checkbox')
    assert.ok(consent)
    ;(consent.props['onUpdate:modelValue'] as (value: boolean) => void)(true)
    await Vue.nextTick()
    assert.equal(proceed.props.disabled, true, '用户同意也不能绕过驱动前置检查')
    const driverLink = mounted.buttons().find(button => mounted.buttonText(button).includes('打开 NVIDIA 官方驱动下载页'))
    assert.ok(driverLink)
    await (driverLink.props.onClick as () => Promise<void>)()
    assert.deepEqual(mounted.actions, [{ command: 'native.openReference', payload: { url: NVIDIA_DRIVER_URL } }])
    assert.ok(!mounted.calls.includes('bootstrap.start'))
  } finally { mounted.app.unmount(); nativeDesktop = false; nativeInvoke = async () => { throw new Error('SSR must not call native actions') } }
})

test('安装实际组件轮询后错误说明只显示一次，总进度与当前文件区别明确', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const state: BootstrapState = { status: 'error', phase: '安装未完成', message: '下载连接中断，请继续安装。', error: '下载连接中断，请继续安装。', receivedBytes: 1.9 * 1024 ** 3, totalBytes: 21.6 * 1024 ** 3, completedFiles: 1, currentFile: 'minimax_h3_fl2va_pruned_w4a8_mixed.safetensors', tutorialUrl: 'https://docs.comfy.org', resumable: true }
  const mounted = mountedBootstrap(state)
  try {
    await Promise.resolve(); await Vue.nextTick()
    assert.equal(mounted.calls.length, 1)
    const text = mounted.text()
    assert.equal(text.split(state.message).length - 1, 1)
    assert.match(text, /当前文件：minimax_h3_fl2va_pruned_w4a8_mixed\.safetensors/)
    assert.match(text, /总下载进度 1\.9 GiB \/ 21\.6 GiB/)
    assert.match(text, /已保存的下载片段会继续使用/)
    assert.match(text, /完成后自动校验和解压/)
  } finally { mounted.app.unmount(); nativeInvoke = async () => { throw new Error('SSR must not call native actions') } }
  const calls = mounted.calls.length
  t.mock.timers.tick(3000)
  await Promise.resolve(); await Vue.nextTick()
  assert.equal(mounted.calls.length, calls, '卸载组件后必须清理轮询计时器')
})

test('安装暂停保留断点提示，不同的错误详情仍各自显示一次', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  for (const status of ['cancelled', 'error'] as const) {
    const state: BootstrapState = { status, phase: status === 'cancelled' ? '安装已暂停' : '安装未完成', message: '下载进度已保存。', error: status === 'error' ? '代理连接暂时不可用。' : undefined, receivedBytes: 2 * 1024 ** 3, totalBytes: 22 * 1024 ** 3, completedFiles: 1, tutorialUrl: 'https://docs.comfy.org', resumable: true }
    const mounted = mountedBootstrap(state)
    try {
      await Promise.resolve(); await Vue.nextTick()
      const text = mounted.text()
      assert.match(text, /已保存的下载片段会继续使用/)
      assert.equal(text.split(state.message).length - 1, 1)
      if (state.error) assert.equal(text.split(state.error).length - 1, 1)
    } finally { mounted.app.unmount() }
  }
  nativeInvoke = async () => { throw new Error('SSR must not call native actions') }
})

test('已解压环境继续补充模型时，安装错误不会在环境卡和进度卡重复显示', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const state: BootstrapState = { status: 'error', phase: '模型下载未完成', message: '模型连接暂时中断。', error: '模型连接暂时中断。', receivedBytes: 3 * 1024 ** 3, totalBytes: 22 * 1024 ** 3, completedFiles: 1, installationPath: 'C:/AI/luckyx-environment', tutorialUrl: 'https://docs.comfy.org', resumable: true }
  const mounted = mountedBootstrap(state)
  try {
    await Promise.resolve(); await Vue.nextTick()
    const text = mounted.text()
    assert.match(text, /运行环境已解压/)
    assert.match(text, /已保存的下载片段会继续使用/)
    assert.equal(text.split(state.message).length - 1, 1)
  } finally { mounted.app.unmount(); nativeInvoke = async () => { throw new Error('SSR must not call native actions') } }
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

test('已安装 file 文档的主页、工作流、资源与安装页图片均指向真实 ASAR 相对资源', async () => {
  const documentUrl = 'file:///F:/luckyx%20Studio/resources/app.asar/out/renderer/index.html'
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { baseURI: documentUrl } })
  try {
    const state = snapshot()
    const screens = [
      ['主页', await renderToString(Vue.createSSRApp(component('StudioHome.vue'), { snapshot: state, busy: false })), 4],
      ['工作流', await page('library', state), 2],
      ['安装页', await page('setup', state), 1],
      ['资源中心', await page('resources', state), 5],
    ] as const
    for (const [name, html, minimum] of screens) {
      const images = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1])
      assert.ok(images.length >= minimum, `${name}未渲染应有的配图`)
      for (const image of images) {
        assert.ok(image.startsWith('file:///F:/luckyx%20Studio/resources/app.asar/out/renderer/'), `${name}破图路径：${image}`)
        const relative = decodeURIComponent(image.slice(new URL('.', documentUrl).href.length))
        const file = path.resolve('src/renderer/public', relative)
        assert.ok(fs.existsSync(file), `${name}图片文件缺失：${relative}`)
        assert.ok(fs.statSync(file).size > 0, `${name}图片文件为空：${relative}`)
      }
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})
