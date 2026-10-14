<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, shallowRef, watch, type Component } from 'vue'
import {
  PhHouse, PhFolderOpen, PhPlay, PhListBullets, PhDatabase, PhGear,
  PhMinus, PhSquare, PhX, PhCpu, PhDesktop, PhCheckCircle, PhImageSquare,
  PhUploadSimple, PhCaretRight, PhCaretDown, PhFloppyDisk, PhExport,
  PhArrowSquareOut, PhArrowClockwise, PhStop, PhInfo, PhWarningCircle,
  PhFilmStrip, PhSpinnerGap, PhShuffle
} from '@phosphor-icons/vue'
import SecondaryPages from '../components/SecondaryPages.vue'
import VideoTransformStudio from '../components/VideoTransformStudio.vue'
import { desktop, invoke, mediaUrl, subscribe, setUiStressInterceptor } from './api'
import type { GenerationParams, Snapshot, TaskRecord } from '../../shared/contracts'
import { H3_RESOLUTIONS, H3_DURATIONS, h3FramesForSeconds, isVerifiedH3Configuration } from '../../shared/h3-parameters'
import { validateGenerationParams } from '../../shared/workflow'
import { createFocusTrap, createUiPreferencesController, DEFAULT_UI_PREFERENCES, type UiPreferences } from './ui-preferences'
import type { StressMode } from './ui-stress'
import './motion.css'

const state = ref<Snapshot | null>(null)
const page = ref('home')
const workbenchKind = ref('generate')
const busy = ref(false)
const bootError = ref('')
const toast = ref('')
const toastError = ref(false)
const advanced = ref(false)
const presetOpen = ref(false)
const presetName = ref('')
const presetId = ref('')
const inputPreview = ref('')
const inputName = ref('')
const inputError = ref('')
const selectedTaskId = ref('')
const taskDrawer = ref(false)
const uploadInput = ref<HTMLInputElement | null>(null)
const previewVideo = ref<HTMLVideoElement | null>(null)
const mainContent = ref<HTMLElement | null>(null)
const presetDialog = ref<HTMLElement | null>(null)
const drawerElement = ref<HTMLElement | null>(null)
const drawerTrigger = ref<HTMLButtonElement | null>(null)
const compactLayout = ref(false)
const layoutChanging = ref(false)
const drawerInstant = ref(false)
const modalInstant = ref(false)
const toastInstant = ref(false)
const uiPreferences = ref<UiPreferences>({ ...DEFAULT_UI_PREFERENCES })
const stressControls = shallowRef<Component | null>(null)
const stressMode = ref<StressMode>('demo')
const stressReadonly = computed(() => import.meta.env.DEV && stressMode.value !== 'demo')
const uiBusy = computed(() => busy.value || stressReadonly.value)
let stressModule: typeof import('./ui-stress') | undefined
let realSnapshot: Snapshot | null = null
let uiController: ReturnType<typeof createUiPreferencesController> | undefined
let presetOpener: HTMLElement | null = null
let pendingFocusRestore: HTMLElement | null = null
let releaseModalFocus: ((restore?: boolean) => void) | undefined
let layoutMedia: MediaQueryList | undefined
let unsubscribe = () => {}
let toastTimer = 0
let autoValidate = false
let closing = false

