<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { PhArrowClockwise, PhCheckCircle, PhDownloadSimple, PhPause, PhWarningCircle } from '@phosphor-icons/vue'
import type { InstallableResourceCategory, InstallableResourceSummary, ResourceInstallProgress } from '../../shared/resource-installation'
import { invoke } from '../src/api'

const resources = ref<InstallableResourceSummary[]>([])
const progress = ref<ResourceInstallProgress>()
const error = ref('')
const loading = ref(false)
const category = ref<'all' | InstallableResourceCategory>('all')
let timer: ReturnType<typeof setInterval> | undefined

const labels: Record<InstallableResourceCategory, string> = {
  'diffusion-model': '扩散模型', 'text-encoder': '文本编码器', vae: 'VAE', lora: 'LoRA',
  'clip-projection': '辅助模型', 'model-patch': '模型补丁', 'custom-node': '自定义节点'
}
const tabs = computed(() => ['all', ...Array.from(new Set(resources.value.map(item => item.category)))] as const)
const visible = computed(() => category.value === 'all' ? resources.value : resources.value.filter(item => item.category === category.value))
const active = computed(() => progress.value && ['idle', 'downloading', 'verifying', 'extracting'].includes(progress.value.status))
const percent = computed(() => progress.value?.totalBytes ? Math.min(100, Math.round(progress.value.receivedBytes / progress.value.totalBytes * 100)) : 0)
const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : `${(bytes / 1024 ** 2).toFixed(0)} MiB`

async function load() {
  loading.value = true; error.value = ''
  try { resources.value = await invoke<InstallableResourceSummary[]>('resource.catalog') }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
  finally { loading.value = false }
}
async function poll() {
  try {
    progress.value = await invoke<ResourceInstallProgress | undefined>('resource.install.status')
    if (progress.value && ['completed', 'error', 'cancelled'].includes(progress.value.status)) await load()
  } catch { /* The next poll or manual refresh can recover. */ }
}
async function install(id: string) {
  error.value = ''
  try { await invoke('resource.install.start', { id }); await poll() }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
}
async function cancel() { await invoke('resource.install.cancel'); await poll() }
onMounted(async () => { await load(); await poll(); timer = setInterval(() => void poll(), 700) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <section class="downloads">
    <div class="download-intro panel">
      <div><p class="eyebrow">固定来源 · 完整性校验</p><h2>按需补充模型与节点</h2><p class="muted">LoRA 是模型权重；自定义节点是程序扩展。资源会放入各自的标准目录，已有未知文件不会被覆盖。</p></div>
      <button class="btn secondary" :disabled="loading || active" @click="load"><PhArrowClockwise :size="17" />重新检查</button>
    </div>
    <div class="tabs resource-filter" role="tablist" aria-label="可下载资源类型">
      <button v-for="tab in tabs" :key="tab" role="tab" :aria-selected="category === tab" :class="{ active: category === tab }" @click="category = tab">{{ tab === 'all' ? '全部' : labels[tab] }}</button>
    </div>
    <div v-if="progress" class="panel progress-card" role="status">
      <div><strong>{{ progress.message }}</strong><span class="muted">{{ percent }}% · {{ size(progress.receivedBytes) }} / {{ size(progress.totalBytes) }}</span></div>
      <progress :value="progress.receivedBytes" :max="progress.totalBytes || 1" />
      <button v-if="active" class="btn secondary" @click="cancel"><PhPause :size="16" />暂停</button>
      <p v-if="progress.error" class="error">{{ progress.error }}</p>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="download-grid">
      <article v-for="item in visible" :key="item.id" class="panel resource-download-card">
        <div class="resource-card-top"><span class="badge">{{ labels[item.category] }}</span><span class="resource-state" :class="item.status === 'installed' ? 'good' : 'muted'"><component :is="item.status === 'installed' ? PhCheckCircle : PhWarningCircle" :size="16" />{{ item.status === 'installed' ? '已安装' : '未安装' }}</span></div>
        <h3>{{ item.displayName }}</h3><p class="muted purpose">{{ item.purpose }}</p>
        <dl><dt>适用</dt><dd>{{ item.compatibility }}</dd><dt>来源</dt><dd>{{ item.source }}</dd><dt>目录</dt><dd :title="item.relativeTarget">{{ item.category === 'custom-node' ? 'custom_nodes/' : 'models/' }}{{ item.relativeTarget }}</dd><dt>大小</dt><dd>{{ size(item.sizeBytes) }}</dd></dl>
        <button class="btn" :class="item.status === 'installed' ? 'secondary' : 'primary'" :disabled="item.status === 'installed' || active" @click="install(item.id)"><PhDownloadSimple :size="17" />{{ item.status === 'installed' ? '已经安装' : '下载并安装' }}</button>
      </article>
    </div>
  </section>
</template>

<style scoped>
.downloads{min-width:0}.download-intro{padding:24px;display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:20px}.download-intro h2{font-size:22px;margin:4px 0 10px}.download-intro p{margin-bottom:0;line-height:1.8}.resource-filter{margin-bottom:20px}.progress-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px 18px;align-items:center;padding:20px;margin-bottom:20px}.progress-card>div{display:flex;justify-content:space-between;gap:16px;min-width:0}.progress-card progress{width:100%;height:8px;accent-color:var(--accent)}.progress-card>p{grid-column:1/-1;margin:0}.download-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.resource-download-card{padding:22px;min-width:0}.resource-card-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.resource-download-card h3{font-size:18px;margin:18px 0 8px;overflow-wrap:anywhere}.purpose{font-size:13px;line-height:1.7;min-height:44px}.resource-download-card dl{display:grid;grid-template-columns:54px minmax(0,1fr);gap:8px 12px;border-top:1px solid var(--border);padding-top:16px;font-size:12px;line-height:1.7}.resource-download-card dt{color:var(--muted)}.resource-download-card dd{margin:0;overflow-wrap:anywhere}.resource-download-card>.btn{width:100%;margin-top:18px}.resource-state{display:flex;align-items:center;gap:6px;font-size:12px}.resource-state>svg{flex:none}
@media(max-width:900px){.download-grid{grid-template-columns:1fr}.download-intro{align-items:flex-start;flex-direction:column}.progress-card{grid-template-columns:1fr}.progress-card>button{justify-self:start}}
@media(max-width:600px){.download-intro,.resource-download-card{padding:20px}.progress-card>div{align-items:flex-start;flex-direction:column}}
</style>
