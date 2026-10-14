<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { PhArrowLeft, PhCheckCircle, PhCube, PhInfo, PhPlay, PhUploadSimple } from '@phosphor-icons/vue'
import type { TaskRecord, UserWorkflow } from '../../shared/contracts'
import type { WorkflowParameterAnalysis, WorkflowParameterSlot } from '../../shared/workflow-parameters'
import { invoke } from '../src/api'

const props = defineProps<{ workflow: UserWorkflow; engineReady: boolean }>()
const emit = defineEmits<{ back: []; submitted: [task: TaskRecord] }>()
const result = ref<{ status: 'ready' | 'editor-only' | 'unsupported'; message: string; analysis?: WorkflowParameterAnalysis }>()
const values = reactive<Record<string, any>>({})
const mediaNames = reactive<Record<string, string>>({})
const busy = ref(false), error = ref('')
const editable = computed(() => result.value?.analysis?.slots.filter(slot => slot.editable) ?? [])
const dependencies = computed(() => result.value?.analysis?.slots.filter(slot => !slot.editable) ?? [])
const unsupportedMedia = computed(() => editable.value.some(slot => slot.kind === 'video' || slot.kind === 'audio'))
const canSubmit = computed(() => result.value?.status === 'ready' && props.engineReady && !busy.value && !unsupportedMedia.value && editable.value.filter(slot => slot.kind === 'image').every(slot => values[slot.id]))
const inputType = (slot: WorkflowParameterSlot) => slot.kind === 'prompt' ? 'textarea' : slot.valueType === 'boolean' ? 'checkbox' : ['integer', 'number'].includes(slot.valueType) ? 'number' : 'text'

async function load() {
  error.value = ''
  try {
    const analyzed = await invoke<typeof result.value>('workflow.analyze', { id: props.workflow.id })
    result.value = analyzed
    for (const slot of analyzed?.analysis?.slots ?? []) if (slot.editable && !['image', 'video', 'audio'].includes(slot.kind)) values[slot.id] = slot.value
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
}
async function chooseMedia(slot: WorkflowParameterSlot, event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]; (event.target as HTMLInputElement).value = ''
  if (!file) return
  if (slot.kind !== 'image') { error.value = '已识别这个素材入口；当前请先在节点编辑器中选择视频或音频。'; return }
  if (file.size > 10 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { error.value = '请选择 10 MB 以内的 PNG、JPEG 或 WebP 图片。'; return }
  const dataBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file) })
  values[slot.id] = { name: file.name, dataBase64 }; mediaNames[slot.id] = file.name; error.value = ''
}
async function submit() {
  if (!canSubmit.value) return
  busy.value = true; error.value = ''
  try { const task = await invoke<TaskRecord>('workflow.run', { id: props.workflow.id, values: { ...values } }); emit('submitted', task) }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
  finally { busy.value = false }
}
onMounted(load)
</script>

