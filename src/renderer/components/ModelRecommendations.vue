<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhCpu, PhArrowSquareOut, PhCheckCircle, PhInfo, PhPlay, PhArrowRight, PhDownloadSimple, PhBookOpen } from '@phosphor-icons/vue'
import type { Snapshot } from '../../shared/contracts'
import { rankModelRecommendations } from '../../shared/model-recommendations'

const props = defineProps<{ snapshot: Snapshot }>()
const emit = defineEmits<{ action: [command: string, payload?: unknown]; create: [] }>()
const order = ['wan22-ti2v-5b', 'wan21-t2v-13b', 'ltx-video-2b-095', 'minimax-h3-existing']
const selectedId = ref('wan22-ti2v-5b')
const ranked = computed(() => rankModelRecommendations(/NVIDIA/i.test(props.snapshot.hardware.gpuName) ? props.snapshot.hardware.vramMb : 0, props.snapshot.hardware.ramGb).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)))
const selected = computed(() => ranked.value.find(model => model.id === selectedId.value) ?? ranked.value[0]!)
const hardwareLabel = computed(() => `${props.snapshot.hardware.gpuName || '显卡待识别'} · ${props.snapshot.hardware.vramMb > 0 ? (props.snapshot.hardware.vramMb / 1024).toFixed(1) + ' GB 显存' : '显存待检测'} · ${props.snapshot.hardware.ramGb > 0 ? props.snapshot.hardware.ramGb + ' GB 内存' : '内存待检测'}`)
const h3Generated = computed(() => ['ready', 'busy'].includes(props.snapshot.engine.status) && props.snapshot.templates.some(template => template.id === 'h3-i2v' && template.ready) && props.snapshot.tasks.some(task => task.status === 'completed' && task.params.templateId === 'h3-i2v' && task.outputs.length > 0))
const images: Record<string, string> = { 'wan22-ti2v-5b': '/coast-inspiration.webp', 'wan21-t2v-13b': '/camera-studio.webp', 'ltx-video-2b-095': '/forest-preview.webp', 'minimax-h3-existing': '/forest-preview.webp' }
const roles: Record<string, string> = { 'wan22-ti2v-5b': '首推探索', 'wan21-t2v-13b': '轻量备选', 'ltx-video-2b-095': '可选探索', 'minimax-h3-existing': '音画同步' }
const screenshotFailed = ref<Record<string, boolean>>({})
function openReference(url: string) { emit('action', 'native.openReference', { url }) }
function modelState(id: string) { return id === 'minimax-h3-existing' ? (h3Generated.value ? '工作台可用 · 此设备已有作品' : '支持创作工作台 · 请先检查环境') : '使用方式：原生 ComfyUI' }
</script>

