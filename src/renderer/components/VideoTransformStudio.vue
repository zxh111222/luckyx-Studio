<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { PhPaintBrush, PhUserSwitch, PhMountains, PhArrowSquareOut, PhArrowClockwise, PhFolderPlus, PhInfo } from '@phosphor-icons/vue'
import type { Snapshot, UserWorkflow, VideoRecipeEntry } from '../../shared/contracts'
import { desktop, invoke } from '../src/api'
const props = defineProps<{ snapshot: Snapshot; busy: boolean }>()
const emit = defineEmits<{ refresh: [] }>()
const recipes = ref<VideoRecipeEntry[]>([])
const selectedId = ref('h3-video-style')
const loading = ref(false)
const acting = ref(false)
const error = ref('')
const message = ref('')
const selected = computed(() => recipes.value.find(r => r.id === selectedId.value))
const engineReady = computed(() => ['ready', 'busy'].includes(props.snapshot.engine.status))
const disabled = computed(() => props.busy || acting.value || loading.value)
const icons = { 'h3-video-style': PhPaintBrush, 'h3-video-character': PhUserSwitch, 'h3-video-background': PhMountains }
const statusText = (status: VideoRecipeEntry['status']) => status === 'available' ? '依赖已识别 · 待试用' : status === 'missing' ? '需要补充依赖' : '请先连接引擎'
async function check() {
  if (loading.value) return
  loading.value = true; error.value = ''
  try { recipes.value = await invoke<VideoRecipeEntry[]>('workflow.recipes') }
  catch (e) { error.value = e instanceof Error ? e.message : '暂时无法检查工作流，请重试。' }
  finally { loading.value = false }
}
onMounted(check)
watch(() => `${props.snapshot.settings.engineUrl}|${props.snapshot.settings.modelPath}|${engineReady.value}`, check)
async function add(open: boolean) {
  if (!selected.value || disabled.value) return
  acting.value = true; error.value = ''; message.value = ''
  try {
    const workflow = await invoke<UserWorkflow>('workflow.recipeImport', { id: selected.value.id })
    emit('refresh')
    if (open && desktop) {
      await invoke('native.editWorkflow', { id: workflow.id })
      message.value = '已打开节点编辑器。上传原视频和所需遮罩后，再检查参数并运行；编辑后可回工作流库保存。'
    } else message.value = desktop ? '已添加到“我的工作流”。重复添加会保留已有编辑。' : '已添加到“我的工作流”。浏览器预览请导出 JSON，再拖入原生 ComfyUI；桌面版可直接打开编辑器。'
  } catch (e) { error.value = e instanceof Error ? e.message : '工作流未能打开，请检查环境。' }
  finally { acting.value = false }
}
async function reference(url: string) {
  error.value = ''
  try { await invoke('native.openReference', { url }) }
  catch (e) { error.value = e instanceof Error ? e.message : '链接无法打开' }
}
</script>

