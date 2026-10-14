<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import {
  PhArrowRight, PhCheckCircle, PhCpu, PhDownloadSimple, PhFolder,
  PhPlug, PhShieldCheck, PhWarningCircle, PhPlay, PhStop,
  PhFileText, PhSlidersHorizontal,
} from '@phosphor-icons/vue'

defineProps<{ page: string }>()
const emit = defineEmits<{ action: [name: string, payload?: string] }>()
const plan = ref('h3')
const installDirectory = ref('D:/AI/luckyx-environment')
const existingDirectory = ref('D:/AI/ComfyUI')
const serverAddress = ref('http://127.0.0.1:8188')
const settingsTab = ref('general')
const outputDirectory = ref('D:/AI/outputs')
const modelDirectory = ref('D:/AI/models')
const motion = ref('auto')
const transparency = ref('auto')
const contrast = ref('auto')
const stats = computed(() => plan.value === 'h3'
  ? { download: '41.0 GiB', space: '53.5 GiB', label: 'ComfyUI + MiniMax H3' }
  : { download: '1.9 GiB', space: '14.3 GiB', label: 'ComfyUI 基础环境' })
const settingsTabs = [
  { id: 'general', name: '常规' }, { id: 'environment', name: '运行环境' },
  { id: 'diagnostics', name: '诊断' },
]
function applyPreferences() {
  emit('action', 'preferences', JSON.stringify({ motion: motion.value, transparency: transparency.value, contrast: contrast.value }))
}
function navigateSettingsTabs(event: KeyboardEvent) {
  const current = settingsTabs.findIndex(tab => tab.id === settingsTab.value)
  const next = event.key === 'ArrowRight' ? (current + 1) % settingsTabs.length
    : event.key === 'ArrowLeft' ? (current + settingsTabs.length - 1) % settingsTabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? settingsTabs.length - 1 : null
  if (next === null) return
  event.preventDefault()
  const tablist = (event.currentTarget as HTMLElement).parentElement
  settingsTab.value = settingsTabs[next].id
  void nextTick(() => tablist?.querySelector<HTMLButtonElement>(`#settings-tab-${settingsTabs[next].id}`)?.focus())
}
</script>

