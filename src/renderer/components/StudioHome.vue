<script setup lang="ts">
import { assetUrl } from '../src/asset-url'
import { computed } from 'vue'
import { PhArrowUpRight, PhPlus, PhUploadSimple, PhPlay, PhCheckCircle, PhArrowRight, PhCpu, PhSpinnerGap, PhWarningCircle, PhFilmStrip } from '@phosphor-icons/vue'
import type { Snapshot, TaskRecord } from '../../shared/contracts'

const props = defineProps<{ snapshot: Snapshot; busy: boolean }>()
const emit = defineEmits<{ create: []; import: []; navigate: [page: string]; action: [command: string]; inspiration: [prompt: string]; restore: [task: TaskRecord] }>()
const inspirations = [
  { id: 'forest', title: '光穿过森林', detail: '自然光 · 镜头探索', image: '/forest-preview.webp', prompt: '晨光穿过薄雾森林，镜头缓缓向前移动，树叶轻轻摇动，自然电影质感。' },
  { id: 'coast', title: '沿着海岸线', detail: '风景 · 叙事练习', image: '/coast-inspiration.webp', prompt: '暮色下的海岸公路，海浪拍打礁石，镜头平稳推进，柔和的电影光线。' },
  { id: 'studio', title: '每一帧，都有故事', detail: '产品 · 视觉表达', image: '/camera-studio.webp', prompt: '精致的产品静物，镜头缓慢环绕，柔和侧光描绘轮廓，背景简洁。' }
]
const ready = computed(() => ['ready', 'busy'].includes(props.snapshot.engine.status))
const names: Record<string, string> = { offline: '引擎未启动', starting: '正在启动', ready: '引擎就绪', busy: '引擎运行中', error: '引擎异常' }
const completed = computed(() => props.snapshot.tasks.filter(t => t.status === 'completed' && t.outputs.length).slice(0, 3))
const vram = computed(() => props.snapshot.hardware.vramMb > 0 ? `${(props.snapshot.hardware.vramMb / 1024).toFixed(1)} GB 显存` : '显存待检测')
const ram = computed(() => props.snapshot.hardware.ramGb > 0 ? `${props.snapshot.hardware.ramGb} GB 内存` : '内存待检测')
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
</script>

<template>
  <section class="gallery-home">
    <header class="intro">
      <div><p class="eyebrow">你的本地创作空间</p><h1>让想象，有画面。</h1><p class="subtitle">从一个灵感，到一段属于你的视频。</p></div>
      <div class="intro-actions"><button class="btn secondary" :disabled="busy" @click="emit('import')"><PhUploadSimple :size="18" />导入工作流</button><button class="btn primary" :disabled="busy" @click="emit('create')"><PhPlus :size="19" />开始创作</button></div>
    </header>
    <section class="feature" aria-label="创作灵感">
      <img :src="assetUrl('/coast-inspiration.webp')" alt="蜿蜒海岸公路与暮色下的海浪" fetchpriority="high" />
      <div class="feature-shade"></div><span class="image-note">风格示例</span>
      <div class="feature-content"><p>从此刻出发</p><h2>你的下一个故事，<br />在这里开始。</h2><button class="btn feature-button" :disabled="busy" @click="emit('create')">打开创作工作台<PhArrowUpRight :size="19" /></button></div>
      <div class="feature-caption"><span>灵感可以很远，创作就在眼前。</span><span>luckyx. Studio</span></div>
    </section>
    <section class="gallery-section" aria-labelledby="gallery-title">
      <div class="section-heading"><div><h2 id="gallery-title">灵感画廊</h2><p>选择一段镜头提示，继续你的创作。</p></div><button class="text-button" @click="emit('navigate', 'tasks')">我的作品<PhArrowRight :size="18" /></button></div>
      <div class="project-grid">
        <button v-for="item in inspirations" :key="item.id" class="project" :disabled="busy" @click="emit('inspiration', item.prompt)">
          <div class="project-image"><img :src="assetUrl(item.image)" :alt="item.title" loading="lazy" /><span class="image-badge">风格示例</span><span class="play"><PhPlay :size="17" weight="fill" /></span></div>
          <div class="project-copy"><div><h3>{{ item.title }}</h3><p>{{ item.detail }}</p></div><PhArrowUpRight :size="20" /></div>
        </button>
      </div>
    </section>
    <footer class="environment-bar">
      <div class="environment-info"><PhCpu :size="21" /><div><strong>{{ snapshot.hardware.gpuName || '显卡待检测' }}</strong><span>{{ vram }} · {{ ram }}</span></div></div>
      <div class="environment-status"><PhCheckCircle v-if="ready" :size="19" weight="fill" /><PhSpinnerGap v-else-if="snapshot.engine.status === 'starting'" :size="19" class="spinning" /><PhWarningCircle v-else :size="19" /><span>{{ names[snapshot.engine.status] }}</span></div>
      <div class="environment-actions"><button v-if="!ready && snapshot.settings.initialized" class="text-button" :disabled="busy || snapshot.engine.status === 'starting'" @click="emit('action', 'engine.start')">启动引擎<PhPlay :size="17" /></button><button class="text-button" @click="emit('navigate', 'setup')">{{ snapshot.settings.initialized ? '检查与配置' : '安装与连接' }}<PhArrowRight :size="17" /></button></div>
    </footer>
    <section class="recent-section" aria-labelledby="recent-title">
      <div class="section-heading"><h2 id="recent-title">最近作品</h2><button class="text-button" @click="emit('navigate', 'tasks')">查看全部<PhArrowRight :size="17" /></button></div>
      <div v-if="completed.length" class="panel recent-list"><button v-for="task in completed" :key="task.id" class="recent-row" @click="emit('restore', task)"><PhFilmStrip :size="26" /><div><strong>{{ task.title }}</strong><p class="muted">{{ date(task.createdAt) }} · {{ task.params.width }} × {{ task.params.height }} · {{ (task.params.frames / 24).toFixed(2) }} 秒</p></div><span class="completed-status"><PhCheckCircle :size="18" />已完成</span><PhArrowUpRight :size="18" /></button></div>
      <div v-else class="panel recent-empty"><PhFilmStrip :size="28" /><div><strong>第一段作品，从这里开始。</strong><p class="muted">完成的视频会保存在任务与作品中，随时预览和导出。</p></div><button class="text-button" @click="emit('create')">去创作<PhArrowRight :size="17" /></button></div>
    </section>
  </section>