<template>
  <section class="transform-studio" aria-label="视频改造">
    <div class="transform-heading"><div><h2>让已有视频，换一种表达</h2><p class="muted">选择改造方式，使用对应的节点工作流。</p></div><button class="btn secondary" :disabled="disabled" @click="check"><PhArrowClockwise :size="18" />{{ loading ? '正在检查…' : '检查依赖' }}</button></div>
    <p v-if="error" role="alert" class="error feedback">{{ error }}</p><p v-if="message" role="status" class="good feedback">{{ message }}</p>
    <div v-if="!recipes.length && loading" class="panel transform-empty">正在读取工作流与本地依赖…</div>
    <div v-else class="transform-grid" role="group" aria-label="视频改造方式"><button v-for="recipe in recipes" :key="recipe.id" class="panel recipe-option" :class="{ selected: recipe.id === selectedId }" :aria-pressed="recipe.id === selectedId" @click="selectedId = recipe.id"><component :is="icons[recipe.id as keyof typeof icons] || PhPaintBrush" :size="28" /><h3>{{ recipe.name }}</h3><p>{{ recipe.description }}</p><span class="recipe-status" :class="recipe.status === 'available' ? 'good' : 'warning'">{{ statusText(recipe.status) }}</span></button></div>
    <div v-if="selected" class="transform-detail"><section class="panel transform-guide"><div class="section-heading"><h3>{{ selected.name }} · 使用步骤</h3><span class="badge">节点编辑器 · 试用</span></div><h4>准备素材</h4><ul><li v-for="input in selected.inputs" :key="input">{{ input }}</li></ul><h4>怎么操作</h4><ol><li v-for="step in selected.steps" :key="step">{{ step }}</li></ol><div class="transform-actions"><button class="btn primary" :disabled="disabled || !engineReady" @click="add(true)"><PhArrowSquareOut :size="18" />{{ desktop ? '添加并打开节点编辑器' : '添加到工作流库' }}</button><button v-if="desktop || !engineReady" class="btn secondary" :disabled="disabled" @click="add(false)"><PhFolderPlus :size="18" />添加到工作流库</button></div><p class="muted small">这里只添加或打开工作流；不会自动开始生成。改造后的原生工作流可保存回“我的工作流”。</p><button class="text-action" @click="reference(selected.sourceUrl)">查看节点原理与官方指南 <PhArrowSquareOut :size="16" /></button></section>
    <aside class="panel transform-dependencies"><div class="section-heading"><h3>运行准备</h3><PhInfo :size="20" /></div><p class="recipe-status" :class="selected.status === 'available' ? 'good' : 'warning'">{{ statusText(selected.status) }}</p><p v-if="selected.status === 'available'" class="muted">依赖检查通过，生成效果与显存需求仍需在这台电脑上试用确认。</p><ul v-if="selected.issues.length" class="dependency-issues"><li v-for="issue in selected.issues" :key="issue">{{ issue }}</li></ul><details class="model-links" :open="selected.status !== 'available'"><summary>模型文件与下载入口</summary><div v-for="model in selected.models" :key="model.name" class="model-link"><strong>{{ model.folder === 'model_patches' ? '视频编辑控制权重' : '可复用的基础权重' }}</strong><span>{{ model.name }}</span><small>ComfyUI/models/{{ model.folder }}/</small><button class="text-action" @click="reference(model.url)">官方文件页 <PhArrowSquareOut :size="15" /></button></div></details><p class="muted small">这一版提供基于 H3 原生节点的适配工作流。换人物、换背景需要正确的逐帧遮罩；精确人物相似度和逐帧保留效果尚未实测。</p></aside></div>
  </section>
</template>

<style scoped>
.transform-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}.transform-heading h2{font-size:24px;margin:0 0 10px}.transform-heading p{font-size:14px;margin:0}.transform-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-bottom:24px}.recipe-option{padding:24px;text-align:left;cursor:pointer;color:var(--text);font:inherit;min-width:0;transition:border-color .15s}.recipe-option>svg{color:var(--accent);margin-bottom:20px}.recipe-option h3{font-size:18px;margin:0 0 12px}.recipe-option p{font-size:14px;line-height:1.7;min-height:72px;margin:0 0 20px;color:var(--muted)}.recipe-option.selected{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}.recipe-status{font-size:13px;line-height:1.7}.transform-detail{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(300px,1fr);gap:20px}.transform-guide,.transform-dependencies{padding:24px;min-width:0}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:20px}.section-heading h3{margin:0;font-size:18px}.transform-guide h4{font-size:14px;margin:24px 0 12px}.transform-guide ul,.transform-guide ol,.dependency-issues{font-size:14px;line-height:1.8;padding-left:22px}.transform-guide li{margin-bottom:10px}.transform-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}.transform-actions .btn,.transform-heading .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px}.small{font-size:12px;line-height:1.8}.feedback{font-size:14px;line-height:1.8;overflow-wrap:anywhere}.text-action{display:inline-flex;align-items:center;gap:6px;min-height:40px;background:none;border:0;padding:0;color:var(--accent);font:inherit;font-size:13px;cursor:pointer}.transform-dependencies>p{font-size:14px;line-height:1.8}.dependency-issues{color:var(--muted);overflow-wrap:anywhere}.model-links{border-top:1px solid var(--border);padding-top:18px;margin-top:24px}.model-links summary{cursor:pointer;font-size:14px;line-height:1.8}.model-link{padding:16px 0;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:8px}.model-link strong{font-size:14px}.model-link span{font-size:12px;line-height:1.8;overflow-wrap:anywhere;color:var(--muted)}.model-link small{font-size:12px;color:var(--muted);overflow-wrap:anywhere}.transform-empty{padding:30px;color:var(--muted)}@media(max-width:1180px){.transform-detail{grid-template-columns:1fr}.recipe-option{padding:20px}.recipe-option p{min-height:96px}}@media(max-width:850px){.transform-grid{grid-template-columns:1fr}.recipe-option p{min-height:0}.transform-heading{align-items:flex-start;flex-direction:column}.transform-actions{flex-direction:column}.transform-actions .btn{width:100%}}
</style>