<template>
  <div class="environment-pages">
    <template v-if="page === 'setup'">
      <header class="page-heading">
        <span class="eyebrow">安装与连接</span>
        <h1>准备好你的创作环境。</h1>
        <p>第一次使用，从安装开始。已有 ComfyUI，直接连接即可。</p>
      </header>

      <div class="setup-grid">
        <section class="card install-card" aria-labelledby="install-title">
          <div class="section-top">
            <span class="icon-tile"><PhDownloadSimple :size="23" /></span>
            <div><h2 id="install-title">从零开始</h2><p class="secondary">环境、依赖与模型，按步骤准备。</p></div>
            <span class="small-badge">推荐</span>
          </div>
          <fieldset class="plan-field">
            <legend>选择安装内容</legend>
            <label class="plan-option" :class="{ selected: plan === 'h3' }">
              <input v-model="plan" type="radio" value="h3" name="install-plan" />
              <span class="plan-copy"><strong>ComfyUI + MiniMax H3</strong><span>准备图生视频、文生视频与音画同步模型。</span></span>
              <PhCheckCircle v-if="plan === 'h3'" :size="21" weight="fill" class="plan-check" />
            </label>
            <label class="plan-option" :class="{ selected: plan === 'base' }">
              <input v-model="plan" type="radio" value="base" name="install-plan" />
              <span class="plan-copy"><strong>只安装 ComfyUI</strong><span>先准备基础环境，之后再选择模型。</span></span>
              <PhCheckCircle v-if="plan === 'base'" :size="21" weight="fill" class="plan-check" />
            </label>
          </fieldset>
          <label class="field-label" for="installation-directory">安装目录</label>
          <div class="path-field"><PhFolder :size="18" /><input id="installation-directory" v-model="installDirectory" spellcheck="false" aria-label="安装目录" /></div>
          <div class="plan-stats" aria-live="polite">
            <div><span>预计下载</span><strong>{{ stats.download }}</strong></div>
            <div><span>建议可用空间</span><strong>{{ stats.space }}</strong></div>
            <div class="stat-note"><PhShieldCheck :size="20" /><span>先检查，再安装<br /><small>保留已有模型与文件</small></span></div>
          </div>
          <ol class="steps" aria-label="安装步骤">
            <li><span>1</span><div><strong>检查环境</strong><small>目录、网络与可用空间</small></div></li>
            <li><span>2</span><div><strong>下载所需文件</strong><small>进度可查看，支持暂停</small></div></li>
            <li><span>3</span><div><strong>校验并配置</strong><small>完成后连接节点编辑器</small></div></li>
          </ol>
          <div class="card-actions">
            <button class="button button-secondary" @click="emit('action', 'install-check', stats.label)"><PhShieldCheck :size="18" />检查安装条件</button>
            <button class="button button-primary" @click="emit('action', 'install-preview', stats.label)">一键安装并配置<PhArrowRight :size="18" /></button>
          </div>
          <p class="preview-note">设计预览：仅展示安装流程，不会下载文件或修改你的环境。</p>
        </section>

        <aside class="setup-aside">
          <section class="card connection-card" aria-labelledby="connection-title">
            <span class="icon-tile neutral"><PhPlug :size="23" /></span>
            <h2 id="connection-title">已有 ComfyUI？</h2>
            <p class="secondary">保留你的节点和模型，连接现有环境。</p>
            <label class="field-label" for="existing-directory">ComfyUI 目录</label>
            <div class="path-field"><PhFolder :size="17" /><input id="existing-directory" v-model="existingDirectory" spellcheck="false" /></div>
            <label class="field-label" for="connection-address">服务地址</label>
            <input id="connection-address" v-model="serverAddress" class="text-input" spellcheck="false" inputmode="url" />
            <p class="field-help">连接后可检查模型和节点。地址应指向已启动的 ComfyUI 服务。</p>
            <button class="button button-dark full-width" @click="emit('action', 'connect', serverAddress)">保存并检查<PhArrowRight :size="18" /></button>
          </section>
          <section class="device-note">
            <PhCpu :size="20" />
            <div><strong>设备信息示例</strong><p>RTX 4080 · 16 GB 显存<br />32 GB 内存 · Windows 11</p><small>用于定稿展示，未检测当前电脑。</small></div>
          </section>
          <p class="aside-note">下载大小为演示估算，正式安装前会重新检查空间和文件清单。</p>
        </aside>
      </div>
    </template>

    <template v-else>
      <header class="page-heading settings-heading">
        <span class="eyebrow">设置与诊断</span>
        <h1>按你的习惯，调整 Studio。</h1>
        <p>从界面偏好到运行环境，让每一次创作更顺手。</p>
      </header>
      <div class="settings-tabs" role="tablist" aria-label="设置分类">
        <button v-for="tab in settingsTabs" :id="`settings-tab-${tab.id}`" :key="tab.id" role="tab" :aria-selected="settingsTab === tab.id" :aria-controls="`settings-panel-${tab.id}`" :tabindex="settingsTab === tab.id ? 0 : -1" :class="{ active: settingsTab === tab.id }" @click="settingsTab = tab.id" @keydown="navigateSettingsTabs">{{ tab.name }}</button>
      </div>

      <div v-if="settingsTab === 'general'" id="settings-panel-general" class="settings-grid" role="tabpanel" aria-labelledby="settings-tab-general">
        <section class="card preferences-card">
          <div class="section-top"><span class="icon-tile neutral"><PhSlidersHorizontal :size="23" /></span><div><h2>界面偏好</h2><p class="secondary">舒适、清晰，保持操作的直接感。</p></div></div>
          <div class="preference-row"><label for="motion-preference"><strong>动态效果</strong><span>减少动态时保留必要的状态反馈。</span></label><select id="motion-preference" v-model="motion" @change="applyPreferences"><option value="auto">跟随系统</option><option value="reduce">减少动态</option></select></div>
          <div class="preference-row"><label for="transparency-preference"><strong>透明效果</strong><span>使用实色背景，让内容更容易看清。</span></label><select id="transparency-preference" v-model="transparency" @change="applyPreferences"><option value="auto">跟随系统</option><option value="solid">使用实色</option></select></div>
          <div class="preference-row"><label for="contrast-preference"><strong>对比度</strong><span>增强文字、边界与交互状态的区分。</span></label><select id="contrast-preference" v-model="contrast" @change="applyPreferences"><option value="auto">跟随系统</option><option value="more">增强对比度</option></select></div>
          <p class="inline-note"><PhCheckCircle :size="17" />偏好可即时预览，仅在这份定稿中生效。</p>
        </section>
        <section class="card paths-card">
          <div class="section-top"><span class="icon-tile neutral"><PhFolder :size="23" /></span><div><h2>文件与目录</h2><p class="secondary">作品和模型，都有各自的位置。</p></div></div>
          <label class="field-label" for="output-directory">作品保存目录</label>
          <div class="path-field"><PhFolder :size="18" /><input id="output-directory" v-model="outputDirectory" spellcheck="false" /></div>
          <p class="field-help">生成结果保存到这里，历史记录与文件分开管理。</p>
          <label class="field-label" for="model-directory">模型目录</label>
          <div class="path-field"><PhFolder :size="18" /><input id="model-directory" v-model="modelDirectory" spellcheck="false" /></div>
          <p class="field-help">连接已有模型，减少重复下载。</p>
          <div class="path-save"><button class="button button-primary" @click="emit('action', 'save-settings')">保存设置<PhCheckCircle :size="18" /></button></div>
        </section>
        <section class="settings-footer"><div><strong>luckyx. Studio</strong><span>银灰画廊 · 界面定稿</span></div><p>这是一份可交互的设计预览，设置不会写入正式应用。</p></section>
      </div>

      <div v-else-if="settingsTab === 'environment'" id="settings-panel-environment" class="settings-grid" role="tabpanel" aria-labelledby="settings-tab-environment">
        <section class="card runtime-card">
          <div class="section-top"><span class="icon-tile"><PhPlug :size="23" /></span><div><h2>ComfyUI 连接</h2><p class="secondary">创作任务通过当前环境执行。</p></div><span class="status-badge"><span></span>连接状态示例</span></div>
          <dl class="details"><div><dt>服务地址</dt><dd>http://127.0.0.1:8188</dd></div><div><dt>环境目录</dt><dd>D:/AI/ComfyUI</dd></div><div><dt>启动方式</dt><dd>连接已有环境</dd></div><div><dt>模型路径</dt><dd>D:/AI/models</dd></div></dl>
          <div class="card-actions"><button class="button button-dark" @click="emit('action', 'engine-preview', 'start')"><PhPlay :size="18" />启动引擎</button><button class="button button-secondary" @click="emit('action', 'engine-preview', 'stop')"><PhStop :size="18" />停止引擎</button></div>
          <p class="preview-note">仅展示交互反馈，不会启动或停止真实服务。</p>
        </section>
        <section class="card runtime-help"><h2>环境由你掌控。</h2><p class="secondary">已有的模型、节点与工作流保留在原目录。更新 Studio 时，不需要重复安装创作环境。</p><div class="help-block"><PhShieldCheck :size="24" /><strong>应用与创作数据分开管理</strong><p>卸载时可选择是否清除应用数据，模型与作品文件单独保留。</p></div><button class="button button-secondary" @click="emit('action', 'diagnostics')">检查环境<PhArrowRight :size="18" /></button></section>
      </div>

      <div v-else id="settings-panel-diagnostics" class="diagnostics-layout" role="tabpanel" aria-labelledby="settings-tab-diagnostics">
        <section class="card diagnosis-card">
          <div class="section-top"><span class="icon-tile"><PhShieldCheck :size="23" /></span><div><h2>创作前，检查一下。</h2><p class="secondary">定位环境、节点与模型问题。</p></div><button class="button button-dark" @click="emit('action', 'diagnostics')">重新检查<PhArrowRight :size="18" /></button></div>
          <p class="diagnosis-label">以下为诊断结果示例，未对当前设备执行检查。</p>
          <div class="diagnostic-row"><PhCheckCircle :size="23" weight="fill" class="success" /><div><strong>ComfyUI 服务</strong><p>本地服务地址与连接状态正常。</p></div><span class="result success">通过</span></div>
          <div class="diagnostic-row"><PhCheckCircle :size="23" weight="fill" class="success" /><div><strong>模型目录</strong><p>可读取已配置的模型路径。</p></div><span class="result success">通过</span></div>
          <div class="diagnostic-row"><PhWarningCircle :size="23" weight="fill" class="warning" /><div><strong>自定义节点</strong><p>当前工作流缺少 1 个视频处理节点。</p></div><button class="text-action" @click="emit('action', 'diagnostic-help', 'nodes')">查看解决方法<PhArrowRight :size="15" /></button></div>
          <div class="diagnostic-row"><PhWarningCircle :size="23" weight="fill" class="warning" /><div><strong>控制模型权重</strong><p>视频改造工作流所需权重尚未找到。</p></div><button class="text-action" @click="emit('action', 'diagnostic-help', 'weights')">查看解决方法<PhArrowRight :size="15" /></button></div>
        </section>
        <section class="card logs-card"><div class="log-heading"><div><PhFileText :size="21" /><h2>检查日志</h2><span class="log-badge">示例</span></div><button class="text-action" @click="emit('action', 'copy-logs')">复制日志</button></div><pre>[INFO] ComfyUI connection ready