const params = reactive<GenerationParams>({
  templateId: 'h3-i2v', mode: 'image', prompt: '', width: 864, height: 480,
  frames: 124, steps: 4, seed: 20261013
})
const customResolution = ref(false)
const customDuration = ref(false)
const durationError = ref('')
const requestedSeconds = ref(5)
const resolutionChoice = computed({
  get: () => customResolution.value || !H3_RESOLUTIONS.some(r => r.width === params.width && r.height === params.height) ? 'custom' : `${params.width}x${params.height}`,
  set: (value: string) => { customResolution.value = value === 'custom'; if (!customResolution.value) { const [width, height] = value.split('x').map(Number); params.width = width; params.height = height } }
})
const durationChoice = computed({
  get: () => customDuration.value || !H3_DURATIONS.includes(params.frames) ? 'custom' : String(params.frames),
  set: (value: string) => { customDuration.value = value === 'custom'; durationError.value = ''; if (!customDuration.value) params.frames = Number(value); else requestedSeconds.value = params.frames / 24 }
})
function adjustDuration() {
  try { params.frames = h3FramesForSeconds(Number(requestedSeconds.value)); durationError.value = '' }
  catch (error) { durationError.value = error instanceof Error ? error.message : '时长无效' }
}
const dimensionError = computed(() => { try { validateGenerationParams({ ...params, prompt: '参数检查' }); return '' } catch (error) { return error instanceof Error ? error.message : '参数无效' } })
const verifiedConfiguration = computed(() => isVerifiedH3Configuration(params.width, params.height, params.frames, params.mode ?? 'image'))
const nav = [
  { id: 'home', label: '首页', icon: PhHouse },
  { id: 'library', label: '工作流库', icon: PhFolderOpen },
  { id: 'workbench', label: '创作工作台', icon: PhPlay },
  { id: 'tasks', label: '任务与作品', icon: PhListBullets },
  { id: 'resources', label: '资源中心', icon: PhDatabase },
  { id: 'settings', label: '设置与诊断', icon: PhGear }
]
const engineNames: Record<string, string> = {
  offline: '引擎未启动', starting: '正在启动', ready: '引擎就绪', busy: '引擎运行中', error: '引擎异常'
}
const engineName = computed(() => engineNames[state.value?.engine.status || ''] || '连接本地服务')
const engineReady = computed(() => ['ready', 'busy'].includes(state.value?.engine.status || ''))
const template = computed(() => state.value?.templates[0])
const canGenerate = computed(() => Boolean(engineReady.value && template.value?.ready && (params.mode === 'text' || params.image) && params.prompt.trim() && !uiBusy.value && !dimensionError.value && !durationError.value))
const localModelCount = computed(() => state.value?.resources.filter(r => r.kind === 'model' && r.status === 'installed').length || 0)
const completed = computed(() => state.value?.tasks.filter(t => t.status === 'completed' && t.outputs.length) || [])
const selectedTask = computed(() => state.value?.tasks.find(t => t.id === selectedTaskId.value) || state.value?.tasks[0])
const selectedOutput = computed(() => selectedTask.value?.status === 'completed' ? selectedTask.value.outputs[0] : undefined)
const selectedPercent = computed(() => {
  const progress = selectedTask.value?.progress
  return progress && progress.max > 0 ? Math.round(Math.min(1, Math.max(0, progress.value / progress.max)) * 100) : 0
})
const taskNames: Record<string, string> = { submitting: '提交中', queued: '排队中', running: '生成中', completed: '已完成', failed: '失败', interrupted: '已中断', unknown: '状态待确认' }
const vram = computed(() => Number.isFinite(state.value?.hardware.vramMb) && (state.value?.hardware.vramMb || 0) > 0 ? `${(state.value!.hardware.vramMb / 1024).toFixed(1)} GB` : '待检测')
const ram = computed(() => Number.isFinite(state.value?.hardware.ramGb) && (state.value?.hardware.ramGb || 0) > 0 ? `${state.value!.hardware.ramGb} GB` : '待检测')
const formatDate = (date: string) => new Date(date).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

function notify(message: string, error = false, instant = uiController?.inputMethod === 'keyboard') {
  toastInstant.value = instant
  toast.value = message; toastError.value = error
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toast.value = '' }, error ? 8000 : 4500)
}

function accept(snapshot: Snapshot) {
  if (closing) return
  const previousReady = engineReady.value
  realSnapshot = snapshot
  state.value = stressModule?.getStressSnapshot(snapshot, stressMode.value) ?? snapshot
  if (!stressReadonly.value && !previousReady && engineReady.value && !autoValidate) {
    autoValidate = true
    void invoke('template.validate').then(refresh).catch(() => {}).finally(() => { autoValidate = false })
  }
}
async function refresh() {
  if (stressReadonly.value && realSnapshot && stressModule) { state.value = stressModule.getStressSnapshot(realSnapshot, stressMode.value); return }
  accept(await invoke<Snapshot>('snapshot'))
}

async function run(command: string, payload?: unknown) {
  if (uiBusy.value) return
  const instant = uiController?.inputMethod === 'keyboard'
  const announce = (message: string, error = false) => notify(message, error, instant)
  busy.value = true
  try {
    const result = await invoke(command, payload)
    if (command === 'settings.save') await invoke('diagnostics.run')
    await refresh()
    if (command === 'task.submit' || command === 'task.retry') {
      const task = result as TaskRecord
      selectedTaskId.value = task.id
      if (task.status === 'failed' || task.status === 'unknown') announce(task.error || task.stage, true)
      else announce('任务已提交，进度会自动更新')
    } else if (command === 'engine.start') announce('已请求启动，正在等待引擎就绪')
    else if (command === 'engine.stop') announce('已请求停止本地引擎')
    else if (command === 'template.validate' || command === 'diagnostics.run') {
      announce(state.value?.templates[0]?.ready ? '资源与节点检查通过，可以开始创作' : state.value?.templates[0]?.issues[0] || '请查看诊断结果', !state.value?.templates[0]?.ready)
    } else if (command === 'task.cancel') announce('已请求取消，任务状态以引擎返回为准')
    else if (command === 'task.remove') announce('历史记录已删除，视频和素材文件已保留')
    else if (command === 'preset.save') { presetOpen.value = false; announce('参数预设已保存') }
    else if (command === 'settings.save') announce('本地配置已保存')
    else if (command === 'native.export' && result !== false) announce(desktop ? '视频已导出' : '视频下载已发起')
    else if (command === 'resource.scan') announce(`已发现 ${localModelCount.value} 个本地模型文件`)
    return result
  } catch (error) {
    announce(error instanceof Error ? error.message : '操作未完成，请查看诊断', true)
  } finally { busy.value = false }
}