<template>
  <section class="model-rec" aria-label="模型推荐与官方安装教程">
    <div class="hardware-summary"><PhCpu :size="24" /><div><strong>{{ hardwareLabel }}</strong><p>按显存与内存匹配模型，建议从低分辨率短片开始。</p></div></div>
    <div class="recommendation-layout">
      <div class="model-grid" aria-label="模型选择">
        <article v-for="model in ranked" :key="model.id" class="model-card" :class="{ selected: selectedId === model.id }">
          <button class="inspiration" :aria-label="`查看 ${model.name} 的官方教程，封面为创作配图`" @click="openReference(model.tutorialUrl)"><img :src="images[model.id]" alt="创作灵感配图，不代表该模型的生成结果" loading="lazy" /><span>创作配图</span><span class="role-tag">{{ roles[model.id] }}</span></button>
          <div class="card-content"><h3>{{ model.name }}</h3><p class="purpose">{{ model.purpose }}</p><span class="level" :class="model.level"><component :is="model.level === 'recommended' ? PhCheckCircle : PhInfo" :size="16" />{{ model.levelLabel }}</span><p class="source-note">{{ model.description }}</p><p class="model-state" :class="{ verified: model.id === 'minimax-h3-existing' && h3Generated }">{{ modelState(model.id) }}</p><div class="card-actions"><button class="btn secondary" :aria-pressed="selectedId === model.id" @click="selectedId = model.id">{{ selectedId === model.id ? '正在查看教程' : '查看安装教程' }}<PhArrowRight :size="16" /></button><button class="official-link" :aria-label="`打开 ${model.name} 官方教程`" @click="openReference(model.tutorialUrl)"><PhArrowSquareOut :size="17" /></button></div></div>
        </article>
      </div>
      <aside class="tutorial-panel" aria-label="所选模型安装详情">
        <header><p class="detail-eyebrow">官方资料 · 安装指南</p><h2>{{ selected.name }}</h2><p class="detail-state">{{ modelState(selected.id) }}</p></header>
        <div class="reference-actions"><button class="btn secondary" @click="openReference(selected.tutorialUrl)"><PhBookOpen :size="17" />官方教程<PhArrowSquareOut :size="14" /></button><button class="btn secondary" @click="openReference(selected.repositoryUrl)">模型项目<PhArrowSquareOut :size="14" /></button></div>
        <button class="tutorial-screenshot" :aria-label="`打开 ${selected.name} 官方教程原文`" @click="openReference(selected.tutorialUrl)"><img v-if="!screenshotFailed[selected.id]" :src="selected.screenshotPath" :alt="`${selected.name} 官方教程页面截图`" loading="lazy" @error="screenshotFailed[selected.id] = true" /><span v-else class="screenshot-empty"><PhBookOpen :size="30" />打开官方教程原文</span><span class="screenshot-caption">官方教程截图 · 点击打开原文<PhArrowSquareOut :size="14" /></span></button>
        <h3 class="detail-heading">安装步骤</h3><ol class="install-steps"><li v-for="(step, index) in selected.steps" :key="step"><span>{{ index + 1 }}</span><p>{{ step }}</p></li></ol>
        <div class="initial-settings"><strong>建议首次试跑</strong><p>{{ selected.initial.width }} × {{ selected.initial.height }} · {{ selected.initial.frames }} 帧</p><p>{{ selected.initial.note }}</p></div>
        <h3 class="detail-heading">需要的模型文件 <small>{{ selected.downloads.length }} 个</small></h3><p class="files-help">点击文件名打开官方文件页；文件放入 ComfyUI/models 下的对应子目录。</p><ul class="file-list"><li v-for="file in selected.downloads" :key="file.name"><button @click="openReference(file.url)"><PhDownloadSimple :size="16" /><span>{{ file.name }}</span><PhArrowSquareOut :size="14" /></button><code>models/{{ file.folder }}/</code></li></ul>
        <details class="conditions"><summary>配置要求与推荐依据</summary><p class="evidence-note">{{ selected.sourceNote }}</p><ul><li v-for="condition in selected.conditions" :key="condition">{{ condition }}</li></ul></details>
        <button v-if="selected.id === 'minimax-h3-existing'" class="btn primary create-button" @click="emit('create')"><PhPlay :size="17" weight="fill" />打开 H3 创作工作台</button>
        <p v-else class="manual-note"><PhInfo :size="17" />请按教程在原生 ComfyUI 中安装和运行此模型。启动器创作工作台目前支持 H3。</p>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.card-actions .btn, .reference-actions .btn, .install-steps p, .file-list button, .purpose, .source-note { font-size: 14px !important; }
