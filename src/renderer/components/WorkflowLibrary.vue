<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhPlus, PhUploadSimple, PhArrowSquareOut, PhDownloadSimple, PhPencilSimple, PhTrash, PhFloppyDisk } from '@phosphor-icons/vue'
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
    <div class="personal-heading"><div><h2>我的工作流</h2><p class="muted">导入现有流程，或从空白开始搭建。</p></div><div class="actions wrap"><button class="btn secondary" :disabled="unavailable" @click="importInput?.click()"><PhUploadSimple :size="18" />导入 JSON</button><button class="btn primary" :disabled="unavailable" @click="startName()"><PhPlus :size="18" />新建工作流</button></div></div>
    <input ref="importInput" type="file" accept=".json,application/json" hidden aria-label="选择工作流 JSON" @change="importFile($event)" />
    <input ref="replaceInput" type="file" accept=".json,application/json" hidden aria-label="选择更新的工作流 JSON" @change="importFile($event, true)" />
    <p v-if="error" class="error workflow-feedback" role="alert">{{ error }}</p><p v-if="message" class="good workflow-feedback" role="status">{{ message }}</p>
    <div v-if="showName" class="panel workflow-name"><label for="workflow-name">{{ namingId ? '修改名称' : '新工作流名称' }}</label><input id="workflow-name" v-model="name" class="input" maxlength="80" placeholder="例如：我的图生视频" @keydown.enter="saveName" /><button class="btn primary" :disabled="unavailable" @click="saveName">保存</button><button class="btn secondary" :disabled="unavailable" @click="showName = false">取消</button></div>
    <div v-if="!items.length" class="panel personal-empty"><PhPlus :size="28" /><h3>{{ query ? '没有匹配的个人工作流' : '把你的第一条工作流放在这里' }}</h3><p class="muted">支持 ComfyUI 节点 JSON 与 API JSON，单个文件最大 5 MB。</p></div>
    <div class="personal-grid"><article v-for="item in items" :key="item.id" class="panel personal-card"><div class="personal-card-title"><h3>{{ item.name }}</h3><span class="badge">{{ item.format === 'ui' ? '节点工作流' : 'API 工作流' }}</span></div><p class="muted">{{ item.nodeCount }} 个节点 · {{ new Date(item.updatedAt).toLocaleDateString('zh-CN') }}</p><p class="workflow-note">{{ item.nodeCount ? '待原生编辑器检查模型与节点' : '空白画布 · 可以开始添加节点' }}</p><div class="actions wrap"><button class="btn primary" :disabled="unavailable || !ready" @click="edit(item)"><PhArrowSquareOut :size="18" />打开节点编辑器</button><button v-if="desktop" class="btn secondary" :disabled="unavailable || !ready" @click="act(() => invoke('native.saveWorkflow', { id: item.id }), '编辑结果已保存到工作流库。')"><PhFloppyDisk :size="18" />保存编辑结果</button><button class="btn secondary" :disabled="unavailable" @click="exportFile(item)"><PhDownloadSimple :size="18" />导出 JSON</button></div><div class="personal-tools"><button class="text-action" :disabled="unavailable" @click="replace(item)">更新 JSON</button><button class="text-action" :disabled="unavailable" @click="startName(item.id)"><PhPencilSimple :size="16" />改名</button><button class="text-action remove-action" :disabled="unavailable" @click="removing = item.id"><PhTrash :size="16" />移除</button></div><div v-if="removing === item.id" class="remove-confirm"><p>只移除库中的副本，原 JSON 文件会保留。</p><button class="btn secondary" :disabled="unavailable" @click="act(async () => { await invoke('workflow.remove', { id: item.id }); removing = '' }, '已移除库中的副本。')">确认移除</button><button class="btn secondary" @click="removing = ''">取消</button></div></article></div>
    <p class="muted personal-hint">{{ ready ? '节点编辑器由 ComfyUI 提供。个人工作流在编辑器中运行，暂不套用精选模板的创作表单。' : '请先启动或连接 ComfyUI，再打开节点编辑器。导入和管理无需启动引擎。' }}</p>
  </section>
</template>

<style scoped>
.actions {display:flex;gap:10px;align-items:center;flex-wrap:wrap}.text-action {display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;color:var(--accent);font:inherit;font-size:13px;cursor:pointer;padding:0}.text-action:hover{color:var(--text)}.text-action:disabled{opacity:.45;cursor:default}
.personal-workflows { margin-bottom:32px; }.personal-heading { display:flex; align-items:center; justify-content:space-between; gap:20px; margin-bottom:20px; }.personal-heading h2 {font-size:22px;margin:0 0 8px}.personal-heading p{margin:0;font-size:14px}.personal-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.personal-card{padding:22px;min-width:0}.personal-card-title{display:flex;align-items:flex-start;gap:12px;justify-content:space-between}.personal-card h3{margin:0;overflow-wrap:anywhere}.personal-card .badge{flex-shrink:0}.personal-card p{font-size:14px;line-height:1.7}.workflow-note{color:var(--muted);margin:18px 0}.personal-tools{display:flex;gap:20px;margin-top:18px;flex-wrap:wrap}.personal-tools button{min-height:40px}.personal-empty{padding:30px;text-align:center;color:var(--muted)}.personal-empty h3{color:var(--text)}.personal-empty p,.personal-hint{font-size:14px;line-height:1.7}.personal-hint{margin-top:18px}.workflow-name{display:flex;align-items:center;gap:12px;padding:18px;margin-bottom:16px;flex-wrap:wrap}.workflow-name .input{flex:1;min-width:180px}.workflow-feedback{font-size:14px;line-height:1.7;overflow-wrap:anywhere}.remove-confirm{border-top:1px solid var(--border);margin-top:16px;padding-top:12px}.remove-confirm .btn{margin-right:10px}.remove-action{color:var(--muted)}@media(max-width:1280px){.personal-grid{grid-template-columns:1fr}}@media(max-width:900px){.personal-heading{align-items:flex-start;flex-direction:column}}
</style>
