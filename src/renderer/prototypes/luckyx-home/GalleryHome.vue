<script setup lang="ts">
import { PhArrowUpRight, PhPlus, PhUploadSimple, PhSlidersHorizontal, PhPlay, PhCheckCircle, PhArrowRight } from '@phosphor-icons/vue'
defineProps<{ draftCount: number; reduceMotion: boolean }>()
const emit = defineEmits<{ action: [name: string, payload?: string] }>()
const projects = [
  { id: 'forest', title: '光穿过森林', detail: '自然光 · 镜头探索', image: '/forest-preview.webp' },
  { id: 'coast', title: '沿着海岸线', detail: '风景 · 叙事练习', image: '/coast-inspiration.webp' },
  { id: 'studio', title: '每一帧，都有故事', detail: '产品 · 视觉表达', image: '/camera-studio.webp' }
]
</script>

<template>
  <div class="gallery-home" :class="{ 'reduce-motion': reduceMotion }">
    <header class="topbar">
      <button class="wordmark" aria-label="luckyx. Studio 首页" @click="emit('action', 'home')"><img src="/brand/luckyx-symbol.svg" alt="" />luckyx.<span>Studio</span></button>
      <nav aria-label="主导航">
        <button class="selected" aria-current="page" @click="emit('action', 'home')">概览</button>
        <button @click="emit('action', 'workflows')">工作流</button>
        <button @click="emit('action', 'history')">任务与作品<span v-if="draftCount" class="count">{{ draftCount }}</span></button>
      </nav>
      <button class="icon-button" aria-label="打开设置" @click="emit('action', 'settings')"><PhSlidersHorizontal :size="21" /></button>
    </header>

    <main>
      <section class="intro">
        <div><p class="eyebrow">你的本地创作空间</p><h1>让想象，有画面。</h1><p class="subtitle">从一个灵感，到一段属于你的视频。</p></div>
        <div class="intro-actions"><button class="outline" @click="emit('action', 'import')"><PhUploadSimple :size="18" />导入工作流</button><button class="primary" @click="emit('action', 'create')"><PhPlus :size="19" />开始创作</button></div>
      </section>

      <section class="feature" aria-label="创作灵感">
        <img src="/coast-inspiration.webp" alt="蜿蜒海岸公路与暮色下的海浪" />
        <div class="feature-shade"></div>
        <span class="image-note">风格示例</span>
        <div class="feature-content"><p>从此刻出发</p><h2>你的下一个故事，<br />在这里开始。</h2><button class="light" @click="emit('action', 'create')">打开创作工作台<PhArrowUpRight :size="19" /></button></div>
        <div class="feature-caption"><span>灵感可以很远，创作就在眼前。</span><span>01 / 03</span></div>
      </section>

      <section class="gallery-section" aria-labelledby="gallery-title">
        <div class="section-heading"><div><h2 id="gallery-title">灵感画廊</h2><p>选择一种画面，开启你的探索。</p></div><button class="text-button" @click="emit('action', 'history')">我的作品<PhArrowRight :size="18" /></button></div>
        <div class="project-grid">
          <button v-for="project in projects" :key="project.id" class="project" @click="emit('action', 'project', project.id)">
            <div class="project-image"><img :src="project.image" :alt="project.title" /><span class="small-note">风格示例</span><span class="play"><PhPlay :size="17" weight="fill" /></span></div>
            <div class="project-copy"><div><h3>{{ project.title }}</h3><p>{{ project.detail }}</p></div><PhArrowUpRight :size="20" /></div>
          </button>
        </div>
      </section>

      <footer class="environment-bar"><div class="environment-info"><PhCheckCircle :size="19" weight="fill" /><span>创作环境</span><span class="environment-detail">演示配置 · 16 GB 显存 · ComfyUI</span></div><button class="text-button" @click="emit('action', 'environment')">检查与配置<PhArrowRight :size="17" /></button></footer>
    </main>
  </div>
</template>