function navigate(next: string) {
  previewVideo.value?.pause(); page.value = next; taskDrawer.value = false
  void nextTick(() => mainContent.value?.scrollTo({ top: 0, behavior: 'auto' }))
}
function create() { navigate(state.value?.settings.initialized || engineReady.value ? 'workbench' : 'setup') }
function restore(task: TaskRecord) {
  const image = params.image
  Object.assign(params, task.params, { image, mode: task.params.mode ?? 'image' })
  customResolution.value = false; customDuration.value = false; durationError.value = ''; requestedSeconds.value = params.frames / 24
  selectedTaskId.value = task.id
  navigate('workbench')
  notify(image ? '历史参数已回填，保留当前素材' : '历史参数已回填，请上传首帧图片后生成')
}
async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  inputError.value = ''
  if (file.size > 10 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    inputError.value = '请选择 10 MB 以内的 PNG、JPEG 或 WebP 图片。'
    return
  }
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('图片读取失败，请重新选择'))
    reader.readAsDataURL(file)
  }).catch(() => '')
  if (!data) { inputError.value = '图片读取失败，请重新选择。'; return }
  params.image = { name: file.name, dataBase64: data }
  inputPreview.value = data; inputName.value = file.name
}
async function submit() {
  if (!canGenerate.value) return
  await run('task.submit', JSON.parse(JSON.stringify({ ...params, image: params.mode === 'text' ? undefined : params.image })))
}
function savePreset() { void run('preset.save', { name: presetName.value, params: { ...params, image: undefined } }) }
function choosePreset() {
  const preset = state.value?.presets.find(p => p.id === presetId.value)
  if (preset) { Object.assign(params, preset.params, { image: params.image, mode: preset.params.mode ?? 'image' }); customResolution.value = false; customDuration.value = false; durationError.value = ''; requestedSeconds.value = params.frames / 24 }
}
function randomizeSeed() { params.seed = crypto.getRandomValues(new Uint32Array(1))[0] }
function windowControl(action: 'minimize' | 'maximize' | 'close') { window.luckyx?.windowControl(action) }

function openPreset(event: MouseEvent) {
  if (uiBusy.value) return
  presetOpener = event.currentTarget as HTMLElement
  modalInstant.value = event.detail === 0
  presetName.value = ''; presetOpen.value = true
}
function restorePresetFocus() {
  if (!busy.value && pendingFocusRestore?.isConnected && !pendingFocusRestore.matches(':disabled')) {
    pendingFocusRestore.focus({ preventScroll: true }); pendingFocusRestore = null
  }
}
function closeDrawer() {
  taskDrawer.value = false
  void nextTick(() => { if (compactLayout.value) drawerTrigger.value?.focus({ preventScroll: true }) })
}
function toggleDrawer(event: MouseEvent) { drawerInstant.value = event.detail === 0; taskDrawer.value ? closeDrawer() : taskDrawer.value = true }
function closeWithEscape(event: KeyboardEvent) {
  if (event.key === 'Escape' && !presetOpen.value && compactLayout.value && taskDrawer.value) {
    event.preventDefault(); drawerInstant.value = true; closeDrawer()
  }
}
function updateLayout() {
  layoutChanging.value = true
  compactLayout.value = Boolean(layoutMedia?.matches)
  if (!compactLayout.value) taskDrawer.value = false
  void nextTick(() => { layoutChanging.value = false })
}
function updateUiPreferences(value: UiPreferences) { uiController?.update(value) }
function retireSurface(element: Element) { element.setAttribute('inert', ''); element.setAttribute('aria-hidden', 'true') }
function activateSurface(element: Element) { element.removeAttribute('inert'); element.removeAttribute('aria-hidden') }
function updateStressMode(value: StressMode) {
  if (!import.meta.env.DEV || !stressModule) return
  stressMode.value = value
  history.replaceState(null, '', stressModule.stressUrl(location.href, value))
  if (realSnapshot) state.value = stressModule.getStressSnapshot(realSnapshot, value)
  presetOpen.value = false; taskDrawer.value = false
}
watch(presetOpen, async open => {
  await nextTick()
  releaseModalFocus?.(false); releaseModalFocus = undefined
  if (open && presetOpen.value && presetDialog.value) {
    releaseModalFocus = createFocusTrap(presetDialog.value, presetOpener, () => { modalInstant.value = true; presetOpen.value = false })
  } else if (!open) { pendingFocusRestore = presetOpener; restorePresetFocus() }
})
watch(busy, async value => { if (!value) { await nextTick(); restorePresetFocus() } })
watch(taskDrawer, async value => { if (value && compactLayout.value) { await nextTick(); drawerElement.value?.focus({ preventScroll: true }) } })