.model-rec { font-size: 14px; line-height: 1.6; min-width: 0; }
.model-rec h2,.model-rec h3,.model-rec p { margin: 0; }
.hardware-summary { display: flex; align-items: center; gap: 14px; padding: 18px 20px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); margin-bottom: 20px; }
.hardware-summary > svg { color: var(--accent); flex-shrink: 0; }.hardware-summary strong { font-size: 14px; font-weight: 500; }.hardware-summary p { color: var(--muted); font-size: 12px; margin-top: 4px; }
.recommendation-layout { display: grid; grid-template-columns: minmax(0,1.55fr) minmax(300px,1fr); gap: 20px; align-items: start; }.model-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 16px; }
.model-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; min-width: 0; overflow: hidden; }.model-card.selected { border-color: var(--accent); }.inspiration { position: relative; display: block; padding: 0; border: 0; width: 100%; background: var(--control); cursor: pointer; overflow: hidden; }.inspiration img { display: block; width: 100%; aspect-ratio: 2.2; object-fit: cover; }.inspiration > span { position: absolute; left: 10px; bottom: 10px; padding: 3px 7px; border-radius: 4px; background: #101619e8; color: #d4dcd9; font-size: 12px; }.inspiration > .role-tag { top: 10px; bottom: auto; color: var(--accent); }
.card-content { padding: 16px; }.card-content h3 { font-size: 15px; font-weight: 600; line-height: 1.5; margin-bottom: 6px; }.purpose { color: var(--muted); font-size: 12px; min-height: 38px; }.level { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; margin: 12px 0 8px; }.level.recommended { color: var(--accent); }.level.conditional { color: var(--warning); }.source-note { color: var(--muted); font-size: 12px; line-height: 1.7; min-height: 62px; }.model-state { font-size: 12px; color: var(--muted); margin-top: 10px !important; }.model-state.verified { color: var(--accent); }.card-actions { display: flex; gap: 8px; align-items: center; margin-top: 16px; }.card-actions .btn { flex: 1; min-width: 0; font-size: 12px; padding: 0 10px; gap: 6px; }.official-link { min-width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center; color: var(--muted); background: var(--control); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
.tutorial-panel { min-width: 0; border: 1px solid var(--border); border-radius: 8px; padding: 20px; background: var(--surface); }.detail-eyebrow { color: var(--accent); font-size: 12px; margin-bottom: 7px !important; }.tutorial-panel h2 { font-size: 19px; font-weight: 600; line-height: 1.5; }.detail-state { font-size: 12px; color: var(--muted); margin-top: 8px !important; }.reference-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }.reference-actions .btn { min-height: 40px; font-size: 12px; padding: 0 12px; }.tutorial-screenshot { width: 100%; display: block; background: var(--control); padding: 0; color: var(--muted); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; overflow: hidden; }.tutorial-screenshot img { width: 100%; display: block; aspect-ratio: 1.65; object-fit: cover; object-position: top; }.screenshot-empty { min-height: 160px; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 10px; }.screenshot-caption { display: flex; justify-content: space-between; gap: 8px; align-items: center; padding: 9px 10px; font-size: 12px; text-align: left; }.detail-heading { font-size: 14px; font-weight: 600; margin: 22px 0 12px !important; display: flex; align-items: center; justify-content: space-between; }.detail-heading small { color: var(--muted); font-size: 12px; font-weight: 400; }.install-steps { list-style: none; margin: 0; padding: 0; }.install-steps li { display: flex; gap: 10px; margin-bottom: 12px; }.install-steps li > span { width: 24px; height: 24px; border: 1px solid var(--border); background: var(--control); border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: var(--accent); font-size: 12px; }.install-steps p { font-size: 12px; color: var(--muted); line-height: 1.8; }
.initial-settings { background: var(--control); border: 1px solid var(--border); border-radius: 6px; padding: 12px; margin-top: 18px; }.initial-settings strong { font-size: 12px; font-weight: 500; }.initial-settings p { font-size: 12px; color: var(--muted); margin-top: 5px; }.files-help { font-size: 12px; color: var(--muted); margin-bottom: 10px !important; }.file-list { list-style: none; padding: 0; margin: 0; }.file-list li { padding: 10px 0; border-top: 1px solid var(--border); }.file-list button { display: flex; align-items: center; gap: 7px; width: 100%; text-align: left; padding: 6px 0; min-height: 40px; background: none; border: none; color: var(--accent); cursor: pointer; font: inherit; font-size: 12px; }.file-list button span { flex: 1; min-width: 0; overflow-wrap: anywhere; }.file-list button svg { flex-shrink: 0; }.file-list code { display: block; padding-left: 23px; font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }.conditions { margin-top: 18px; border-top: 1px solid var(--border); padding-top: 12px; font-size: 12px; color: var(--muted); }.conditions summary { cursor: pointer; min-height: 40px; display: flex; align-items: center; color: var(--text); }.conditions ul { padding-left: 18px; margin: 0; }.conditions li { margin: 7px 0; line-height: 1.8; }.create-button { width: 100%; margin-top: 20px; }.manual-note { display: flex; gap: 8px; font-size: 12px; color: var(--muted); line-height: 1.8; margin-top: 18px !important; }.manual-note svg { flex-shrink: 0; margin-top: 3px; }
button:focus-visible,summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
@media(max-width:1200px) { .recommendation-layout { grid-template-columns: minmax(0,1.4fr) minmax(280px,1fr); gap: 16px; }.model-grid { gap: 12px; }.card-content { padding: 12px; }.card-actions { flex-wrap: wrap; }.source-note { min-height: 82px; }.tutorial-panel { padding: 16px; } }
@media(max-width:1050px) { .recommendation-layout { grid-template-columns: 1fr; }.model-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }.source-note { min-height: 42px; }.tutorial-screenshot { max-width: 640px; }.hardware-summary { align-items: flex-start; } }
@media(max-width:650px) { .model-grid { grid-template-columns: 1fr; }.hardware-summary { padding: 14px; }.source-note,.purpose { min-height: 0; } }
</style>



