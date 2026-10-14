<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { PhMoon, PhPower, PhX } from '@phosphor-icons/vue'
import type { CloseRequest } from '../../shared/close-policy'
import { invoke } from '../src/api'
import { createFocusTrap } from '../src/ui-preferences'

const props = defineProps<{ request: CloseRequest; opener: HTMLElement | null }>()
const emit = defineEmits<{ closed: [] }>()
const dialog = ref<HTMLElement | null>(null)
const remember = ref(false)
const pending = ref(false)
const pendingAction = ref<'cancel' | 'background' | 'quit'>('cancel')
const error = ref('')
let release: ((restore?: boolean) => void) | undefined
async function choose(action: 'cancel' | 'background' | 'quit') {
  if (pending.value) return
  pendingAction.value = action; pending.value = true; error.value = ''
  try { await invoke('native.close.resolve', { id: props.request.id, action, remember: action !== 'cancel' && remember.value }); emit('closed') }
  catch (e) { error.value = e instanceof Error ? e.message : '暂时无法关闭，请重试。' }
  finally { pending.value = false }
}
onMounted(async () => { await nextTick(); if (dialog.value) release = createFocusTrap(dialog.value, props.opener, () => void choose('cancel')) })
onUnmounted(() => release?.())
</script>

<template>
  <div class="modal-backdrop close-backdrop" @click.self="choose('cancel')">
    <section ref="dialog" class="panel close-dialog" role="dialog" aria-modal="true" aria-labelledby="close-title" tabindex="-1">
      <header><div><p class="eyebrow">离开创作工作台</p><h2 id="close-title">后台也要一起关闭吗？</h2></div><button class="text-button" aria-label="取消关闭" :disabled="pending" @click="choose('cancel')"><PhX :size="20" /></button></header>
      <p class="muted">继续后台运行会收起窗口，下载与本地引擎继续运行；可从系统托盘重新打开。</p>
      <div v-if="request.activeTasks || request.activeDownloads" class="running-note"><p v-if="request.activeTasks">{{ request.activeTasks }} 个任务尚未结束，停止后台可能中断生成。</p><p v-if="request.activeDownloads">安装正在进行。退出会暂停下载，下次打开可继续。</p></div>
      <p v-if="request.externalEngine" class="external-note muted">外部启动的 ComfyUI 会保留，本应用不会关闭它。</p>
      <div class="close-options"><button class="btn primary" :disabled="pending" @click="choose('background')"><PhMoon :size="20" />{{ pending && pendingAction === 'background' ? '正在转入后台…' : '继续后台运行' }}</button><button class="btn secondary" :disabled="pending" @click="choose('quit')"><PhPower :size="20" />{{ pending && pendingAction === 'quit' ? '正在停止后台…' : '退出并停止后台' }}</button></div>
      <p v-if="pending && pendingAction === 'quit'" class="muted reset-note" role="status">正在保存进度并停止后台，请稍候。</p>
      <label class="remember-choice"><input v-model="remember" type="checkbox" :disabled="pending" /><span>记住我的选择</span></label><p class="muted reset-note">可在“设置与诊断 → 常规”中改回每次询问。</p>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <footer><button class="text-button" :disabled="pending" @click="choose('cancel')">继续使用应用</button></footer>
    </section>
  </div>
</template>

<style scoped>
.close-backdrop{z-index:80}.close-dialog{width:min(520px,100%);padding:30px;max-height:calc(100dvh - 48px);overflow:auto}.close-dialog header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px}.close-dialog h2{font-size:25px;letter-spacing:-.7px;line-height:1.35;margin-top:8px}.close-dialog p{font-size:14px;line-height:1.8}.eyebrow{font-size:12px!important;color:var(--muted)}.close-dialog header>.text-button{min-width:44px}.running-note{margin-top:18px;background:var(--warning-tint,#fff7ea);border:1px solid var(--warning-border,#e6d2ae);border-radius:12px;color:var(--warning);padding:14px 16px}.external-note{margin-top:14px}.close-options{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:24px}.remember-choice{display:flex;align-items:center;gap:10px;font-size:14px;margin-top:24px;min-height:44px}.remember-choice input{width:18px;height:18px;accent-color:var(--accent)}.reset-note{font-size:12px!important;margin-top:4px}.close-dialog footer{border-top:1px solid var(--border);margin-top:20px;padding-top:12px;display:flex;justify-content:flex-end}@media(max-width:599px){.close-dialog{padding:24px}.close-dialog h2{font-size:23px}.close-options{grid-template-columns:1fr}}
</style>