watch(page, () => previewVideo.value?.pause())
onMounted(async () => {
  uiController = createUiPreferencesController({ root: document.documentElement, events: document, windowEvents: window, storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }, matchMedia: query => window.matchMedia(query), onChange: value => uiPreferences.value = value })
  layoutMedia = window.matchMedia('(max-width: 1359px)'); updateLayout()
  layoutMedia.addEventListener('change', updateLayout)
  document.addEventListener('keydown', closeWithEscape)
  if (import.meta.env.DEV) {
    const [controls, fixtures] = await Promise.all([import('../components/StressControls.vue'), import('./ui-stress')])
    if (closing) return
    stressControls.value = controls.default; stressModule = fixtures
    stressMode.value = fixtures.readStressMode(location.search)
  }
  try { accept(await invoke<Snapshot>('snapshot')) } catch { bootError.value = '本地服务未连接，请确认启动器已启动后重试。' }
  if (closing) return
  if (import.meta.env.DEV && stressModule) {
    const fixtures = stressModule
    setUiStressInterceptor((command, payload, next) => fixtures.createStressInvoker(() => stressMode.value, () => realSnapshot, next)(command, payload), () => stressMode.value !== 'demo')
  }
  unsubscribe = subscribe(accept)
})
onUnmounted(() => { closing = true; unsubscribe(); window.clearTimeout(toastTimer); previewVideo.value?.pause(); releaseModalFocus?.(false); uiController?.dispose(); layoutMedia?.removeEventListener('change', updateLayout); document.removeEventListener('keydown', closeWithEscape); if (import.meta.env.DEV) setUiStressInterceptor(null) })
</script>

