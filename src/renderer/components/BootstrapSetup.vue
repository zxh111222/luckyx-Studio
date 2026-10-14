<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { PhDownloadSimple, PhFolderOpen, PhArrowClockwise, PhStop, PhBookOpen, PhCheckCircle } from '@phosphor-icons/vue'
import type { Snapshot } from '../../shared/contracts'
import type { BootstrapPlan, BootstrapState } from '../../shared/bootstrap'
import { recommendH3Installation } from '../../shared/h3-installation'
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
const newInstallation = ref(false)
let timer: ReturnType<typeof setInterval> | undefined
let closed = false
let polling = false
let restored = false
const active = computed(() => state.value && ['downloading', 'verifying', 'extracting'].includes(state.value.status))
const screening = computed(() => recommendH3Installation(props.snapshot.hardware, profile.value as 'h3' | 'environment'))
const recommendation = computed(() => plan.value?.recommendation ?? screening.value.recommendation)
const engineReady = computed(() => ['ready', 'busy'].includes(props.snapshot.engine.status))
const installedModels = computed(() => props.snapshot.resources.filter(file => file.kind === 'model' && file.status === 'installed').length)
const modelTotal = computed(() => props.snapshot.templates[0]?.models.length ?? 0)
const knownInstallation = computed(() => props.snapshot.settings.initialized || Boolean(state.value?.installationPath))
const knownPath = computed(() => props.snapshot.settings.initialized ? props.snapshot.settings.installationPath : state.value?.installationPath ?? '')
const showInstaller = computed(() => newInstallation.value || Boolean(state.value?.resumable) || !knownInstallation.value)
const size = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GiB`
const percent = computed(() => state.value?.totalBytes ? Math.min(100, Math.round(state.value.receivedBytes / state.value.totalBytes * 100)) : 0)
async function poll() {
  if (polling) return
  polling = true
  try { const next = await invoke<BootstrapState>('bootstrap.status'); if (!closed) { const done = next.status === 'completed' && state.value?.status !== 'completed'; state.value = next; if (!restored) { restored = true; if (next.plan && !root.value.trim() && !plan.value) { root.value = next.plan.rootPath; profile.value = next.plan.profile; plan.value = next.plan } } if (done) { newInstallation.value = false; emit('complete') } } } catch {} finally { polling = false }
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
async function connectInstalled() {
  error.value = ''; waiting.value = true
  try { await invoke('bootstrap.connect'); emit('complete'); await poll() }
  catch (e) { error.value = e instanceof Error ? e.message : '连接未完成，请检查已有环境。' }
  finally { waiting.value = false }
}
async function link(url: string) { try { await invoke('native.openReference', { url }) } catch (e) { error.value = String(e) } }
onMounted(() => { void poll(); timer = setInterval(() => void poll(), 1000) })
onUnmounted(() => { closed = true; if (timer) clearInterval(timer) })
</script>
<template>
  <section class="panel bootstrap-panel" aria-label="一键安装环境">
    <div class="bootstrap-heading"><div><p class="eyebrow">{{ knownInstallation ? '本地环境' : state?.resumable ? '继续安装' : '环境准备' }}</p><h2>{{ knownInstallation ? '环境已识别，接着创作。' : state?.resumable ? '上次的进度，还在这里。' : '为这台电脑，准备创作环境。' }}</h2><p class="muted">{{ knownInstallation ? '显示实际目录与文件状态，模型和节点在启动后进一步检查。' : '检测配置，选择适合的 H3 文件；下载、校验、解压和路径配置一次完成。' }}</p></div><PhDownloadSimple :size="36" class="accent" /></div>
    <div v-if="knownInstallation" class="existing-installation"><div class="existing-title"><PhCheckCircle :size="23" class="accent" /><strong>运行环境已解压</strong><span class="badge">{{ engineReady && snapshot.templates.some(t => t.ready) ? '可以创作' : engineReady ? '待检查依赖' : '引擎未启动' }}</span></div><dl><div><dt>运行环境</dt><dd>{{ knownPath }}</dd></div><div><dt>模型目录</dt><dd>{{ snapshot.settings.initialized ? snapshot.settings.modelPath : knownPath + '/ComfyUI/models' }}</dd></div><div><dt>模型文件</dt><dd>{{ snapshot.settings.initialized ? `${installedModels} / ${modelTotal} 已发现` : '文件已放置，连接后读取资源' }}{{ snapshot.settings.initialized && installedModels < modelTotal ? ' · 有文件缺失' : ' · 启动后检查节点' }}</dd></div></dl><p v-if="state?.installationPath && state.error" class="warning">{{ state.phase }} · {{ state.error }}</p><button v-if="state?.status === 'completed' && state.installationPath && snapshot.settings.installationPath !== state.installationPath" class="btn primary" :disabled="waiting || Boolean(active)" @click="connectInstalled">连接已安装环境</button><button class="text-button" @click="newInstallation = !newInstallation">{{ newInstallation ? '收起新环境安装' : '安装另一个独立环境' }}</button><p class="muted small">已有环境可直接使用下方的连接与检查入口。下载缓存不会被当成已解压的运行环境。</p></div>
    <p v-if="error" class="error" role="alert">{{ error }}</p><div v-if="showInstaller">
    <div class="hardware-summary"><span>{{ snapshot.hardware.gpuName || '显卡待检测' }}</span><span>{{ snapshot.hardware.vramMb > 0 ? (snapshot.hardware.vramMb / 1024).toFixed(1) + ' GB 显存' : '显存待检测' }} · {{ snapshot.hardware.ramGb || '待检测' }} GB 内存</span></div>
    <label class="install-label" for="bootstrap-profile">安装方案</label>
    <select id="bootstrap-profile" v-model="profile" class="input install-profile" :disabled="Boolean(active) || waiting" @change="plan = null; consent = false"><option value="h3">ComfyUI + H3 · 按本机配置自动选择（8 GB 显存起）</option><option value="environment">只安装 ComfyUI，稍后再选模型</option></select>
    <div class="recommendation-card"><div class="recommendation-heading"><strong>{{ recommendation.label }}</strong><span class="badge">{{ recommendation.source === 'community' ? '社区低配方案' : '官方文件' }}</span></div><p>{{ recommendation.reason }}</p><div v-if="recommendation.tier !== 'environment'" class="trial-settings"><span>首次试跑</span><strong>{{ recommendation.defaults.width }} × {{ recommendation.defaults.height }} · {{ (recommendation.defaults.frames / recommendation.defaults.fps).toFixed(2) }} 秒 · {{ recommendation.defaults.steps }} 步</strong><span>{{ recommendation.defaults.audio ? '视频 + 音频' : '仅视频' }}</span></div><ul v-if="recommendation.warnings.length" class="recommendation-notes"><li v-for="note in recommendation.warnings" :key="note">{{ note }}</li></ul><ul v-if="screening.hardwareIssues.length && !plan" class="warning"><li v-for="issue in screening.hardwareIssues" :key="issue">{{ issue }}</li></ul>
      <details class="tiers"><summary>其他配置如何选择？</summary><dl><div><dt>8～15 GB 显存</dt><dd>Lite · W4A8 + 4B 编码器，约 16 GB 内存起，建议 32 GB。</dd></div><div><dt>约 16 GB 显存起</dt><dd>均衡 · 官方 W6A8，约 32 GB 内存起；保留原生音频。</dd></div><div><dt>约 24 GB 显存起</dt><dd>标准 · 官方 INT8，约 48 GB 内存起；内存较少会选更轻方案。</dd></div></dl><p class="small muted">以上为 Windows NVIDIA RTX 设备的安装建议；其他显卡或低于 8 GB 显存时提供教程。安装清单以实际检测为准。</p></details>
    </div>
    <label class="install-label" for="bootstrap-root">安装位置</label><div class="install-path"><input id="bootstrap-root" v-model="root" class="input" placeholder="例如 D:\AI，选择空间充足的磁盘" :disabled="Boolean(active) || waiting" @input="plan = null; consent = false" /><button v-if="desktop" class="btn secondary" :disabled="Boolean(active) || waiting" @click="choose"><PhFolderOpen :size="18" />选择目录</button></div>
    <p class="muted small">创建独立的 luckyx-environment。环境自动解压，模型放入对应 models 子目录，社区节点放入 custom_nodes；已有环境和模型保留。</p>
    
    <button v-if="!active" class="btn secondary" :disabled="waiting || !root.trim()" @click="prepare"><PhArrowClockwise :size="18" />{{ waiting ? '正在核对安装清单…' : '检查配置与下载量' }}</button>
    <div v-if="plan" class="install-summary">
      <div class="install-metrics"><div><span>下载总量</span><strong>{{ size(plan.downloadBytes) }}</strong></div><div><span>建议可用空间</span><strong>{{ size(plan.requiredFreeBytes) }}</strong></div><div><span>运行环境</span><strong>ComfyUI {{ plan.version }}</strong></div></div>
      <p class="muted small">{{ plan.targetPath }} · 当前磁盘可用 {{ size(plan.freeBytes) }}</p>
      <p v-if="plan.freeBytes < plan.requiredFreeBytes" class="warning">空间不足，请换一个磁盘后重新检查。</p><ul v-if="plan.hardwareIssues.length" class="warning"><li v-for="issue in plan.hardwareIssues" :key="issue">{{ issue }}</li></ul>
      <details class="file-details"><summary>模型文件、来源与放置目录（{{ plan.files.length }} 项）</summary><ul class="file-list"><li v-for="file in plan.files" :key="file.id"><strong>{{ file.name }}</strong><span>{{ size(file.sizeBytes) }} · {{ file.kind === 'node' ? '社区节点 · 自动解压' : file.kind === 'environment' ? '运行环境 · 自动解压' : '模型权重 · 直接放置' }}</span><code>{{ file.relativePath }}</code><span class="source-url">{{ file.url }}</span></li></ul></details>
      <label v-if="!active && state?.status !== 'completed'" class="consent"><input v-model="consent" type="checkbox" /><span>已了解下载量{{ recommendation.source === 'community' ? '，同意安装清单中的社区模型与节点代码' : '，同意下载清单中的官方文件' }}。文件将按固定版本校验。</span></label>
      <button v-if="!active && state?.status !== 'completed'" class="btn primary" :disabled="waiting || !consent || plan.hardwareIssues.length > 0 || plan.freeBytes < plan.requiredFreeBytes || !desktop" @click="install"><PhDownloadSimple :size="18" />{{ state?.status === 'error' || state?.status === 'cancelled' ? '继续下载并安装' : '一键安装并配置' }}</button>
      <p v-if="!desktop" class="muted small">实际安装请使用桌面版；浏览器预览仅检查清单。</p>
    </div>
    <div v-if="state && state.status !== 'idle'" class="install-progress" role="status"><div class="progress-caption"><strong>{{ state.phase || '安装进度' }}</strong><span v-if="state.totalBytes">{{ percent }}%</span></div><p class="progress-message">{{ state.message }}</p><progress v-if="active" :value="state.receivedBytes" :max="state.totalBytes || 1" /><p class="muted small">{{ state.currentFile }} <span v-if="state.totalBytes">· {{ size(state.receivedBytes) }} / {{ size(state.totalBytes) }}</span></p><p v-if="state.error" class="error">{{ state.error }}</p><button v-if="active" class="btn secondary" @click="cancel"><PhStop :size="16" />暂停安装</button><p v-if="state.status === 'completed'" class="good"><PhCheckCircle :size="18" />文件已放置并配置，检查模型与节点后开始创作。</p></div>
    <button v-if="state?.status === 'completed' && snapshot.templates.some(t => t.ready)" class="btn primary" @click="emit('create')">开始创作</button>
    </div>
    <div class="manual-fallback"><button class="text-button" @click="manual = !manual"><PhBookOpen :size="18" />{{ manual ? '收起手动教程' : '需要帮助？查看手动教程' }}</button><div v-if="manual || state?.status === 'error' || state?.error" class="manual-steps"><ol><li>下载官方 Windows Portable NVIDIA 包，解压到独立目录，无需另装 Python。</li><li>按推荐方案下载模型，放入清单对应的 models 子目录。Lite 方案还需 ClipProj 与 Spectrum 节点。</li><li>低配方案使用 --lowvram --fp16-vae 启动；先用短片和低分辨率检查能否运行。</li><li>原生 ComfyUI 能正常打开后，使用下方“连接已有环境”。网络中断可继续下载。</li></ol><div class="fallback-links"><button class="text-button" @click="link('https://docs.comfy.org/installation/comfyui_portable_windows')">ComfyUI 安装教程 ↗</button><button class="text-button" @click="link('https://docs.comfy.org/tutorials/video/minimax/minimax-h3-native')">H3 官方模型教程 ↗</button><button class="text-button" @click="link('https://github.com/reventadirecta/MiniMax-H3-ComfyUI-8GB-VRAM')">8 GB 社区方案 ↗</button></div></div></div>
  </section>
</template>
<style scoped>
.existing-installation{padding:22px;background:var(--control);border:1px solid var(--border);border-radius:16px;margin-top:20px}.existing-title{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.existing-title strong{font-size:17px}.existing-title .badge{margin-left:auto}.existing-installation dl{margin:16px 0;font-size:13px}.existing-installation dl>div{display:grid;grid-template-columns:82px minmax(0,1fr);gap:14px;line-height:1.8}.existing-installation dd{overflow-wrap:anywhere}.existing-installation>.small{margin-top:8px}
.bootstrap-panel{padding:28px;margin:24px 0}.bootstrap-heading{display:flex;justify-content:space-between;gap:24px;margin-bottom:24px}.bootstrap-heading h2{font-size:24px;margin:8px 0 12px;letter-spacing:-.5px}.bootstrap-heading p{font-size:14px;line-height:1.7}.hardware-summary{display:flex;align-items:center;justify-content:space-between;gap:16px;border-block:1px solid var(--border);padding:16px 0;margin-bottom:24px;font-size:14px;flex-wrap:wrap}.hardware-summary span:last-child{color:var(--muted)}.install-profile{width:100%;margin-bottom:20px}.install-label{display:block;font-size:14px;font-weight:550;margin-bottom:10px}.install-path{display:flex;gap:12px}.install-path .input{flex:1;min-width:0}.small{font-size:12px;line-height:1.8;overflow-wrap:anywhere}.bootstrap-panel>.small{margin:12px 0 20px}.btn,.text-button{display:inline-flex;align-items:center;justify-content:center;gap:8px}.recommendation-card{padding:22px;background:var(--accent-tint);border:1px solid var(--accent-border);border-radius:16px;margin:0 0 24px}.recommendation-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}.recommendation-heading strong{font-size:17px}.recommendation-card>p{font-size:14px;line-height:1.8;margin-top:12px}.trial-settings{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:12px;margin-top:16px}.trial-settings span{color:var(--muted)}.trial-settings strong{font-weight:550}.recommendation-notes{color:var(--muted);font-size:12px;line-height:1.9;padding-left:18px;margin:16px 0 0}.tiers{margin-top:18px;border-top:1px solid var(--accent-border);padding-top:16px;font-size:13px}.tiers summary,.file-details summary{min-height:32px;cursor:pointer}.tiers dl{margin:16px 0}.tiers dl>div{display:grid;grid-template-columns:150px 1fr;gap:12px;margin:12px 0;line-height:1.8}.tiers dt{font-weight:550}.tiers dd{margin:0;color:var(--muted)}.install-summary{border-top:1px solid var(--border);padding-top:24px;margin-top:24px}.install-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}.install-metrics span{color:var(--muted);font-size:12px;display:block;margin-bottom:8px}.install-metrics strong{font-size:20px}.install-summary details{margin:20px 0;font-size:14px}.install-summary ul{line-height:1.8;font-size:13px;padding-left:20px;overflow-wrap:anywhere}.file-list{list-style:none;padding:0!important;display:grid;gap:12px}.file-list li{padding:14px;background:var(--control);border:1px solid var(--border);border-radius:10px;display:grid;gap:5px}.file-list li strong{font-size:13px;overflow-wrap:anywhere}.file-list span,.file-list code{font-size:12px;color:var(--muted);overflow-wrap:anywhere}.source-url{opacity:.85}.consent{display:flex;gap:10px;font-size:14px;line-height:1.8;margin:20px 0}.consent input{width:18px;height:18px;accent-color:var(--accent);flex-shrink:0;margin-top:4px}.install-progress{padding:24px 0;border-top:1px solid var(--border);margin-top:24px}.progress-message{font-size:13px;color:var(--muted);line-height:1.8;margin-top:10px}.progress-caption{display:flex;justify-content:space-between;gap:20px;font-size:14px}progress{width:100%;height:10px;accent-color:var(--accent);margin:16px 0}.good{display:flex;align-items:center;gap:8px;line-height:1.8}.manual-fallback{border-top:1px solid var(--border);padding-top:20px;margin-top:24px}.manual-steps{font-size:14px;line-height:1.8}.fallback-links{display:flex;gap:24px;flex-wrap:wrap}.error,.warning{font-size:14px;line-height:1.8;overflow-wrap:anywhere}@media(max-width:900px){.install-metrics{grid-template-columns:1fr}.install-path{flex-direction:column}.bootstrap-panel{padding:20px}.tiers dl>div{grid-template-columns:1fr;gap:4px}}
</style>