<template>
  <section class="custom-workbench">
    <button class="text-button back" @click="emit('back')"><PhArrowLeft :size="17" />返回精选模板</button>
    <div class="panel workflow-banner"><div class="workflow-icon"><PhCube :size="27" /></div><div><p class="eyebrow">我的工作流</p><h2>{{ workflow.name }}</h2><p class="muted">根据 API 工作流自动识别内容与参数；生成时只修改下方列出的输入。</p></div><span v-if="result?.status === 'ready'" class="good"><PhCheckCircle :size="17" />已识别</span></div>
    <div v-if="!result && !error" class="panel state-card">正在识别工作流参数…</div>
    <div v-else-if="result?.status !== 'ready'" class="panel state-card"><PhInfo :size="24" /><h3>{{ result?.message }}</h3><p class="muted">画布格式仍可在节点编辑器中使用；从 ComfyUI 导出 API 格式后重新导入，即可生成自动表单。</p></div>
    <form v-else class="panel dynamic-form" @submit.prevent="submit">
      <div class="form-heading"><div><h3>需要的内容</h3><p class="muted">{{ editable.length }} 个可编辑输入 · {{ dependencies.length }} 个模型依赖</p></div><span class="badge">{{ result.analysis?.features.audioPipeline ? '含音频输出' : '视频输出' }}</span></div>
      <div class="dynamic-fields">
        <label v-for="slot in editable" :key="slot.id" class="dynamic-field"><span>{{ slot.label }} <small>{{ slot.classType }} · {{ slot.nodeId }}</small></span>
          <textarea v-if="inputType(slot) === 'textarea'" v-model="values[slot.id]" class="input" rows="4" />
          <input v-else-if="['image','video','audio'].includes(slot.kind)" class="media-input" type="file" :accept="slot.kind === 'image' ? 'image/png,image/jpeg,image/webp' : slot.kind === 'video' ? 'video/*' : 'audio/*'" @change="chooseMedia(slot, $event)" /><span v-if="mediaNames[slot.id]" class="selected-media"><PhUploadSimple :size="15" />{{ mediaNames[slot.id] }}</span>
          <input v-else-if="inputType(slot) === 'checkbox'" v-model="values[slot.id]" type="checkbox" />
          <input v-else v-model.number="values[slot.id]" class="input" :type="inputType(slot)" :min="slot.constraints?.min" :max="slot.constraints?.max" :step="slot.constraints?.step ?? (slot.valueType === 'integer' ? 1 : 'any')" />
        </label>
      </div>
      <details v-if="dependencies.length" class="dependency-list"><summary>模型与节点依赖（只读）</summary><dl><template v-for="slot in dependencies" :key="slot.id"><dt>{{ slot.label }}</dt><dd>{{ slot.value }}</dd></template></dl></details>
      <p v-if="unsupportedMedia" class="warning"><PhInfo :size="16" />已识别视频或音频素材入口；当前版本请在节点编辑器选择这类大文件。</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button class="btn primary submit" type="submit" :disabled="!canSubmit"><PhPlay :size="19" weight="fill" />{{ busy ? '正在提交…' : !engineReady ? '请先启动引擎' : '使用此工作流生成' }}</button>
    </form>
  </section>
</template>

<style scoped>
.custom-workbench{max-width:1080px;margin:0 auto}.back{margin-bottom:18px}.workflow-banner{display:flex;align-items:center;gap:18px;padding:24px;margin-bottom:22px}.workflow-banner h2{font-size:24px;margin:3px 0 8px}.workflow-banner p{margin-bottom:0;line-height:1.7}.workflow-banner>.good{margin-left:auto;white-space:nowrap}.workflow-icon{width:56px;height:56px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);border-radius:15px;flex:none}.state-card,.dynamic-form{padding:26px}.state-card{text-align:center}.state-card h3{margin:14px 0 8px}.form-heading{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:1px solid var(--border);padding-bottom:20px}.form-heading h3{font-size:20px;margin:0 0 7px}.form-heading p{margin:0}.dynamic-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:22px}.dynamic-field{display:flex;flex-direction:column;gap:9px;min-width:0;font-size:13px}.dynamic-field>span:first-child{font-weight:600}.dynamic-field small{display:block;color:var(--muted);font-weight:400;margin-top:4px;overflow-wrap:anywhere}.dynamic-field textarea{resize:vertical;min-height:104px}.media-input{min-height:44px;max-width:100%;font-size:12px}.selected-media{display:flex;gap:7px;align-items:center;color:var(--accent);overflow-wrap:anywhere}.dependency-list{margin-top:24px;border-top:1px solid var(--border);padding-top:18px;font-size:13px}.dependency-list summary{cursor:pointer}.dependency-list dl{display:grid;grid-template-columns:140px minmax(0,1fr);gap:10px;margin-top:16px}.dependency-list dd{margin:0;overflow-wrap:anywhere;color:var(--muted)}.warning{display:flex;gap:8px;align-items:flex-start;margin:20px 0 0}.submit{width:100%;margin-top:22px}
@media(max-width:760px){.dynamic-fields{grid-template-columns:1fr}.workflow-banner{align-items:flex-start;flex-wrap:wrap}.workflow-banner>.good{margin-left:74px}.dynamic-form,.workflow-banner{padding:20px}.dependency-list dl{grid-template-columns:1fr;gap:4px 10px}.dependency-list dd{margin-bottom:8px}}
</style>