<template>
  <div class="studio-app">
    <header class="titlebar" :inert="presetOpen">
      <span class="title-brand"><img src="/brand/luckyx-app.svg" width="20" height="20" alt="" />luckyx. Studio <span class="title-subtitle"><span class="title-separator">·</span> 视频工作流启动器</span></span>
      <div class="title-actions"><span class="build-label">{{ desktop ? '本地创作' : '浏览器预览' }}</span><button :disabled="!desktop" aria-label="最小化窗口" @click="windowControl('minimize')"><PhMinus :size="16" /></button><button :disabled="!desktop" aria-label="最大化窗口" @click="windowControl('maximize')"><PhSquare :size="14" /></button><button class="window-close" :disabled="!desktop" aria-label="关闭窗口" @click="windowControl('close')"><PhX :size="16" /></button></div>
    </header>
    <div class="app-frame" :inert="presetOpen">
      <aside class="sidebar">
        <a class="brand" href="#home" aria-label="luckyx. Studio 首页" @click.prevent="navigate('home')"><img class="brand-icon" src="/brand/luckyx-symbol.svg" width="32" height="32" alt="" /><span class="brand-wordmark"><strong>luckyx.</strong><span>Studio</span></span></a>
        <nav aria-label="主要导航"><button v-for="item in nav" :key="item.id" :class="['nav-item', { active: page === item.id }]" :aria-current="page === item.id ? 'page' : undefined" :aria-label="item.label" :title="item.label" @click="navigate(item.id)"><component :is="item.icon" :size="21" weight="regular" /><span>{{ item.label }}</span></button></nav>
        <div class="sidebar-bottom"><button class="setup-link" @click="navigate('setup')"><PhFolderOpen :size="17" />安装与连接<PhCaretRight :size="14" /></button><div class="engine-indicator"><span :class="['status-dot', state?.engine.status]" />{{ engineName }}</div><p>本地创作<br />素材留在你的电脑</p><span class="version">v0.1.5 · 本地创作</span></div>
      </aside>
      <main ref="mainContent" class="main-content" :class="{ 'workbench-main': page === 'workbench' && workbenchKind === 'generate' }">
        <div v-if="!state" class="boot-state"><PhSpinnerGap v-if="!bootError" :size="32" class="spinning" /><PhWarningCircle v-else :size="32" /><h1>{{ bootError ? '连接尚未完成' : '准备你的创作工作台' }}</h1><p class="muted">{{ bootError || '正在读取本地环境和任务记录…' }}</p><button v-if="bootError" class="btn primary" @click="refresh().then(() => bootError = '').catch(() => {})">重试连接</button></div>
        <section v-else-if="page === 'home'" class="home-page">
          <header class="page-heading"><h1>从一张图片，开始创作。</h1><p class="muted">选好工作流，剩下的交给工作台。</p></header>
          <div class="home-feature"><figure class="hero-visual"><img src="/forest-preview.webp" alt="雾林晨光，图生视频模板的静态风格示例" fetchpriority="high" /><figcaption>模板风格示例 · 非生成结果</figcaption></figure><div class="panel feature-details"><div><p class="eyebrow">精选工作流</p><h2>MiniMax H3 · 图生视频</h2><p class="muted">把静态画面，变成一段故事。</p></div><dl><div><dt>输入</dt><dd>图片 + 提示词</dd></div><div><dt>输出</dt><dd>带音轨的 MP4 视频</dd></div><div><dt>运行方式</dt><dd>本地</dd></div></dl><div><button class="btn primary full-width" @click="create"><PhPlay :size="19" weight="fill" />开始创作</button><p class="feature-caption">{{ template?.ready ? '资源与节点已检查' : `${localModelCount} 个本地模型 · 启动后检查节点` }}</p></div></div></div>
          <section class="home-device"><h2 class="section-heading">设备与环境</h2><div class="panel device-strip"><div class="device-item"><PhCpu :size="28" /><div><span class="muted label">设备</span><strong>{{ state.hardware.gpuName || '显卡待检测' }}</strong><small class="muted">{{ vram }} 显存 · {{ ram }} 内存</small></div></div><div class="device-item"><PhDesktop :size="25" /><div><span class="muted label">环境</span><strong><PhCheckCircle v-if="state.settings.initialized" :size="17" weight="fill" class="accent" />{{ state.settings.initialized ? '已有环境已识别' : '尚未连接环境' }}</strong></div></div><div class="device-item"><PhGear :size="26" /><div><span class="muted label">服务</span><strong><span :class="['status-dot', state.engine.status]" />{{ engineName }}</strong><small v-if="engineReady && !state.engine.managed" class="muted">外部服务 · 已接入</small></div></div><div class="engine-actions"><button v-if="!engineReady" class="btn secondary" :disabled="uiBusy || state.engine.status === 'starting'" @click="run('engine.start')"><PhSpinnerGap v-if="state.engine.status === 'starting'" :size="16" class="spinning" />{{ state.engine.status === 'starting' ? '启动中…' : '启动引擎' }}</button><template v-else-if="state.engine.managed"><button class="btn secondary compact" :disabled="uiBusy" title="重新启动本地引擎" aria-label="重启引擎" @click="run('engine.restart')"><PhArrowClockwise :size="18" /></button><button class="btn secondary" :disabled="uiBusy" @click="run('engine.stop')"><PhStop :size="16" />停止引擎</button></template><button v-else class="btn secondary" :disabled="uiBusy" @click="run('diagnostics.run')">检查环境</button></div></div></section>
          <section class="home-recent"><div class="section-title-row"><h2 class="section-heading">最近作品</h2><button class="text-button" @click="navigate('tasks')">查看全部<PhCaretRight :size="15" /></button></div><div v-if="!completed.length" class="panel recent-empty"><PhFilmStrip :size="28" /><div><strong>第一段作品，从这里开始。</strong><p class="muted">完成的视频会自动保存在这里，随时预览和导出。</p></div><button class="text-button" @click="create">去创作<PhCaretRight :size="16" /></button></div><div v-else class="panel recent-list"><button v-for="task in completed.slice(0, 3)" :key="task.id" class="recent-row" @click="restore(task)"><PhFilmStrip :size="28" /><div><strong>{{ task.title }}</strong><p class="muted">{{ formatDate(task.createdAt) }} · MiniMax H3 {{ task.params.mode === 'text' ? '文生视频' : '图生视频' }}</p></div><span class="completed-status"><PhCheckCircle :size="18" weight="fill" />已完成</span><span class="text-link">打开作品<PhCaretRight :size="16" /></span></button></div></section>
        </section>
        <section v-else-if="page === 'workbench'" class="workbench-page">
          <header class="page-heading workbench-heading"><div><h1>创作工作台</h1><p class="muted">MiniMax H3 · {{ workbenchKind === 'transform' ? '风格 · 人物 · 背景' : params.mode === 'text' ? '文生视频' : '图生视频' }}</p></div><div class="workbench-header-actions"><button v-if="workbenchKind === 'generate'" ref="drawerTrigger" class="text-button task-drawer-toggle" :aria-expanded="taskDrawer" aria-controls="workbench-task-summary" @click="toggleDrawer"><PhListBullets :size="18" />最近任务</button><button class="text-button" @click="run('native.openEngine')">打开原生界面<PhArrowSquareOut :size="17" /></button></div></header>
          <div class="tabs" role="tablist" aria-label="创作方式"><button role="tab" :aria-selected="workbenchKind === 'generate'" :class="{ active: workbenchKind === 'generate' }" @click="workbenchKind = 'generate'">生成视频</button><button role="tab" :aria-selected="workbenchKind === 'transform'" :class="{ active: workbenchKind === 'transform' }" @click="workbenchKind = 'transform'">改造视频</button></div>
          <VideoTransformStudio v-if="workbenchKind === 'transform'" :snapshot="state" :busy="uiBusy" @refresh="refresh" />
          <div v-else class="workbench-grid">
            <form class="panel params-panel" @submit.prevent="submit">
              <h2>素材与参数</h2>
              <div class="parameters-scroll">
              <label class="field" for="generation-mode"><span>生成方式</span><select id="generation-mode" v-model="params.mode" :disabled="uiBusy"><option value="image">图生视频 · 需要首帧图片</option><option value="text">文生视频 · 无需图片（试用）</option></select></label>
              <p v-if="params.mode === 'text'" class="parameter-note">只需描述画面、动作与声音。当前 H3 文生视频路径已接入，生成效果待本机验证。</p>
              <template v-if="params.mode !== 'text'">
              <input ref="uploadInput" data-testid="image-upload" class="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" :disabled="uiBusy" @change="upload" />
              <div v-if="inputPreview" class="input-material"><img :src="inputPreview" alt="当前上传的首帧图片" /><div class="material-caption"><span :title="inputName">{{ inputName }}</span><button class="btn secondary small" type="button" :disabled="uiBusy" @click="uploadInput?.click()"><PhImageSquare :size="17" />更换图片</button></div></div>
              <button v-else class="upload-zone" type="button" :disabled="uiBusy" @click="uploadInput?.click()"><PhUploadSimple :size="30" /><strong>上传首帧图片</strong><span>PNG、JPEG、WebP · 10 MB 以内</span></button>
              <p v-if="inputError" class="error-message" role="alert">{{ inputError }}</p>
              </template>
              <label class="field" for="prompt"><span>提示词</span><textarea id="prompt" v-model="params.prompt" placeholder="描述画面的动作、镜头与声音…" maxlength="10000" :disabled="uiBusy" rows="4" /><span class="field-help">{{ params.prompt.length }} / 10000</span></label>
              <div class="two-fields"><label class="field" for="resolution"><span>分辨率</span><select id="resolution" v-model="resolutionChoice" :disabled="uiBusy"><option v-for="resolution in H3_RESOLUTIONS" :key="resolution.label" :value="`${resolution.width}x${resolution.height}`">{{ resolution.width }} × {{ resolution.height }}</option><option value="custom">自定义宽高</option></select></label><label class="field" for="duration"><span>时长</span><select id="duration" v-model="durationChoice" :disabled="uiBusy"><option v-for="frames in H3_DURATIONS" :key="frames" :value="String(frames)">约 {{ (frames / 24).toFixed(2) }} 秒{{ frames === 124 ? ' · 默认' : '' }}</option><option value="custom">自定义秒数</option></select></label></div>
              <div v-if="resolutionChoice === 'custom'" class="two-fields"><label class="field" for="custom-width"><span>宽度（px）</span><input id="custom-width" v-model.number="params.width" type="number" min="256" max="2048" step="32" :disabled="uiBusy" /></label><label class="field" for="custom-height"><span>高度（px）</span><input id="custom-height" v-model.number="params.height" type="number" min="256" max="2048" step="32" :disabled="uiBusy" /></label></div>
              <label v-if="durationChoice === 'custom'" class="field" for="custom-seconds"><span>期望时长（秒）</span><input id="custom-seconds" v-model.number="requestedSeconds" type="number" min="0.20833333333333334" max="15.083333333333334" step="any" :disabled="uiBusy" @input="adjustDuration" /></label>
              <p class="parameter-note">实际 {{ params.width }}×{{ params.height }} · {{ params.frames }} 帧 · 24 fps · 约 {{ (params.frames / 24).toFixed(2) }} 秒。{{ verifiedConfiguration ? '默认配置已验证出片。' : '自定义配置待本机验证；尺寸或时长越大，显存与耗时通常越高。' }}</p>
              <p v-if="durationChoice === 'custom'" class="parameter-note">秒数向上对齐到 H3 支持的帧数，实际时长以这里显示为准。</p>
              <p v-if="dimensionError || durationError" class="error parameter-note" role="alert">{{ dimensionError || durationError }}</p>
              <p class="parameter-note">Turbo 模板 · 24 fps · 4 步</p>
              <div class="preset-row"><label class="field" for="preset"><span>参数预设</span><select id="preset" v-model="presetId" :disabled="uiBusy" @change="choosePreset"><option value="">自定义参数</option><option v-for="preset in state.presets" :key="preset.id" :value="preset.id">{{ preset.name }}</option></select></label><button class="btn secondary small save-preset" type="button" :disabled="uiBusy || !params.prompt.trim()" @click="openPreset"><PhFloppyDisk :size="17" />保存预设</button></div>
              <button class="advanced-toggle" type="button" :aria-expanded="advanced" @click="advanced = !advanced">高级参数<component :is="advanced ? PhCaretDown : PhCaretRight" :size="17" /></button>
              <div v-if="advanced" class="advanced-content"><label class="field" for="seed"><span>随机种子</span><div class="seed-field"><input id="seed" v-model.number="params.seed" type="number" min="0" :max="Number.MAX_SAFE_INTEGER" :disabled="uiBusy" /><button type="button" class="btn secondary compact" aria-label="随机生成种子" title="随机种子" @click="randomizeSeed"><PhShuffle :size="18" /></button></div></label><p class="muted small-note">同一组参数可重复提交；跨版本和硬件可能产生差异。</p></div>
              </div>
              <div class="generation-action"><button class="btn primary full-width generate-button" type="submit" :disabled="!canGenerate"><PhSpinnerGap v-if="busy" :size="20" class="spinning" /><PhPlay v-else :size="20" weight="fill" />{{ busy ? '正在提交…' : '生成视频' }}</button><div v-if="template?.ready" class="ready-hint"><PhCheckCircle :size="17" weight="fill" />资源已就绪<span v-if="params.mode !== 'text' && !params.image"> · 请上传素材</span><span v-else-if="!params.prompt.trim()"> · 请填写提示词</span></div><div v-else class="not-ready-hint"><PhInfo :size="17" /><span>{{ !engineReady ? '请先启动本地引擎' : '请检查模型与节点依赖' }}</span><button type="button" class="text-button" :disabled="uiBusy" @click="run(engineReady ? 'template.validate' : 'engine.start')">{{ engineReady ? '检查' : '启动' }}</button></div></div>
            </form>
            <div class="panel preview-panel"><h2>结果预览</h2><div v-if="selectedOutput" class="result-player"><video ref="previewVideo" :key="selectedOutput.url" :src="mediaUrl(selectedOutput)" controls preload="metadata" playsinline /><div class="result-details"><div><strong>{{ selectedTask?.title }}</strong><p class="muted">MP4 · {{ selectedTask?.params.width }} × {{ selectedTask?.params.height }} · {{ ((selectedTask?.params.frames || 124) / 24).toFixed(2) }} 秒</p></div><button class="btn secondary" :disabled="uiBusy" @click="run('native.export', { taskId: selectedTask?.id, index: 0 })"><PhExport :size="17" />导出 MP4</button></div></div><div v-else class="preview-empty"><PhFilmStrip :size="42" /><h3>{{ selectedTask?.status === 'running' ? '画面正在生成' : '你的第一段视频，从这里开始' }}</h3><p>{{ selectedTask && ['queued', 'submitting', 'running'].includes(selectedTask.status) ? '完成后会自动显示结果，生成期间可以查看任务进度。' : '上传图片，描述你想看到的变化，然后点击生成。' }}</p><span v-if="selectedTask?.status === 'running'" class="badge">{{ selectedTask.stage }}</span></div><p class="preview-footer">保留你的创作参数，每一次尝试都可以继续。</p></div>
            <Transition name="drawer" @before-leave="retireSurface" @before-enter="activateSurface" @leave-cancelled="activateSurface" :css="compactLayout && !drawerInstant && !layoutChanging"><aside v-if="!compactLayout || taskDrawer" id="workbench-task-summary" ref="drawerElement" :tabindex="compactLayout ? -1 : undefined" role="region" aria-labelledby="task-summary-title" :class="['panel task-summary', { 'drawer-open': taskDrawer }]"><div class="summary-heading"><h2 id="task-summary-title">最近任务</h2><button class="text-button drawer-close" aria-label="关闭任务详情" @click="closeDrawer"><PhX :size="18" /></button></div><p v-if="compactLayout" class="drawer-context">任务面板 · Escape 关闭，Tab 可继续访问创作界面。</p><template v-if="selectedTask"><div :class="['task-status', selectedTask.status]"><PhCheckCircle v-if="selectedTask.status === 'completed'" :size="20" weight="fill" /><PhSpinnerGap v-else-if="['running', 'queued', 'submitting'].includes(selectedTask.status)" :size="20" class="spinning" /><PhWarningCircle v-else :size="20" />{{ taskNames[selectedTask.status] }}</div><h3 class="task-title">{{ selectedTask.title }}</h3><p class="muted small-note">{{ formatDate(selectedTask.createdAt) }}</p><div class="summary-stage"><span class="muted">当前阶段</span><strong>{{ selectedTask.stage }}</strong></div><div v-if="selectedTask.progress && selectedTask.status === 'running'" class="node-progress"><div><span>节点进度</span><strong>{{ selectedPercent }}%</strong></div><progress :value="selectedTask.progress.value" :max="selectedTask.progress.max" /><p class="muted small-note">仅代表当前节点，不是整体进度</p></div><p v-if="selectedTask.error" class="error-message">{{ selectedTask.error }}</p><dl class="summary-metadata"><div><dt>模板</dt><dd>MiniMax H3</dd></div><div><dt>种子</dt><dd>{{ selectedTask.params.seed }}</dd></div></dl><button v-if="['queued', 'running'].includes(selectedTask.status)" class="btn secondary full-width" :disabled="uiBusy" @click="run('task.cancel', { id: selectedTask.id })">取消任务</button><button v-if="['failed', 'interrupted'].includes(selectedTask.status)" class="btn secondary full-width" :disabled="uiBusy" @click="run('task.retry', { id: selectedTask.id })">重新生成</button><button class="text-button" @click="navigate('tasks')">查看任务详情<PhCaretRight :size="16" /></button><p class="summary-note"><PhInfo :size="16" />参数与版本随作品保存</p></template><div v-else class="summary-empty"><PhListBullets :size="28" /><p>还没有任务</p><span class="muted">生成后，状态会在这里自动更新。</span></div></aside></Transition>
          </div>
        </section>
        <SecondaryPages v-else :key="page" :page="page" :snapshot="state" :busy="uiBusy" :media-url="mediaUrl" :ui-preferences="uiPreferences" @ui-preferences="updateUiPreferences" @action="run" @create="create" @restore="restore" />
      </main>
    </div>
    <Transition name="toast" @before-leave="retireSurface" @before-enter="activateSurface" @leave-cancelled="activateSurface" :css="!toastInstant"><div v-if="toast" :data-ui-instant="toastInstant" :class="['toast', { 'toast-error': toastError }]" :role="toastError ? 'alert' : 'status'"><PhWarningCircle v-if="toastError" :size="20" /><PhCheckCircle v-else :size="20" /><span>{{ toast }}</span><button class="text-button" aria-label="关闭提示" @click="toast = ''"><PhX :size="16" /></button></div></Transition>
    <Transition name="modal" @before-leave="retireSurface" @before-enter="activateSurface" @leave-cancelled="activateSurface" :css="!modalInstant"><div v-if="presetOpen" class="modal-backdrop" @click.self="presetOpen = false"><form ref="presetDialog" tabindex="-1" class="panel preset-dialog" role="dialog" aria-modal="true" aria-labelledby="preset-title" @submit.prevent="savePreset"><h2 id="preset-title">保存参数预设</h2><p class="muted">保存提示词、分辨率与种子，不保存素材图片。</p><label class="field" for="preset-name"><span>预设名称</span><input id="preset-name" v-model="presetName" maxlength="60" autofocus placeholder="例如：森林慢镜头" /></label><div class="dialog-actions"><button class="btn secondary" type="button" @click="presetOpen = false">取消</button><button class="btn primary" type="submit" :disabled="uiBusy || !presetName.trim()">保存预设</button></div></form></div></Transition>
    <component :is="stressControls" v-if="stressControls" :mode="stressMode" @change="updateStressMode" />
  </div>
</template>





<style scoped>
.title-brand { white-space: nowrap; }
@media(max-width:599px) { .title-subtitle,.build-label { display:none; }.title-actions { flex-shrink:0; } }
</style>
