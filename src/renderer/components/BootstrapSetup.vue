<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { PhDownloadSimple, PhFolderOpen, PhArrowClockwise, PhStop, PhBookOpen, PhCheckCircle } from '@phosphor-icons/vue'
import type { Snapshot } from '../../shared/contracts'
import type { BootstrapPlan, BootstrapState } from '../../shared/bootstrap'
import { desktop, invoke } from '../src/api'
const props = defineProps<{ snapshot: Snapshot }>()
const emit = defineEmits<{ complete: []; create: [] }>()
const root = ref('')
const profile = ref('h3')
const plan = ref<BootstrapPlan | null>(null)
const state = ref<BootstrapState | null>(null)
const error = ref('')
const waiting = ref(false)
const consent = ref(false)
const manual = ref(false)
let timer: ReturnType<typeof setInterval> | undefined
let closed = false
let polling = false
const active = computed(() => state.value && ['downloading', 'verifying', 'extracting'].includes(state.value.status))
const size = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GiB`
const percent = computed(() => state.value?.totalBytes ? Math.min(100, Math.round(state.value.receivedBytes / state.value.totalBytes * 100)) : 0)
async function poll() {
  if (polling) return
  polling = true
  try { const next = await invoke<BootstrapState>('bootstrap.status'); if (!closed) { const done = next.status === 'completed' && state.value?.status !== 'completed'; state.value = next; if (done) emit('complete') } } catch {} finally { polling = false }
}
async function choose() {
  try { const p = await invoke<string | false>('native.bootstrapDirectory'); if (p) { root.value = p; plan.value = null; consent.value = false } } catch (e) { error.value = String(e instanceof Error ? e.message : e) }
}
async function prepare() {
  error.value = ''; waiting.value = true; consent.value = false; plan.value = null
  try { plan.value = await invoke<BootstrapPlan>('bootstrap.plan', { rootPath: root.value, profile: profile.value }); await poll() } catch (e) { error.value = String(e instanceof Error ? e.message : e); manual.value = true } finally { waiting.value = false }
}
async function install() {
  error.value = ''; waiting.value = true
  try { await invoke('bootstrap.start'); await poll() } catch (e) { error.value = String(e instanceof Error ? e.message : e); manual.value = true } finally { waiting.value = false }
}
async function cancel() { await invoke('bootstrap.cancel'); await poll() }
async function link(url: string) { try { await invoke('native.openReference', { url }) } catch (e) { error.value = String(e) } }
onMounted(() => { void poll(); timer = setInterval(() => void poll(), 1000) })
onUnmounted(() => { closed = true; if (timer) clearInterval(timer) })
</script>
<template>
  <section class="panel bootstrap-panel" aria-label="一键安装环境">
    <div class="bootstrap-heading"><div><p class="eyebrow">第一次使用</p><h2>没有环境，也能从这里开始</h2><p class="muted">自动准备 ComfyUI 和 Python；设备适合时可同时安装 H3 模型。</p></div><PhDownloadSimple :size="36" class="accent" /></div>
    <label class="install-label" for="bootstrap-profile">要安装什么？</label><select id="bootstrap-profile" v-model="profile" class="input install-profile" :disabled="Boolean(active) || waiting" @change="plan = null; consent = false"><option value="h3">ComfyUI + MiniMax H3 模型（16 GB 显存起，条件试用）</option><option value="environment">只安装 ComfyUI，稍后再选模型</option></select><label class="install-label" for="bootstrap-root">安装到哪个磁盘？</label><div class="install-path"><input id="bootstrap-root" v-model="root" class="input" placeholder="例如 D:\AI，请选择空间充足的磁盘" :disabled="Boolean(active) || waiting" @input="plan = null; consent = false" /><button v-if="desktop" class="btn secondary" :disabled="Boolean(active) || waiting" @click="choose"><PhFolderOpen :size="18" />选择目录</button></div>
    <p class="muted small">在所选目录中创建独立的 luckyx-environment，不覆盖已有环境。只支持适配的 Windows NVIDIA 设备；安装前会检查。</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <button v-if="!active" class="btn secondary" :disabled="waiting || !root.trim()" @click="prepare"><PhArrowClockwise :size="18" />{{ waiting ? '正在读取官方清单…' : '检查配置与下载量' }}</button>
    <div v-if="plan" class="install-summary"><div class="install-metrics"><div><span>下载总量</span><strong>{{ size(plan.downloadBytes) }}</strong></div><div><span>建议可用空间</span><strong>{{ size(plan.requiredFreeBytes) }}</strong></div><div><span>运行环境</span><strong>ComfyUI {{ plan.version }}</strong></div></div><p class="muted small">{{ plan.targetPath }} · 当前磁盘可用 {{ size(plan.freeBytes) }}</p><p v-if="plan.freeBytes < plan.requiredFreeBytes" class="warning">空间不足，请换一个磁盘后重新检查。</p><ul v-if="plan.hardwareIssues.length" class="warning"><li v-for="issue in plan.hardwareIssues" :key="issue">{{ issue }}</li></ul><details><summary>查看官方文件清单</summary><ul><li v-for="file in plan.files" :key="file.id">{{ file.name }} · {{ size(file.sizeBytes) }}</li></ul></details><label v-if="!active && state?.status !== 'completed'" class="consent"><input v-model="consent" type="checkbox" />我已了解下载量，将从官方来源下载并校验文件。</label><button v-if="!active && state?.status !== 'completed'" class="btn primary" :disabled="waiting || !consent || plan.hardwareIssues.length > 0 || plan.freeBytes < plan.requiredFreeBytes || !desktop" @click="install"><PhDownloadSimple :size="18" />{{ state?.status === 'error' || state?.status === 'cancelled' ? '继续下载并安装' : '一键安装并配置' }}</button><p v-if="!desktop" class="muted small">实际安装请使用桌面版；浏览器预览仅检查清单。</p></div>
    <div v-if="state && state.status !== 'idle'" class="install-progress" role="status"><div class="progress-caption"><strong>{{ state.message }}</strong><span v-if="state.totalBytes">{{ percent }}%</span></div><progress v-if="active" :value="state.receivedBytes" :max="state.totalBytes || 1" /><p class="muted small">{{ state.currentFile }} <span v-if="state.totalBytes">· {{ size(state.receivedBytes) }} / {{ size(state.totalBytes) }}</span></p><p v-if="state.error" class="error">{{ state.error }}</p><button v-if="active" class="btn secondary" @click="cancel"><PhStop :size="16" />暂停安装</button><p v-if="state.status === 'completed'" class="good"><PhCheckCircle :size="18" />文件已安装，启动后检查节点与模型，再开始创作。</p></div>
    <button v-if="state?.status === 'completed' && snapshot.templates.some(t => t.ready)" class="btn primary" @click="emit('create')">开始创作</button><div class="manual-fallback"><button class="text-button" @click="manual = !manual"><PhBookOpen :size="18" />{{ manual ? '收起手动教程' : '安装失败？查看手动教程' }}</button><div v-if="manual || state?.status === 'error' || state?.error" class="manual-steps"><ol><li>下载官方 Windows Portable NVIDIA 包，解压到独立目录，无需另装 Python。</li><li>如需使用 H3，再按官方教程下载模型，放入对应的 models 子目录。</li><li>运行原生 ComfyUI，确认能打开本地界面，再使用下方“连接已有环境”。</li><li>网络失败可继续下载；驱动或节点不兼容请按错误提示处理，避免反复安装模型。</li></ol><div class="fallback-links"><button class="text-button" @click="link('https://docs.comfy.org/installation/comfyui_portable_windows')">ComfyUI 安装教程 ↗</button><button class="text-button" @click="link('https://docs.comfy.org/tutorials/video/minimax/minimax-h3-native')">H3 模型教程 ↗</button></div></div></div>
  </section>
</template>
<style scoped>
.bootstrap-panel{padding:28px;margin:24px 0}.bootstrap-heading{display:flex;justify-content:space-between;gap:24px;margin-bottom:24px}.bootstrap-heading h2{font-size:24px;margin:8px 0 12px}.bootstrap-heading p{font-size:14px;line-height:1.7}.install-profile{width:100%;margin-bottom:20px}.install-label{display:block;font-size:14px;margin-bottom:10px}.install-path{display:flex;gap:12px}.install-path .input{flex:1;min-width:0}.small{font-size:12px;line-height:1.8;overflow-wrap:anywhere}.bootstrap-panel>.small{margin:12px 0 20px}.btn,.text-button{display:inline-flex;align-items:center;justify-content:center;gap:8px}.install-summary{border-top:1px solid var(--border);padding-top:24px;margin-top:24px}.install-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}.install-metrics span{color:var(--muted);font-size:12px;display:block;margin-bottom:8px}.install-metrics strong{font-size:20px}.install-summary details{margin:20px 0;font-size:14px}.install-summary ul{line-height:1.8;font-size:13px;padding-left:20px;overflow-wrap:anywhere}.consent{display:flex;gap:10px;font-size:14px;line-height:1.8;margin:20px 0}.consent input{width:18px;height:18px;accent-color:var(--accent)}.install-progress{padding:24px 0;border-top:1px solid var(--border);margin-top:24px}.progress-caption{display:flex;justify-content:space-between;gap:20px;font-size:14px}progress{width:100%;height:10px;accent-color:var(--accent);margin:16px 0}.good{display:flex;align-items:center;gap:8px;line-height:1.8}.manual-fallback{border-top:1px solid var(--border);padding-top:20px;margin-top:24px}.manual-steps{font-size:14px;line-height:1.8}.fallback-links{display:flex;gap:24px;flex-wrap:wrap}.error{font-size:14px;line-height:1.8;overflow-wrap:anywhere}@media(max-width:900px){.install-metrics{grid-template-columns:1fr}.install-path{flex-direction:column}.bootstrap-panel{padding:20px}}
</style>






