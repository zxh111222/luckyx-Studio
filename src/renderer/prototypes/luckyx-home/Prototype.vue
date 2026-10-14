<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { PhX, PhArrowRight, PhFolderOpen, PhCheckCircle, PhUploadSimple, PhFilmStrip } from '@phosphor-icons/vue'
import QuietHome from './QuietHome.vue'
import GalleryHome from './GalleryHome.vue'
import ConsoleHome from './ConsoleHome.vue'
import { createFocusTrap } from '../../src/ui-preferences'
import { parseWorkflowJson, MAX_WORKFLOW_BYTES } from '../../../shared/workflow-library'
import { directions, selectedVariant, readPrototypeData, STORAGE_KEY } from './model'
const components = [QuietHome, GalleryHome, ConsoleHome]
const pickerNames = ['静谧', '银灰', '专业']
const current = ref(selectedVariant(location.search))
const mountKey = ref(0)
const picker = ref<HTMLElement | null>(null)
const highlight = ref<HTMLElement | null>(null)
const stage = ref<HTMLElement | null>(null)
const sheet = ref('')
const panel = ref<HTMLElement | null>(null)
const reduceMotion = ref(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
const systemMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const systemChange = () => reduceMotion.value = systemMotion.matches
const data = ref(readPrototypeData(null))
try { data.value = readPrototypeData(localStorage.getItem(STORAGE_KEY)) } catch { /* Preview also works with storage blocked. */ }
const toast = ref('')
let toastTimer: number
let opener: HTMLElement | null = null
let releaseFocus: ((restore?: boolean) => void) | undefined
const prompt = ref('清晨的松林，晨雾慢慢散开，镜头缓缓向前。')
const mode = ref('image')
const resolution = ref('864 × 480')
const duration = ref('约 5 秒')
const image = ref('/forest-preview.webp')
let imageBlob = ''
const formError = ref('')
const importMessage = ref('')
const query = ref('')
const activeProject = ref('forest')
const projects = [
  { id: 'forest', title: '雾林晨光', image: '/forest-preview.webp', prompt: '清晨的松林，晨雾慢慢散开，镜头缓缓向前。', meta: '自然 · 864 × 480' },
  { id: 'coast', title: '沿海公路', image: '/coast-inspiration.webp', prompt: '傍晚的沿海公路，镜头沿海岸缓缓移动。', meta: '风景 · 镜头探索' },
  { id: 'studio', title: '光影之间', image: '/camera-studio.webp', prompt: '柔和光线下的静物，镜头缓慢环绕，突出光影变化。', meta: '静物 · 风格练习' }
]
const project = computed(() => projects.find(p => p.id === activeProject.value) || projects[0])
const filteredImports = computed(() => data.value.imports.filter(p => p.name.toLowerCase().includes(query.value.toLowerCase())))
function notify(message: string) { toast.value = message; clearTimeout(toastTimer); toastTimer = window.setTimeout(() => toast.value = '', 4000) }
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data.value)); return true } catch { notify('浏览器存储不可用，草稿仅在本次预览保留'); return false }
}
function moveHighlight() {
  const buttons = picker.value?.querySelectorAll<HTMLButtonElement>('.proto-picker-item')
  const el = buttons?.[current.value]
  if (el && highlight.value) { highlight.value.style.width = `${el.offsetWidth}px`; highlight.value.style.transform = `translateX(${el.offsetLeft}px)` }
}
function setActive(i: number) {
  if (i < 0 || i >= components.length) return
  sheet.value = ''; current.value = i; mountKey.value++
  const url = new URL(location.href); url.searchParams.set('v', String(i + 1)); history.replaceState(null, '', url)
  void nextTick(() => { moveHighlight(); window.scrollTo({ top: 0, behavior: 'auto' }) })
}
function keyboard(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  if (sheet.value || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable || event.metaKey || event.ctrlKey || event.altKey) return
  const num = Number(event.key)
  if (num >= 1 && num <= components.length) { event.preventDefault(); setActive(num - 1) }
  else if (event.key === 'ArrowRight') { event.preventDefault(); setActive((current.value + 1) % components.length) }
  else if (event.key === 'ArrowLeft') { event.preventDefault(); setActive((current.value - 1 + components.length) % components.length) }
  else if (/^r$/i.test(event.key)) { mountKey.value++ }
}
function action(name: string, payload?: string) {
  opener = document.activeElement as HTMLElement
  formError.value = ''; importMessage.value = ''; query.value = ''
  if (name === 'home') { sheet.value = ''; window.scrollTo({ top: 0, behavior: 'auto' }); return }
  if (name === 'create') {
    if (payload) { try { const values = JSON.parse(payload); prompt.value = String(values.prompt || prompt.value); mode.value = ['text', '文生视频'].includes(values.mode) ? 'text' : 'image'; resolution.value = values.resolution || resolution.value; duration.value = String(values.duration || duration.value) } catch { /* Project suggestions use the default form. */ } }
    sheet.value = 'create'
  } else if (name === 'project') { activeProject.value = payload || 'forest'; sheet.value = 'project' }
  else if (['import', 'workflows', 'history', 'environment', 'settings'].includes(name)) sheet.value = name
}
function saveDraft() {
  if (!prompt.value.trim()) { formError.value = '先写一句画面描述，再保存草稿。'; return }
  data.value.drafts.unshift({ id: crypto.randomUUID(), title: prompt.value.trim().slice(0, 30), prompt: prompt.value.trim(), mode: mode.value, resolution: resolution.value, duration: duration.value, createdAt: new Date().toISOString() })
  data.value.drafts = data.value.drafts.slice(0, 30)
  const saved = persist(); sheet.value = ''; if (saved) notify('草稿已保存到此预览，可在“任务与作品”查看')
}
async function importWorkflow(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]; if (!file) return
  try {
    if (file.size > MAX_WORKFLOW_BYTES) throw new Error('工作流文件最大 5 MiB')
    const parsed = parseWorkflowJson(await file.text())
    data.value.imports.unshift({ name: file.name.replace(/\.json$/i, ''), nodes: parsed.nodeCount, format: parsed.format })
    data.value.imports = data.value.imports.slice(0, 30)
    persist(); importMessage.value = `已导入 ${file.name} · ${parsed.nodeCount} 个节点，保存在原型预览中`
  } catch (error) { formError.value = error instanceof Error ? error.message : '未能读取工作流' }
  input.value = ''
}
function chooseImage(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { formError.value = '请选择 10 MB 以内的 PNG、JPEG 或 WebP'; return }
  if (imageBlob) URL.revokeObjectURL(imageBlob)
  imageBlob = URL.createObjectURL(file); image.value = imageBlob; formError.value = ''
}
watch(sheet, async value => {
  await nextTick(); releaseFocus?.(false); releaseFocus = undefined
  if (value && panel.value) releaseFocus = createFocusTrap(panel.value, opener, () => sheet.value = '')
  else if (opener?.isConnected) opener.focus({ preventScroll: true })
})
onMounted(() => { setActive(current.value); requestAnimationFrame(() => requestAnimationFrame(() => picker.value?.setAttribute('data-ready', ''))); window.addEventListener('resize', moveHighlight); document.addEventListener('keydown', keyboard); systemMotion.addEventListener('change', systemChange) })
onUnmounted(() => { releaseFocus?.(false); clearTimeout(toastTimer); window.removeEventListener('resize', moveHighlight); document.removeEventListener('keydown', keyboard); systemMotion.removeEventListener('change', systemChange); if (imageBlob) URL.revokeObjectURL(imageBlob) })
</script>
<template>
  <div class="prototype-root" :data-reduce-motion="reduceMotion">
    <div id="stage" ref="stage" :inert="Boolean(sheet)"><component :is="components[current]" :key="`${current}-${mountKey}`" :draft-count="data.drafts.length" :reduce-motion="reduceMotion" @action="action" /></div>
    <nav ref="picker" class="proto-picker" aria-label="Prototype variants" :inert="Boolean(sheet)">
      <span ref="highlight" class="proto-picker-highlight" aria-hidden="true"></span>
      <button v-for="(name, i) in directions" :key="name" class="proto-picker-item" :aria-label="name" :data-active="i === current ? '' : undefined" :aria-current="i === current ? 'true' : undefined" @click="setActive(i)">{{ pickerNames[i] }}</button>
    </nav>
    <div v-if="sheet" class="preview-scrim" @click.self="sheet = ''">
      <section ref="panel" tabindex="-1" class="preview-sheet" role="dialog" aria-modal="true" aria-labelledby="preview-sheet-title">
        <header><div><span class="sheet-kicker">luckyx. Studio · 交互预览</span><h2 id="preview-sheet-title">{{ { create:'开始一段新创作', import:'导入你的工作流', workflows:'工作流库', history:'任务与作品', environment:'设备与环境', settings:'界面设置', project:project.title }[sheet] }}</h2></div><button class="sheet-close" aria-label="关闭预览面板" @click="sheet = ''"><PhX :size="21" /></button></header>
        <template v-if="sheet === 'create'">
          <p class="sheet-note">在此体验参数设置与草稿保存。素材仅用于本地预览，暂不连接引擎。</p>
          <form @submit.prevent="saveDraft">
            <label class="preview-field">生成方式<select v-model="mode"><option value="image">图生视频</option><option value="text">文生视频</option></select></label>
            <div v-if="mode === 'image'" class="preview-upload"><img :src="image" alt="首帧预览" /><label class="sheet-button"><PhUploadSimple :size="18" />选择首帧<input type="file" accept="image/png,image/jpeg,image/webp" @change="chooseImage" /></label></div>
            <label class="preview-field">画面描述<textarea v-model="prompt" maxlength="10000" rows="3" placeholder="描述动作、镜头和声音…"></textarea></label>
            <div class="preview-two"><label class="preview-field">分辨率<select v-model="resolution"><option>864 × 480</option><option>480 × 864</option><option>768 × 768</option></select></label><label class="preview-field">时长<select v-model="duration"><option>约 5 秒</option><option>约 10 秒</option><option>约 15 秒</option></select></label></div>
            <p v-if="formError" class="preview-error" role="alert">{{ formError }}</p><footer><span class="sheet-note">仅保存原型草稿，未提交生成</span><button class="sheet-button primary" type="submit">保存草稿<PhArrowRight :size="18" /></button></footer>
          </form>
        </template>
        <template v-else-if="sheet === 'import' || sheet === 'workflows'">
          <p class="sheet-note">兼容 ComfyUI 节点与 API JSON。这里仅验证文件并保存预览目录，不修改正式工作流。</p>
          <label class="sheet-button import-file"><PhFolderOpen :size="20" />选择 JSON 文件<input type="file" accept=".json,application/json" @change="importWorkflow" /></label>
          <p v-if="importMessage" class="preview-success" role="status">{{ importMessage }}</p><p v-if="formError" class="preview-error" role="alert">{{ formError }}</p>
          <label class="preview-field">搜索预览工作流<input v-model="query" placeholder="输入工作流名称" /></label>
          <div v-if="!data.imports.length" class="sheet-empty">还没有导入工作流，选择一个 JSON 开始。</div>
          <article v-for="item in filteredImports" :key="item.name" class="sheet-record"><strong>{{ item.name }}</strong><span>{{ item.nodes }} 个节点 · {{ item.format === 'api' ? 'API' : '节点' }} 工作流</span></article>
          <p v-if="data.imports.length && !filteredImports.length" class="sheet-empty">没有匹配的工作流。</p>
          <button class="sheet-button" @click="sheet = 'create'">新建创作草稿<PhArrowRight :size="18" /></button>
        </template>
        <template v-else-if="sheet === 'history'">
          <p class="sheet-note">原型草稿 {{ data.drafts.length }} 份 · 没有真实生成任务。</p>
          <article v-for="draft in data.drafts" :key="draft.id" class="sheet-record"><strong>{{ draft.title }}</strong><span>{{ draft.resolution }} · {{ draft.duration }} · {{ draft.mode === 'text' ? '文生视频' : '图生视频' }}</span><button class="sheet-button" @click="prompt = draft.prompt; mode = draft.mode; resolution = draft.resolution; duration = draft.duration; sheet = 'create'">继续编辑</button></article>
          <div v-if="!data.drafts.length" class="sheet-empty"><PhFilmStrip :size="36" /><p>保存第一份创作草稿，再回来继续。</p><button class="sheet-button primary" @click="sheet = 'create'">开始创作</button></div>
        </template>
        <template v-else-if="sheet === 'environment'">
          <p class="sheet-note">演示配置，未读取或启动这台电脑的引擎。</p><dl class="sheet-details"><div><dt>设备</dt><dd>NVIDIA RTX 4080 · 16 GB 显存</dd></div><div><dt>环境</dt><dd>ComfyUI + MiniMax H3</dd></div><div><dt>当前连接</dt><dd>设计预览 · 未连接真实引擎</dd></div><div><dt>数据与素材</dt><dd>仅保存本地原型草稿，素材不上传</dd></div></dl><button class="sheet-button" @click="sheet = 'workflows'">查看预览工作流<PhArrowRight :size="18" /></button>
        </template>
        <template v-else-if="sheet === 'settings'">
          <p class="sheet-note">默认跟随系统。三种主页可用底部选择器或数字键 1–3 比较。</p><label class="preview-toggle"><span><strong>减少动态效果</strong><small>移除按压缩放与弹窗位移</small></span><input v-model="reduceMotion" type="checkbox" /></label><p class="sheet-note">这些设置只作用于原型，正式应用界面未被替换。</p>
        </template>
        <template v-else-if="sheet === 'project'">
          <img class="sheet-project-image" :src="project.image" :alt="project.title" /><span class="sheet-kicker">静态风格示例 · 非生成作品</span><p class="project-description">{{ project.prompt }}</p><button class="sheet-button primary" @click="prompt = project.prompt; image = project.image; mode = 'image'; sheet = 'create'">使用这份灵感<PhArrowRight :size="18" /></button>
        </template>
      </section>
    </div>
    <div v-if="toast" class="preview-toast" role="status"><PhCheckCircle :size="20" />{{ toast }}</div>
  </div>
</template>
