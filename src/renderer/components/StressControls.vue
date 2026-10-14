<script setup lang="ts">
import type { StressMode } from '../src/ui-stress'
import { ref } from 'vue'
const expanded = ref(true)
defineProps<{ mode: StressMode }>()
const emit = defineEmits<{ change: [mode: StressMode] }>()
const options: { mode: StressMode; label: string }[] = [
  { mode: 'demo', label: 'Demo data' }, { mode: 'worst', label: 'Worst case' },
  { mode: 'empty', label: 'Empty' }, { mode: 'one', label: 'One' }, { mode: 'many', label: '1,000 rows' }
]
</script>
<template>
  <button v-if="!expanded" class="stress-reopen" type="button" aria-label="打开开发测试数据工具" @click="expanded = true">测试数据</button>
  <aside v-else class="stress-controls" aria-label="开发模式数据压力测试">
    <span v-if="mode !== 'demo'" class="stress-readonly" role="status">示例数据 · 只读 · 非真实设备或结果</span>
    <div class="stress-track" role="group" aria-label="选择测试数据">
      <button v-for="option in options" :key="option.mode" type="button" :aria-pressed="mode === option.mode" @click="emit('change', option.mode)">{{ option.label }}</button>
      <button type="button" @click="expanded = false">隐藏测试工具</button>
    </div>
  </aside>
</template>
<style scoped>
.stress-controls{position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:10000;display:grid;justify-items:center;gap:5px;max-width:calc(100vw - 16px);font:12px/1.4 system-ui,sans-serif;color:#161616}
.stress-track{display:flex;flex-wrap:wrap;justify-content:center;padding:3px;border:1px solid #b6b6b6;border-radius:8px;background:#e5e5e5;box-shadow:0 2px 8px #0002}
.stress-track button{border:0;background:transparent;border-radius:5px;color:#303030;padding:6px 9px;cursor:pointer;font:inherit;white-space:nowrap;min-height:30px}
.stress-track button[aria-pressed=true]{background:#fff;box-shadow:0 1px 3px #0002}.stress-track button:focus-visible{outline:2px solid #1978a5;outline-offset:1px}
.stress-readonly{max-width:100%;padding:3px 8px;border-radius:4px;background:#fff;color:#333;overflow-wrap:anywhere}
.stress-reopen{position:fixed;right:8px;bottom:8px;z-index:10000;border:1px solid #b6b6b6;border-radius:5px;padding:4px 7px;background:#eee;color:#333;font:11px/1.4 system-ui,sans-serif;cursor:pointer}.stress-reopen:focus-visible{outline:2px solid #1978a5;outline-offset:2px}
</style>
