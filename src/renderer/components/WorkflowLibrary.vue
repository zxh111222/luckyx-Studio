<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PhPlus, PhUploadSimple, PhArrowSquareOut, PhDownloadSimple, PhPencilSimple, PhTrash, PhFloppyDisk, PhCube } from '@phosphor-icons/vue'
import type { Snapshot, UserWorkflow } from '../../shared/contracts'
import { desktop, invoke } from '../src/api'
const props = defineProps<{ snapshot: Snapshot; query: string; busy: boolean }>()
const emit = defineEmits<{ refresh: [] }>()
const pending = ref(false)
const error = ref('')
const message = ref('')
const importInput = ref<HTMLInputElement | null>(null)
const replaceInput = ref<HTMLInputElement | null>(null)
const replacing = ref('')
const name = ref('')
const namingId = ref('')
const showName = ref(false)
const removing = ref('')
const items = computed(() => (props.snapshot.userWorkflows ?? []).filter(w => w.name.toLowerCase().includes(props.query.toLowerCase())))
const pageIndex = ref(1)
const pageCount = computed(() => Math.max(1, Math.ceil(items.value.length / 12)))
const visibleItems = computed(() => items.value.slice((pageIndex.value - 1) * 12, pageIndex.value * 12))
watch(() => props.query, () => { pageIndex.value = 1 })
watch(pageCount, count => { pageIndex.value = Math.min(pageIndex.value, count) })
const unavailable = computed(() => pending.value || props.busy)
const ready = computed(() => ['ready', 'busy'].includes(props.snapshot.engine.status))
async function act(action: () => Promise<unknown>, success: string) {
  if (unavailable.value) return
  pending.value = true; error.value = ''; message.value = ''
  try { await action(); emit('refresh'); message.value = success }
  catch (e) { error.value = e instanceof Error ? e.message : '操作未完成，请重试。' }
  finally { pending.value = false }
}
function startName(id = '') { namingId.value = id; name.value = props.snapshot.userWorkflows?.find(w => w.id === id)?.name ?? ''; showName.value = true }
async function saveName() {
  await act(async () => {
    await invoke(namingId.value ? 'workflow.rename' : 'workflow.create', namingId.value ? { id: namingId.value, name: name.value } : { name: name.value || '未命名工作流' })
    showName.value = false
  }, namingId.value ? '名称已保存。' : '空白工作流已创建，打开节点编辑器即可添加节点。')
}
async function importFile(event: Event, replace = false) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ''
  if (!file) return
  await act(async () => {
    if (!file.name.toLowerCase().endsWith('.json')) throw new Error('请选择 ComfyUI 工作流 JSON 文件。')
    if (file.size > 5 * 1024 * 1024) throw new Error('文件超过 5 MB，请精简工作流后重试。')
    const json = await file.text()
    await invoke(replace ? 'workflow.update' : 'workflow.import', replace ? { id: replacing.value, json } : { name: file.name.replace(/\.json$/i, ''), json })
  }, replace ? '工作流内容已更新，原文件保持不变。' : '工作流已导入。运行前请在节点编辑器中检查模型与节点。')
}
async function exportFile(item: UserWorkflow) {
  await act(async () => {
    if (desktop) { const result = await invoke('native.exportWorkflow', { id: item.id }); if (result === false) return }
    else {
      const result = await invoke<{ json: string }>('workflow.get', { id: item.id })
      const url = URL.createObjectURL(new Blob([result.json], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = `${item.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.json`; link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }, 'JSON 导出已完成或发起。')
}
async function edit(item: UserWorkflow) {
  await act(() => invoke(desktop ? 'native.editWorkflow' : 'native.openEngine', { id: item.id }), desktop ? '节点编辑器已打开。编辑后回到这里点击“保存编辑结果”。' : '已打开原生编辑器。请先导出 JSON，再拖入编辑器；编辑完成后导出，并点击“更新 JSON”。')
}
function replace(item: UserWorkflow) { replacing.value = item.id; replaceInput.value?.click() }
</script>

<template>
  <section class="personal-workflows" aria-label="我的工作流">
    <div class="personal-heading"><div><h2>我的工作流 <span class="workflow-count">{{ items.length.toLocaleString('zh-CN') }}</span></h2><p class="muted">在 ComfyUI 节点编辑器里，自由连接与调整。</p></div><div class="actions wrap"><button class="btn secondary" :disabled="unavailable" @click="importInput?.click()"><PhUploadSimple :size="18" />导入 JSON</button><button class="btn primary" :disabled="unavailable" @click="startName()"><PhPlus :size="18" />新建工作流</button></div></div>
    <input ref="importInput" type="file" accept=".json,application/json" hidden aria-label="选择工作流 JSON" @change="importFile($event)" />
    <input ref="replaceInput" type="file" accept=".json,application/json" hidden aria-label="选择更新的工作流 JSON" @change="importFile($event, true)" />
    <p v-if="error" class="error workflow-feedback" role="alert">{{ error }}</p><p v-if="message" class="good workflow-feedback" role="status">{{ message }}</p>
    <div v-if="showName" class="panel workflow-name"><label for="workflow-name">{{ namingId ? '修改名称' : '新工作流名称' }}</label><input id="workflow-name" v-model="name" class="input" maxlength="80" placeholder="例如：我的图生视频" @keydown.enter="saveName" /><button class="btn primary" :disabled="unavailable" @click="saveName">保存</button><button class="btn secondary" :disabled="unavailable" @click="showName = false">取消</button></div>
    <div v-if="!items.length" class="panel personal-empty"><PhPlus :size="28" /><h3>{{ query ? '没有匹配的个人工作流' : '把你的第一条工作流放在这里' }}</h3><p class="muted">支持 ComfyUI 节点 JSON 与 API JSON，单个文件最大 5 MB。</p></div>
    <div class="personal-grid"><article v-for="item in visibleItems" :key="item.id" class="panel personal-card"><div class="workflow-symbol"><PhCube :size="25" /></div><div class="workflow-copy"><div class="personal-card-title"><h3 :title="item.name">{{ item.name }}</h3><span class="badge">{{ item.format === 'ui' ? '节点工作流' : 'API 工作流' }}</span></div><p class="workflow-note">{{ item.nodeCount ? '待原生编辑器检查模型与节点' : '空白画布 · 可以开始添加节点' }}</p><p class="muted workflow-meta">{{ item.nodeCount }} 个节点 · {{ new Date(item.updatedAt).toLocaleDateString('zh-CN') }}</p></div><div class="workflow-controls"><div class="actions wrap"><button class="btn secondary editor-action" :disabled="unavailable || !ready" @click="edit(item)">打开节点编辑器<PhArrowSquareOut :size="17" /></button><button v-if="desktop" class="btn secondary icon-action" :aria-label="`保存 ${item.name} 编辑结果`" title="保存编辑结果" :disabled="unavailable || !ready" @click="act(() => invoke('native.saveWorkflow', { id: item.id }), '编辑结果已保存到工作流库。')"><PhFloppyDisk :size="19" /></button><button class="btn secondary icon-action" :aria-label="`导出 ${item.name} JSON`" title="导出 JSON" :disabled="unavailable" @click="exportFile(item)"><PhDownloadSimple :size="19" /></button></div><div class="personal-tools"><button class="text-action" :disabled="unavailable" @click="replace(item)">更新 JSON</button><button class="text-action" :disabled="unavailable" @click="startName(item.id)"><PhPencilSimple :size="16" />改名</button><button class="text-action remove-action" :disabled="unavailable" @click="removing = item.id"><PhTrash :size="16" />移除</button></div></div><div v-if="removing === item.id" class="remove-confirm"><p>只移除库中的副本，原 JSON 文件会保留。</p><button class="btn secondary" :disabled="unavailable" @click="act(async () => { await invoke('workflow.remove', { id: item.id }); removing = '' }, '已移除库中的副本。')">确认移除</button><button class="btn secondary" @click="removing = ''">取消</button></div></article></div>
    <nav v-if="items.length > 12" class="pagination" aria-label="个人工作流分页"><span class="muted">共 {{ items.length.toLocaleString('zh-CN') }} 个工作流 · {{ pageIndex }} / {{ pageCount }}</span><button class="btn secondary" :disabled="pageIndex === 1" @click="pageIndex--">上一页</button><button class="btn secondary" :disabled="pageIndex === pageCount" @click="pageIndex++">下一页</button></nav>
    <p class="muted personal-hint">{{ ready ? '节点编辑器由 ComfyUI 提供。个人工作流在编辑器中运行，暂不套用精选模板的创作表单。' : '请先启动或连接 ComfyUI，再打开节点编辑器。导入和管理无需启动引擎。' }}</p>
  </section>
</template>


<style scoped>
.personal-workflows{margin:36px 0 28px;min-width:0}.personal-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:20px}.personal-heading h2{font-size:21px;font-weight:600;letter-spacing:-.4px;margin:0 0 7px}.personal-heading p{margin:0;font-size:13px;line-height:1.8}.workflow-count{display:inline-flex;align-items:center;justify-content:center;min-width:25px;padding:1px 6px;font-size:12px;background:var(--control);color:var(--muted);border-radius:7px;margin-left:7px;vertical-align:2px;letter-spacing:0}
.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.text-action{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;color:var(--accent);font:inherit;font-size:12px;cursor:pointer;padding:0;min-height:32px}.text-action:disabled{opacity:.45;cursor:default}
.personal-grid{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:18px;overflow:hidden;background:var(--surface)}.personal-grid:empty{display:none}.personal-card{display:grid;grid-template-columns:52px minmax(0,1fr) auto;align-items:center;gap:20px;padding:23px 24px;min-width:0;background:transparent;border:0;border-radius:0}.personal-card+.personal-card{border-top:1px solid var(--border)}.workflow-symbol{display:grid;place-items:center;width:52px;height:52px;color:var(--accent);background:var(--accent-soft,#eff7f4);border-radius:14px}.workflow-copy{min-width:0}.personal-card-title{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px}.personal-card h3{margin:0;min-width:0;overflow-wrap:anywhere;font-size:17px;font-weight:600;line-height:1.5}.personal-card .badge{flex-shrink:0;white-space:nowrap;font-size:12px}.workflow-note{font-size:13px;line-height:1.7;color:var(--muted);margin:6px 0}.workflow-meta{font-size:12px;line-height:1.8;margin:0}.workflow-controls{min-width:0}.workflow-controls .actions{justify-content:flex-end}.icon-action{width:44px;min-width:44px;padding:0}.editor-action{font-size:13px}.personal-tools{display:flex;justify-content:flex-end;gap:18px;margin-top:8px;flex-wrap:wrap}.personal-tools button{min-height:32px}.remove-action{color:var(--muted)}
.personal-empty{padding:36px 24px;text-align:center;color:var(--muted);border:1px dashed var(--border);border-radius:18px;background:var(--surface)}.personal-empty>svg{color:var(--accent)}.personal-empty h3{color:var(--text);margin:14px 0 10px;font-size:18px;font-weight:600}.personal-empty p,.personal-hint{font-size:13px;line-height:1.8}.personal-hint{margin:18px 0 0;color:var(--muted)}
.workflow-name{display:flex;align-items:center;gap:12px;padding:22px;margin-bottom:18px;flex-wrap:wrap;background:var(--surface);border:1px solid var(--border);border-radius:16px}.workflow-name label{font-size:13px}.workflow-name .input{flex:1;min-width:180px}.workflow-feedback{font-size:14px;line-height:1.8;overflow-wrap:anywhere}.remove-confirm{grid-column:2/-1;border-top:1px solid var(--border);margin-top:2px;padding-top:14px}.remove-confirm p{font-size:13px;line-height:1.8;color:var(--muted);margin:0 0 12px}.remove-confirm .btn{margin-right:10px;margin-bottom:6px}
.pagination{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:10px;padding-top:20px}.pagination>span{font-size:12px;line-height:1.7;margin-right:auto}
@media(hover:hover) and (pointer:fine){.text-action:hover{color:var(--text)}}
@media(max-width:1000px){.personal-card{grid-template-columns:48px minmax(0,1fr);gap:14px 18px}.workflow-symbol{width:48px;height:48px}.workflow-controls{grid-column:2/-1}.workflow-controls .actions,.personal-tools{justify-content:flex-start}}
@media(max-width:700px){.personal-heading{align-items:flex-start;flex-direction:column;gap:16px}.personal-card{padding:20px}.personal-card h3{font-size:16px}.personal-card-title{align-items:flex-start;flex-direction:column}.workflow-note{font-size:12px}.personal-tools{gap:14px}.personal-heading>.actions{width:100%}.personal-heading>.actions>.btn{flex:1}.personal-grid{border-radius:16px}}
@media(max-width:480px){.personal-card{grid-template-columns:42px minmax(0,1fr);gap:12px;padding:18px}.workflow-symbol{width:42px;height:42px;border-radius:12px}.workflow-controls{grid-column:1/-1}.editor-action{flex:1}.remove-confirm{grid-column:1/-1}.workflow-name{padding:18px;gap:10px}.workflow-name label{width:100%}.workflow-name .input{min-width:0;flex-basis:100%}.workflow-name>.btn{flex:1}.personal-empty{padding:28px 18px}.personal-heading>.actions{flex-wrap:wrap}.personal-heading>.actions>.btn{font-size:13px;padding-inline:12px}}
</style>