</template>

<style scoped>
.gallery-home{max-width:1280px!important;margin-inline:auto}.intro{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:24px}.eyebrow{font-size:12px;letter-spacing:2px;color:var(--muted);margin-bottom:12px}.intro h1{font-size:46px;line-height:1.17;letter-spacing:-1.6px;font-weight:650}.subtitle{color:var(--muted);font-size:15px;margin-top:14px}.intro-actions{display:flex;gap:10px;padding-bottom:2px;flex-shrink:0}.feature{height:280px;position:relative;overflow:hidden;border-radius:22px;background:#18252b;color:white}.feature>img{width:100%;height:100%;object-fit:cover;object-position:center 58%;position:absolute}.feature-shade{position:absolute;inset:0;background:linear-gradient(90deg,#061318cf,#06131838 62%,#06131817),linear-gradient(0deg,#0613186b,transparent 30%)}.image-note{position:absolute;right:22px;top:19px;font-size:12px;color:#e6f0f2;border:1px solid #ffffff3d;border-radius:20px;padding:5px 10px;background:#13242a55}.feature-content{position:absolute;left:40px;top:31px}.feature-content>p{font-size:12px;letter-spacing:2px;color:#cae0de;margin-bottom:13px}.feature h2{font-size:33px;line-height:1.36;letter-spacing:-1px;font-weight:550;color:white}.feature-button{background:white;color:#23302e;border-radius:10px;padding-inline:17px;font-weight:600;margin-top:24px}.feature-caption{position:absolute;bottom:21px;left:40px;right:25px;display:flex;justify-content:space-between;font-size:12px;color:#d6e3e5;letter-spacing:.6px}.gallery-section{margin-top:24px}.section-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;gap:16px}.section-heading h2{font-size:22px;font-weight:650;letter-spacing:-.65px}.section-heading p{font-size:13px;color:var(--muted);margin-top:7px}.project-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.project{display:block;text-align:left;border:1px solid var(--border);background:var(--surface);border-radius:16px;overflow:hidden;min-width:0;padding:0;color:var(--text);font:inherit;cursor:pointer}.project-image{height:145px;position:relative;background:#172427;overflow:hidden}.project-image img{width:100%;height:100%;object-fit:cover}.image-badge{position:absolute;top:12px;left:13px;font-size:12px;color:#fff;background:#111e24c9;border:1px solid #ffffff21;border-radius:6px;padding:4px 7px}.play{position:absolute;right:14px;bottom:13px;width:33px;height:33px;border:1px solid #ffffff60;border-radius:50%;display:grid;place-items:center;background:#172427ad;color:#fff}.project-copy{padding:17px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px}.project h3{font-size:15px;font-weight:600;letter-spacing:-.3px}.project-copy p{font-size:12px;color:var(--muted);margin-top:7px}.project-copy>svg{color:var(--muted)}.environment-bar{margin-top:20px;display:flex;align-items:center;gap:24px;padding:14px 18px;background:var(--accent-tint);border:1px solid var(--accent-border);border-radius:12px;min-width:0}.environment-info{display:flex;align-items:center;gap:12px;font-size:12px;min-width:0;flex:1}.environment-info>div{min-width:0}.environment-info strong{display:block;font-size:13px;overflow-wrap:anywhere}.environment-info span{display:block;color:var(--muted);margin-top:5px}.environment-info svg,.environment-status svg{color:var(--accent);flex-shrink:0}.environment-status{display:flex;align-items:center;gap:8px;font-size:12px;white-space:nowrap}.environment-actions{display:flex;gap:12px}.recent-section{margin-top:24px}.recent-list{padding:0 20px}.recent-row{gap:16px}.recent-row svg{flex-shrink:0}.recent-empty{background:var(--surface)}
@media(min-width:1600px){.feature{height:330px}.project-image{height:178px}}
@media(max-width:1310px){.intro h1{font-size:41px}.feature{height:280px}}
@media(max-width:760px){.intro{display:block}.intro h1{font-size:34px;letter-spacing:-1px}.subtitle{font-size:14px}.intro-actions{margin-top:23px;gap:9px}.intro-actions .btn{flex:1;padding-inline:12px}.feature{height:306px;border-radius:18px}.feature-content{left:24px;top:35px}.feature h2{font-size:27px}.feature-caption{left:24px;right:20px;gap:20px;line-height:1.5}.feature-caption span:first-child{max-width:190px}.image-note{right:16px;top:14px}.project-grid{grid-template-columns:1fr;gap:14px}.project-image{height:187px}.section-heading h2{font-size:21px}.environment-bar{flex-wrap:wrap;gap:12px;padding:14px}.environment-info{flex-basis:100%}.environment-actions{margin-left:auto;gap:8px}.environment-actions .text-button{font-size:13px}.recent-row{gap:10px;flex-wrap:wrap}.completed-status{display:none}.recent-empty{flex-wrap:wrap}.recent-empty>button{margin-left:0}}
</style>
