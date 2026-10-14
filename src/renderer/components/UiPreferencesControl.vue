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
      <label for="ui-motion">动态效果<select id="ui-motion" class="input" :value="value.motion" @change="update('motion', $event)"><option value="auto">跟随系统</option><option value="reduce">减少动态</option></select></label>
      <label for="ui-transparency">透明效果<select id="ui-transparency" class="input" :value="value.transparency" @change="update('transparency', $event)"><option value="auto">跟随系统</option><option value="reduce">使用实色</option></select></label>
      <label for="ui-contrast">对比度<select id="ui-contrast" class="input" :value="value.contrast" @change="update('contrast', $event)"><option value="auto">跟随系统</option><option value="more">提高对比度</option></select></label>
    </div>
  </section>
</template>
<style scoped>
.ui-preferences-panel{padding:24px;margin-bottom:24px}.ui-preferences-panel h3{font-size:19px;margin:0 0 12px}.ui-preferences-panel p{font-size:14px;line-height:1.7;margin:0 0 20px}.ui-preferences-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.ui-preferences-fields label{font-size:14px;display:flex;flex-direction:column;gap:10px}.ui-preferences-fields .input{width:100%;min-width:0}@media(max-width:900px){.ui-preferences-fields{grid-template-columns:1fr}}
</style>
