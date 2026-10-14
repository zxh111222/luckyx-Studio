<script setup lang="ts">
import type { UiPreferences } from '../src/ui-preferences'
const props = defineProps<{ value: UiPreferences }>()
const emit = defineEmits<{ update: [value: UiPreferences] }>()
function update(key: keyof UiPreferences, event: Event) { emit('update', { ...props.value, [key]: (event.target as HTMLSelectElement).value } as UiPreferences) }
</script>
<template>
  <section class="panel ui-preferences-panel" aria-labelledby="ui-preferences-title">
    <h3 id="ui-preferences-title">界面偏好</h3><p class="muted">只在这台设备保存，自动跟随系统设置。减少动态时保留短淡入淡出。</p>
    <div class="ui-preferences-fields">
      <label for="ui-motion"><span><strong>动态效果</strong><small>减少移动与缩放，保留必要反馈</small></span><select id="ui-motion" class="input" :value="value.motion" @change="update('motion', $event)"><option value="auto">跟随系统</option><option value="reduce">减少动态</option></select></label>
      <label for="ui-transparency"><span><strong>透明效果</strong><small>使用实色遮罩，让层次更加明确</small></span><select id="ui-transparency" class="input" :value="value.transparency" @change="update('transparency', $event)"><option value="auto">跟随系统</option><option value="reduce">使用实色</option></select></label>
      <label for="ui-contrast"><span><strong>对比度</strong><small>增强文字与边界，方便阅读</small></span><select id="ui-contrast" class="input" :value="value.contrast" @change="update('contrast', $event)"><option value="auto">跟随系统</option><option value="more">提高对比度</option></select></label>
    </div>
  </section>
</template>
<style scoped>
.ui-preferences-panel{padding:28px;min-width:0;background:var(--surface);border:1px solid var(--border);border-radius:18px}.ui-preferences-panel h3{font-size:20px;font-weight:600;margin:0 0 12px}.ui-preferences-panel p{font-size:13px;line-height:1.8;color:var(--muted);margin:0 0 24px}.ui-preferences-fields{display:flex;flex-direction:column}.ui-preferences-fields label{font-size:14px;display:grid;grid-template-columns:minmax(0,1fr) 136px;gap:18px;align-items:center;padding:22px 0;border-top:1px solid var(--border)}.ui-preferences-fields strong{display:block;font-size:14px;font-weight:600;line-height:1.6}.ui-preferences-fields small{display:block;font-size:12px;line-height:1.8;color:var(--muted);margin-top:4px}.ui-preferences-fields .input{width:100%;min-width:0;font-size:13px}@media(max-width:1100px){.ui-preferences-fields label{grid-template-columns:minmax(0,1fr) 126px;gap:12px}.ui-preferences-panel{padding:24px}}@media(max-width:600px){.ui-preferences-panel{padding:20px}.ui-preferences-fields label{grid-template-columns:1fr;gap:12px;padding:20px 0}.ui-preferences-fields .input{width:100%}}
</style>