<style scoped>
.gallery-home{--ink:#1d2327;--muted:#657079;--mint:#57d8b3;--hairline:#dfe3e5;min-height:100vh;background:#f6f7f8;color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;font-size:14px;-webkit-font-smoothing:antialiased}
*{box-sizing:border-box}button{font:inherit;cursor:pointer;color:inherit;border:0;background:none;min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:10px;touch-action:manipulation;transition:transform 150ms cubic-bezier(.23,1,.32,1),opacity 150ms cubic-bezier(.23,1,.32,1)}button:active{transform:scale(.98);opacity:.82;transition:none}button:focus-visible{outline:3px solid #137f63;outline-offset:4px}button svg{flex-shrink:0}h1,h2,h3,p{margin:0}.topbar{height:80px;max-width:1304px;margin:auto;padding:0 44px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--hairline);gap:24px}.wordmark{font-size:24px;font-weight:750;letter-spacing:-1.2px;gap:9px;white-space:nowrap}.wordmark img{height:28px;width:28px}.wordmark span{font-weight:450;letter-spacing:-.65px;margin-left:1px}nav{display:flex;align-items:center;gap:24px}nav button{font-size:14px;padding:0 10px;color:var(--muted);white-space:nowrap}nav .selected{color:var(--ink);font-weight:650}.count{font-size:12px;background:#e4e8e9;padding:3px 6px;border-radius:6px;min-width:20px}.icon-button{width:44px;border:1px solid var(--hairline);border-radius:50%;background:#fff}main{max-width:1216px;margin:auto;padding:28px 0 24px}.intro{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:24px}.eyebrow{font-size:12px;letter-spacing:2px;color:var(--muted);margin-bottom:12px}h1{font-size:46px;line-height:1.17;letter-spacing:-2px;font-weight:650}.subtitle{color:var(--muted);font-size:15px;margin-top:14px}.intro-actions{display:flex;gap:10px;padding-bottom:2px}.primary,.outline{padding:0 20px;border-radius:11px;font-weight:600;height:46px}.primary{background:var(--ink);color:white}.outline{background:#fff;border:1px solid #d7dcde}.primary svg{color:var(--mint)}.feature{height:280px;position:relative;overflow:hidden;border-radius:22px;background:#18252b;color:white}.feature>img{width:100%;height:100%;object-fit:cover;object-position:center 58%;position:absolute}.feature-shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(6,19,24,.81),rgba(6,19,24,.22) 62%,rgba(6,19,24,.09)),linear-gradient(0deg,rgba(6,19,24,.42),transparent 30%)}.image-note{position:absolute;right:22px;top:19px;font-size:12px;color:#e6f0f2;border:1px solid #ffffff3d;border-radius:20px;padding:5px 10px;background:#13242a55}.feature-content{position:absolute;left:40px;top:31px}.feature-content>p{font-size:12px;letter-spacing:2px;color:#cae0de;margin-bottom:13px}.feature h2{font-size:33px;line-height:1.36;letter-spacing:-1px;font-weight:550}.light{background:white;color:#23302e;border-radius:10px;padding:0 17px;font-weight:600;margin-top:24px}.feature-caption{position:absolute;bottom:21px;left:40px;right:25px;display:flex;justify-content:space-between;font-size:12px;color:#d6e3e5;letter-spacing:.6px}.gallery-section{margin-top:24px}.section-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;gap:16px}.section-heading h2{font-size:22px;font-weight:650;letter-spacing:-.65px}.section-heading p{font-size:13px;color:var(--muted);margin-top:7px}.text-button{font-size:13px;font-weight:550;white-space:nowrap;padding:0 6px}.project-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.project{display:block;text-align:left;border:1px solid #dde2e4;background:#fff;border-radius:16px;overflow:hidden;min-width:0;padding:0}.project-image{height:145px;position:relative;background:#172427;overflow:hidden}.project-image img{width:100%;height:100%;object-fit:cover}.small-note{position:absolute;top:12px;left:13px;font-size:12px;color:#fff;background:#111e24c9;border:1px solid #ffffff21;border-radius:6px;padding:4px 7px}.play{position:absolute;right:14px;bottom:13px;width:33px;height:33px;border:1px solid #ffffff60;border-radius:50%;display:grid;place-items:center;background:#172427ad;color:#fff}.project-copy{padding:17px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px}.project h3{font-size:15px;font-weight:600;letter-spacing:-.3px}.project-copy p{font-size:12px;color:var(--muted);margin-top:7px}.project-copy>svg{color:#7b858b}.environment-bar{margin-top:20px;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:3px 16px;background:#ebefed;border:1px solid #dbe3df;border-radius:12px}.environment-info{display:flex;align-items:center;gap:10px;font-size:12px;font-weight:600}.environment-info svg{color:#218367}.environment-detail{color:#65756e;font-size:12px;font-weight:400;margin-left:5px}
@media(hover:hover) and (pointer:fine){button:hover{opacity:.75}.project:hover{opacity:1;transform:translateY(-2px)}.primary:hover{opacity:.86}}
@media(min-width:1600px){main{max-width:1310px;padding-top:48px}.topbar{max-width:1398px}.feature{height:360px}.project-image{height:186px}}
@media(max-width:1310px){main{margin:0 44px}.topbar{margin:0 24px;padding:0 20px}h1{font-size:41px}.feature{height:292px}.project-image{height:145px}}
@media(max-width:760px){.topbar{height:auto;min-height:88px;padding:14px 0;margin:0 22px;flex-wrap:wrap;gap:6px}.wordmark{font-size:21px}.wordmark img{width:25px;height:25px}nav{order:3;width:100%;justify-content:space-between;gap:4px}nav button{padding:0 4px;font-size:13px}main{margin:0 22px;padding-top:29px}.intro{display:block;margin-bottom:22px}h1{font-size:34px;letter-spacing:-1.5px}.subtitle{font-size:13px}.intro-actions{margin-top:23px;gap:9px}.primary,.outline{padding:0 13px;font-size:13px;flex:1}.feature{height:306px;border-radius:18px}.feature-content{left:24px;top:35px}.feature h2{font-size:27px}.feature-caption{left:24px;right:20px;font-size:12px}.feature-caption span:first-child{max-width:195px;line-height:1.5}.image-note{right:16px;top:14px}.project-grid{grid-template-columns:1fr;gap:14px}.project-image{height:187px}.section-heading h2{font-size:21px}.section-heading p{font-size:12px}.gallery-section{margin-top:27px}.environment-bar{flex-wrap:wrap;padding:12px}.environment-info{flex-wrap:wrap;gap:7px}.environment-detail{width:100%;margin:0 0 0 26px}.environment-bar>.text-button{margin-left:22px}.feature-shade{background:linear-gradient(90deg,#061318c9,#06131820),linear-gradient(0deg,#06131866,transparent 30%)}}
.reduce-motion button{transition:none!important}.reduce-motion .project:hover{transform:none}@media(prefers-reduced-motion:reduce){button{transition:none!important}.project:hover{transform:none}}
</style>
