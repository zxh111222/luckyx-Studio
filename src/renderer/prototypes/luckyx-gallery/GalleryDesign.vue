<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { PhSlidersHorizontal, PhX, PhArrowRight, PhCheckCircle, PhFolderOpen, PhDownloadSimple, PhArrowSquareOut } from '@phosphor-icons/vue'
import HomePage from './HomePage.vue'
import CreativePages from './CreativePages.vue'
import LibraryPages from './LibraryPages.vue'
import EnvironmentPages from './EnvironmentPages.vue'
import { createFocusTrap } from '../../src/ui-preferences'
import { parseWorkflowJson, MAX_WORKFLOW_BYTES } from '../../../shared/workflow-library'
import { pages, readPage, parsePreferences, type PageKey } from './design-model'
const page = ref<PageKey>(readPage(location.search))
const dialog = ref('')
const payload = ref('')
const message = ref('')
const error = ref('')
const formName = ref('我的视频工作流')
const stage = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const imported = ref<{name:string;nodes:number} | null>(null)
const toast = ref('')
const preferences = ref({motion:false,contrast:false,solid:false})
const osMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const systemReduced = ref(osMotion.matches)
const updateSystem = () => systemReduced.value = osMotion.matches
const reduced = computed(() => preferences.value.motion || systemReduced.value)
const navPages = pages.filter(p => p.key !== 'transform')
let releaseFocus: ((restore?:boolean)=>void) | undefined
let opener: HTMLElement | null = null
let timer = 0
const sampleImages: Record<string,string> = {forest:'/forest-preview.webp',coast:'/coast-inspiration.webp',studio:'/camera-studio.webp'}
const dialogTitles: Record<string,string> = {'workflow-actions':'工作流操作','import':'导入工作流','new-workflow':'新建工作流','editor':'原生节点编辑器','preview':'作品预览','project':'灵感画面','draft':'生成设置预览','delete-task':'删除历史记录','remove-workflow':'移除工作流','rename':'重命名工作流','model-guide':'模型安装指南','install-preview':'环境安装进度预览'}
const dialogTitle = computed(() => dialogTitles[dialog.value] || '操作预览')
const modelNames: Record<string,string> = {wan22:'Wan2.2 TI2V · 5B',wan21:'Wan2.1 T2V · 1.3B',ltx:'LTX-Video · 2B',h3:'MiniMax H3', 'wan22-ti2v-5b':'Wan2.2 TI2V · 5B','wan21-t2v-13b':'Wan2.1 T2V · 1.3B','ltx-video-2b-095':'LTX-Video · 2B','minimax-h3-existing':'MiniMax H3'}
const draftValues = computed(() => { try { return JSON.parse(payload.value) } catch { return {prompt:'清晨松林中，镜头缓缓向前。',resolution:'864 × 480',duration:'约 5.17 秒'} } })
function announce(text:string) { toast.value=text;clearTimeout(timer);timer=window.setTimeout(()=>toast.value='',3500) }
function navigate(value:string) {
  if (!pages.some(p=>p.key===value)) return
  dialog.value='';page.value=value as PageKey
  const url=new URL(location.href);url.searchParams.set('p',value);history.replaceState(null,'',url)
  void nextTick(()=>window.scrollTo({top:0,behavior:'auto'}))
}
function action(name:string,value?:string) {
  message.value='';error.value='';payload.value=value || '';opener=document.activeElement as HTMLElement
  const route:Record<string,string>={create:'create',home:'home',workflows:'workflows',history:'tasks',environment:'setup',settings:'settings',tasks:'tasks',resources:'resources',transform:'transform'}
  if(route[name]) { navigate(route[name]);return }
  if(name==='preferences') { preferences.value=parsePreferences(value);return }
  if(['scan','diagnostics','install-check','connect','save-settings','engine-preview','save-workflow','save'].includes(name)) { announce({scan:'资源检查结果已展示；当前为演示数据',diagnostics:'诊断示例已更新，未检测真实设备','install-check':'演示方案检查通过，可查看安装进度样式',connect:'连接信息已保存到预览，未启动真实引擎','save-settings':'设置样式已预览，正式配置未更改','engine-preview':'已预览引擎操作反馈，不启动或停止实际服务','save-workflow':'编辑结果保存入口已预览','save':'编辑结果保存入口已预览'}[name] || '操作已预览');return }
  if(name==='image') { dialog.value='import-image';return }
  if(['export','export-workflow'].includes(name)) { announce(name==='export'?'导出入口已预览，未写入文件':'工作流导出入口已预览，未写入文件');return }
  if(name==='task') { navigate('tasks');return }
  if(name==='add-workflow') { announce('已预览添加工作流副本，不覆盖正式数据');navigate('workflows');return }
  dialog.value=dialogTitles[name]?name:'operation'
  if(dialog.value==='operation') message.value='这是设计预览，当前操作不会修改正式应用数据。'
}
async function importFile(event:Event) {
  const input=event.target as HTMLInputElement; const file=input.files?.[0]; if(!file)return
  try { if(file.size>MAX_WORKFLOW_BYTES)throw new Error('文件最大 5 MiB');const parsed=parseWorkflowJson(await file.text());imported.value={name:file.name,nodes:parsed.nodeCount};message.value=`已验证 ${file.name} · ${parsed.nodeCount} 个节点，未写入正式工作流库` } catch(e) { error.value=e instanceof Error?e.message:'无法读取 JSON' }
  input.value=''
}
function finish(text:string) { dialog.value='';announce(text) }
watch(dialog,async value=>{await nextTick();releaseFocus?.(false);releaseFocus=undefined;if(value&&panel.value)releaseFocus=createFocusTrap(panel.value,opener,()=>dialog.value='');else if(opener?.isConnected)opener.focus({preventScroll:true})})
function onPop(){page.value=readPage(location.search);dialog.value=''}
onMounted(()=>{osMotion.addEventListener('change',updateSystem);window.addEventListener('popstate',onPop)})
onUnmounted(()=>{clearTimeout(timer);releaseFocus?.(false);osMotion.removeEventListener('change',updateSystem);window.removeEventListener('popstate',onPop)})
</script>
<template>
  <div class="gallery-suite" :data-motion-reduced="reduced" :data-contrast="preferences.contrast" :data-solid="preferences.solid">
    <div ref="stage" :inert="Boolean(dialog)">
      <header class="suite-header"><div class="header-inner"><button class="suite-brand" aria-label="luckyx. Studio 首页" @click="navigate('home')"><img src="/brand/luckyx-symbol.svg" alt="" /><strong>luckyx.</strong><span>Studio</span></button><nav class="suite-nav" aria-label="页面导航"><button v-for="item in navPages" :key="item.key" :class="{active:page===item.key||(page==='transform'&&item.key==='create')}" :aria-current="page===item.key||(page==='transform'&&item.key==='create')?'page':undefined" @click="navigate(item.key)">{{ item.name }}</button></nav><div class="header-extra"><span class="design-label">设计预览</span><button class="circle-button" aria-label="打开设置与诊断" @click="navigate('settings')"><PhSlidersHorizontal :size="20" /></button></div><select class="mobile-pages" aria-label="切换页面" :value="page" @change="navigate(($event.target as HTMLSelectElement).value)"><option v-for="item in pages" :key="item.key" :value="item.key">{{ item.name }}</option></select></div></header>
      <main class="suite-content">
        <HomePage v-if="page==='home'" :draft-count="0" :reduce-motion="reduced" @action="action" />
        <CreativePages v-else-if="page==='create'||page==='transform'" :page="page" @action="action" />
        <LibraryPages v-else-if="['workflows','tasks','resources'].includes(page)" :page="page" @action="action" />
        <EnvironmentPages v-else :page="page" @action="action" />
        <footer class="suite-footer"><span>luckyx. Studio · 让本地视频创作更简单</span><span>演示数据 · 素材与工作流保持本地</span></footer>
      </main>
    </div>
    <div v-if="dialog" class="design-scrim" @click.self="dialog=''">
      <section ref="panel" tabindex="-1" class="design-dialog" role="dialog" aria-modal="true" aria-labelledby="design-dialog-title"><header><div><p class="dialog-eyebrow">luckyx. Studio</p><h2 id="design-dialog-title">{{ dialogTitle }}</h2></div><button class="circle-button" aria-label="关闭对话框" @click="dialog=''"><PhX :size="20" /></button></header>
        <template v-if="dialog==='import'"><p class="dialog-note">支持 ComfyUI 节点 JSON 与 API JSON，单个文件最大 5 MiB。</p><label class="upload-zone"><PhFolderOpen :size="36" /><strong>选择你的工作流</strong><span>JSON 文件 · 保留原文件</span><input type="file" accept=".json,application/json" @change="importFile" /></label><p v-if="message" class="message-good" role="status">{{ message }}</p><p v-if="error" class="message-error" role="alert">{{ error }}</p><footer><span class="dialog-note">这里只验证文件，不写入正式数据。</span><button class="design-button primary" :disabled="!imported" @click="finish('工作流导入交互已预览')">完成预览<PhArrowRight :size="18" /></button></footer></template>
        <template v-else-if="dialog==='workflow-actions'"><p class="dialog-note">管理工作流副本，原始文件与素材保持不变。</p><div class="dialog-actions-list"><button class="design-button secondary" @click="dialog='rename'">重命名</button><button class="design-button secondary" @click="dialog='import'">更新 JSON</button><button class="design-button danger" @click="dialog='remove-workflow'">移除工作流副本</button></div></template>
        <template v-else-if="dialog==='new-workflow'||dialog==='rename'"><p class="dialog-note">给这份工作流一个容易找到的名称。</p><label class="dialog-field">工作流名称<input v-model="formName" maxlength="80" autofocus /></label><p class="dialog-note">连接节点仍使用原生 ComfyUI 编辑器。</p><footer><button class="design-button secondary" @click="dialog=''">取消</button><button class="design-button primary" :disabled="!formName.trim()" @click="finish('工作流名称已预览：'+formName)">保存预览</button></footer></template>
        <template v-else-if="dialog==='delete-task'||dialog==='remove-workflow'"><p class="dialog-note">{{ dialog==='delete-task'?'删除这条历史记录后，任务与对应作品记录不再显示。视频和素材文件会保留。':'移除启动器中的工作流副本，原始 JSON 和素材会保留。' }}</p><div class="delete-note">此操作需要确认。当前为设计预览，不会执行真实删除。</div><footer><button class="design-button secondary" autofocus @click="dialog=''">保留记录</button><button class="design-button danger" @click="finish('删除确认样式已预览，记录未实际删除')">确认删除记录</button></footer></template>
        <template v-else-if="dialog==='project'||dialog==='preview'"><img class="dialog-preview" :src="sampleImages[payload]||sampleImages.forest" alt="静态作品风格示例" /><span class="dialog-note">静态风格示例 · 非本次生成结果</span><footer><span>864 × 480 · 约 5.17 秒</span><button class="design-button primary" @click="navigate('create')">继续创作<PhArrowRight :size="18" /></button></footer></template>
        <template v-else-if="dialog==='draft'"><p class="dialog-note">确认输入素材与参数，再提交给本地引擎。</p><dl class="dialog-details"><div><dt>模型</dt><dd>MiniMax H3</dd></div><div><dt>分辨率</dt><dd>{{ draftValues.resolution||'864 × 480' }}</dd></div><div><dt>时长</dt><dd>{{ draftValues.duration||'约 5.17 秒' }}</dd></div><div><dt>提示词</dt><dd>{{ draftValues.prompt||'清晨松林中，镜头缓缓向前。' }}</dd></div></dl><footer><span class="dialog-note">设计预览不会提交真实生成。</span><button class="design-button primary" @click="finish('生成确认样式已预览，未提交任务')">完成预览</button></footer></template>
        <template v-else-if="dialog==='model-guide'"><p class="dialog-note">{{ modelNames[payload]||payload||'视频模型' }} · 安装指南</p><ol class="guide-steps"><li>打开官方模型文件页，确认版本与许可。</li><li>按清单放入对应模型目录。</li><li>在 ComfyUI 重新检查节点与模型依赖。</li><li>使用短片和较低分辨率试跑。</li></ol><p class="dialog-note">推荐代表试用方向，不能保证每台设备都可运行。</p><button class="design-button secondary" @click="finish('官方链接入口已预览')">官方文件页<PhArrowSquareOut :size="18" /></button></template>
        <template v-else-if="dialog==='install-preview'"><p class="dialog-note">下载、校验与配置集中展示，失败时可查看日志或手动教程。</p><div class="install-demo"><PhDownloadSimple :size="28" /><div><strong>正在下载模型</strong><span>演示进度 · 18.4 / 41.0 GiB</span></div><b>45%</b></div><progress value="45" max="100" aria-label="演示下载进度" /><ol class="install-stages"><li class="done"><PhCheckCircle :size="18" />检查设备与空间</li><li class="current">下载环境与模型</li><li>校验与配置</li></ol><footer><button class="design-button secondary" @click="finish('暂停反馈已预览，没有实际下载')">暂停下载</button><button class="design-button primary" @click="dialog=''">返回安装页面</button></footer></template>
        <template v-else-if="dialog==='editor'"><p class="dialog-note">工作流仍在 ComfyUI 原生节点编辑器中连接和调整。启动器负责导入、管理、打开与保存副本。</p><div class="editor-note"><PhArrowSquareOut :size="30" /><strong>打开原生 ComfyUI</strong><span>保留熟悉的节点操作与兼容性</span></div><button class="design-button primary" @click="finish('编辑器入口已预览，未连接真实引擎')">预览打开编辑器</button></template>
        <template v-else><p class="dialog-note">{{ message||'素材选择与此操作将在正式应用中执行，当前只展示交互和界面样式。' }}</p><button class="design-button primary" @click="dialog=''">完成</button></template>
      </section>
    </div>
    <div v-if="toast" class="design-toast" role="status"><PhCheckCircle :size="20" />{{ toast }}</div>
  </div>
</template>
