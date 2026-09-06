<template>
  <div class="log-panel">
    <div class="log-head">
      <span>输出日志</span>
      <span class="spacer" />
      <button class="mini" @click="store.logs = ''">清空</button>
      <button class="mini" @click="store.logVisible = false">收起</button>
    </div>
    <pre ref="body" class="log-body">{{ store.logs || '（暂无日志）' }}</pre>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { store } from '../store'

const body = ref<HTMLElement>()

watch(
  () => store.logs,
  async () => {
    await nextTick()
    body.value?.scrollTo({ top: body.value.scrollHeight })
  },
)
</script>

<style scoped>
.log-panel {
  height: 180px;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
  background: var(--panel-2);
  flex-shrink: 0;
}

.log-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  font-size: 12px;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
}

.spacer {
  flex: 1;
}

.mini {
  font-size: 12px;
  padding: 1px 8px;
}

.log-body {
  flex: 1;
  margin: 0;
  padding: 8px 12px;
  overflow: auto;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text);
}
</style>