[INFO] Model directory is accessible
[WARN] Workflow node dependency missing
[WARN] Control model weight not found
[INFO] Check complete · 2 items need attention</pre><p class="field-help">日志用于定位问题，正式应用中可复制后提交反馈。</p></section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.environment-pages{--ink:#1d2327;--muted:#657079;--line:#dfe3e5;--mint:#57d8b3;color:var(--ink);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;padding:12px 0 32px;min-width:0}
.page-heading{margin:0 0 32px}.eyebrow{font-size:13px;font-weight:600;color:var(--muted)}h1{font-size:clamp(28px,2.7vw,36px);font-weight:600;line-height:1.3;letter-spacing:-1.1px;margin:9px 0 12px}h2{font-size:20px;font-weight:600;line-height:1.35;letter-spacing:-.45px;margin:0}p{margin:0}.page-heading>p{font-size:15px;color:var(--muted)}
.setup-grid{display:grid;grid-template-columns:minmax(0,1.72fr) minmax(290px,1fr);gap:24px;align-items:start}.card{background:white;border:1px solid var(--line);border-radius:22px;padding:28px;min-width:0;box-shadow:0 4px 20px #1d232703}.section-top{display:flex;align-items:center;gap:14px;margin-bottom:25px}.section-top>div{min-width:0}.section-top .small-badge{margin-left:auto}.icon-tile{flex:none;width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:#def7ef;color:#176f55}.icon-tile.neutral{background:#f0f2f4;color:#48545e}.secondary{color:var(--muted);font-size:13px;margin-top:5px}.small-badge{padding:5px 10px;border-radius:7px;background:#e3f8f0;color:#176f55;font-size:12px;white-space:nowrap;font-weight:600}
.plan-field{padding:0;border:0;margin:0 0 22px;min-width:0}.plan-field legend,.field-label{font-size:13px;font-weight:600;display:block;margin:0 0 10px}.plan-option{display:flex;align-items:center;gap:12px;cursor:pointer;border:1px solid var(--line);border-radius:14px;padding:16px;margin-top:10px;min-height:81px;background:#fafbfc}.plan-option.selected{border-color:#329c7b;background:#f2fcf8;box-shadow:inset 0 0 0 1px #329c7b}.plan-option input{width:17px;height:17px;accent-color:#218365;flex:none}.plan-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:4px}.plan-copy strong{font-size:14px;font-weight:600}.plan-copy>span{font-size:12px;color:var(--muted)}.plan-check{color:#218365;flex:none}.path-field{display:flex;align-items:center;gap:9px;border:1px solid #d4dadd;background:#fbfcfd;border-radius:10px;padding:0 12px;min-height:44px;color:var(--muted)}.path-field input{flex:1;min-width:0;border:0;outline:0;padding:10px 0;background:transparent;font-size:13px;color:var(--ink)}.path-field:focus-within{outline:3px solid #57d8b333;border-color:#228568}.text-input,select{border:1px solid #d4dadd;min-height:44px;border-radius:10px;background:#fbfcfd;font:inherit;font-size:13px;color:var(--ink);padding:9px 12px;width:100%;box-sizing:border-box}.plan-stats{display:grid;grid-template-columns:1fr 1fr 1.15fr;gap:16px;margin:23px 0 26px;padding-bottom:24px;border-bottom:1px solid #edf0f2}.plan-stats>div>span{display:block;font-size:12px;color:var(--muted)}.plan-stats strong{font-size:23px;letter-spacing:-.6px;font-weight:600;line-height:1.4;display:block;margin-top:3px;white-space:nowrap}.stat-note{display:flex;align-items:center;gap:9px}.stat-note>svg{color:#2a8568;flex:none}.stat-note>span{line-height:1.6!important;color:var(--ink)!important}.stat-note small{color:var(--muted);font-size:12px}.steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));list-style:none;margin:0 0 26px;padding:0;gap:15px}.steps li{display:flex;gap:9px;align-items:flex-start;min-width:0}.steps li>span{display:grid;place-items:center;background:#f0f2f4;border-radius:50%;width:24px;height:24px;flex:none;font-size:12px;font-weight:600}.steps strong{font-size:12px;font-weight:600;display:block}.steps small{display:block;color:var(--muted);font-size:12px;line-height:1.5;margin-top:3px}.card-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.button{min-height:44px;padding:10px 18px;display:inline-flex;align-items:center;justify-content:center;gap:9px;border:1px solid transparent;border-radius:11px;font:inherit;font-size:13px;font-weight:600;line-height:1.5;cursor:pointer;touch-action:manipulation}.button svg{flex:none}.button-primary{background:#57d8b3;color:#102b22}.button-secondary{border-color:#d7dee1;background:#fff;color:#36444c}.button-dark{color:white;background:#232b30}.button:active{transform:scale(.985)}.button:focus-visible,select:focus-visible,input:focus-visible,.text-action:focus-visible,.settings-tabs button:focus-visible{outline:3px solid #218365;outline-offset:3px}.preview-note{color:var(--muted);font-size:12px;margin-top:15px;line-height:1.55}.connection-card>.icon-tile{margin-bottom:19px}.connection-card .secondary{margin-top:8px;margin-bottom:25px;line-height:1.65}.connection-card .field-label{margin-top:20px}.field-help{font-size:12px;color:var(--muted);margin-top:9px;line-height:1.7}.full-width{width:100%;margin-top:21px}.device-note{display:flex;align-items:flex-start;gap:12px;padding:23px 9px 13px;color:#53616a}.device-note svg{flex:none;margin-top:3px}.device-note strong{font-size:13px;font-weight:600;color:var(--ink)}.device-note p{font-size:13px;line-height:1.8;margin:6px 0}.device-note small,.aside-note{font-size:12px;color:var(--muted)}.aside-note{padding:0 9px;line-height:1.75}
.settings-heading{margin-bottom:25px}.settings-tabs{display:inline-flex;padding:4px;background:#e9edf0;border-radius:12px;gap:3px;margin-bottom:25px}.settings-tabs button{border:0;color:#58656e;background:transparent;border-radius:9px;font:inherit;font-size:13px;font-weight:600;min-width:105px;min-height:40px;padding:8px 18px;cursor:pointer}.settings-tabs button.active{background:white;color:var(--ink);box-shadow:0 1px 4px #24323c12}.settings-grid{display:grid;grid-template-columns:1.13fr 1fr;gap:24px;align-items:start}.preference-row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:20px 0;border-top:1px solid #edf0f2}.preference-row label{flex:1;min-width:0}.preference-row strong{display:block;font-size:14px;font-weight:600}.preference-row label span{display:block;font-size:12px;color:var(--muted);line-height:1.65;margin-top:4px}.preference-row select{width:138px;flex:none}.inline-note{display:flex;gap:7px;align-items:center;border-top:1px solid #edf0f2;padding-top:18px;color:#5b6e65;font-size:12px}.inline-note svg{color:#2a8568;flex:none}.paths-card .field-label{margin-top:25px}.path-save{display:flex;justify-content:flex-end;margin-top:25px}.settings-footer{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:9px 4px;color:var(--muted)}.settings-footer>div{display:flex;gap:13px;align-items:center;flex-wrap:wrap}.settings-footer strong{font-size:14px;color:#454f56;font-weight:600}.settings-footer span,.settings-footer p{font-size:12px}.runtime-card .section-top{flex-wrap:wrap}.status-badge{font-size:12px;background:#edf8f2;color:#247451;border-radius:8px;padding:6px 9px;display:flex;gap:6px;align-items:center;margin-left:auto}.status-badge>span{width:6px;height:6px;border-radius:50%;background:#2a9e6b}.details{margin:0 0 27px}.details>div{display:flex;justify-content:space-between;gap:20px;border-top:1px solid #edf0f2;padding:16px 0;font-size:13px}.details dt{color:var(--muted);flex:none}.details dd{margin:0;text-align:right;overflow-wrap:anywhere}.runtime-help>.secondary{font-size:14px;line-height:1.8;margin-top:14px}.help-block{padding:24px;background:#f5f7f8;border:1px solid #e8edef;border-radius:14px;margin:24px 0}.help-block>svg{display:block;color:#2a8568;margin-bottom:12px}.help-block strong{font-size:14px;font-weight:600}.help-block p{font-size:13px;color:var(--muted);line-height:1.8;margin-top:7px}.diagnostics-layout{display:grid;gap:22px}.diagnosis-card>.section-top{margin-bottom:18px}.diagnosis-card>.section-top>.button{margin-left:auto}.diagnosis-label{color:var(--muted);font-size:12px;background:#f5f7f8;border-radius:9px;padding:10px 13px;margin-bottom:7px}.diagnostic-row{display:flex;align-items:center;gap:14px;border-bottom:1px solid #edf0f2;padding:18px 4px;min-width:0}.diagnostic-row:last-child{border:0;padding-bottom:4px}.diagnostic-row>svg{flex:none}.diagnostic-row>div{flex:1;min-width:0}.diagnostic-row strong{font-size:14px;font-weight:600}.diagnostic-row p{font-size:12px;color:var(--muted);margin-top:4px}.success{color:#287b5e}.warning{color:#a36b22}.result{font-size:12px;font-weight:600;margin-left:auto;padding-right:6px;white-space:nowrap}.text-action{display:inline-flex;align-items:center;gap:6px;background:none;border:0;color:#246d58;font:inherit;font-size:12px;font-weight:600;line-height:1.6;padding:8px 0;cursor:pointer;min-height:32px;text-align:left}.log-heading{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:17px}.log-heading>div{display:flex;gap:10px;align-items:center}.log-heading h2{font-size:17px}.log-badge{font-size:12px;color:#657079;background:#f0f2f4;padding:3px 8px;border-radius:6px}.logs-card pre{font:12px/1.9 Consolas,"SFMono-Regular",monospace;color:#53606a;background:#f6f8f9;border:1px solid #e8edef;border-radius:12px;padding:17px;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
@media(hover:hover) and (pointer:fine){.button-primary:hover{background:#49cca5}.button-secondary:hover{background:#f4f7f8}.button-dark:hover{background:#35434b}.text-action:hover{text-decoration:underline;text-underline-offset:3px}}
@media(max-width:1100px){.card{padding:23px}.setup-grid{grid-template-columns:minmax(0,1.65fr) minmax(285px,1fr);gap:20px}.plan-stats{gap:10px}.stat-note{display:none}.plan-stats{grid-template-columns:1fr 1fr}.steps{gap:8px}.steps li{gap:6px}.settings-grid{gap:20px}.preference-row{gap:12px}.preference-row select{width:125px}.settings-footer{align-items:flex-start}.settings-footer p{max-width:250px;text-align:right}}
@media(max-width:800px){.setup-grid,.settings-grid{grid-template-columns:1fr}.setup-aside{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}.connection-card{grid-row:1/3}.device-note{padding:20px 2px 0}.aside-note{padding:0 2px}.stat-note{display:flex}.plan-stats{grid-template-columns:1fr 1fr 1.2fr}.settings-footer{grid-column:auto;flex-wrap:wrap}.settings-footer p{max-width:none;text-align:left}.diagnosis-card>.section-top{flex-wrap:wrap}.diagnosis-card>.section-top>.button{margin-left:0}.page-heading{margin-bottom:25px}}
@media(max-width:540px){.environment-pages{padding-top:0}.page-heading>p{font-size:14px}h1{font-size:28px;letter-spacing:-.75px}.card{padding:21px 19px;border-radius:18px}.setup-aside{display:flex;flex-direction:column;gap:5px}.connection-card{width:100%;box-sizing:border-box}.device-note{padding:20px 5px 4px}.aside-note{padding:0 5px}.section-top{gap:11px}.section-top h2{font-size:19px}.icon-tile{width:40px;height:40px;border-radius:12px}.section-top .secondary{font-size:12px}.plan-option{padding:14px 11px;gap:9px}.plan-copy strong{font-size:13px}.plan-stats{grid-template-columns:1fr 1fr;gap:12px}.stat-note{display:none}.plan-stats strong{font-size:22px}.steps{grid-template-columns:1fr;gap:15px}.steps li{gap:10px}.steps strong{font-size:13px}.steps small{font-size:12px}.card-actions{gap:9px}.card-actions>.button{width:100%}.button{padding-inline:13px}.settings-tabs{display:flex}.settings-tabs button{min-width:0;flex:1;padding:8px 12px}.preference-row{align-items:flex-start;flex-direction:column;gap:11px;padding:18px 0}.preference-row select{width:100%}.settings-footer{padding-inline:3px}.diagnostic-row{flex-wrap:wrap;column-gap:10px;row-gap:6px}.diagnostic-row>div{flex-basis:calc(100% - 35px)}.diagnostic-row .text-action,.diagnostic-row .result{margin-left:33px}.diagnostic-row .text-action{min-height:36px}.diagnostic-row .result{margin-top:2px}.log-heading{align-items:flex-start;flex-wrap:wrap;gap:6px}.logs-card pre{padding:12px;font-size:12px}.details>div{font-size:12px;gap:14px}.inline-note{align-items:flex-start}.status-badge{margin-left:54px}.runtime-help>.secondary{font-size:13px}.help-block{padding:18px}}
@media(prefers-reduced-motion:reduce){.button:active{transform:none}}
</style>

