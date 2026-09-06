<template>
  <div class="tabs">
    <div
      v-for="t in store.tabs"
      :key="t.path"
      class="tab"
      :class="{ active: t.path === store.activePath, external: t.externalChanged }"
      :title="t.path"
      @click="store.activePath = t.path"
      @auxclick.middle.prevent="requestClose(t.path)"
      @contextmenu.prevent="emit('ctx', $event.clientX, $event.clientY, t)"
    >
      <span class="tab-name">{{ t.name }}</span>
      <span v-if="t.externalChanged" class="flag external" title="文件已在外部被修改">⚠</span>
      <span v-else-if="t.content !== t.savedContent" class="flag" title="未保存">●</span>
      <button class="close" title="关闭" @click.stop="requestClose(t.path)">×</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { closeTabSafe, store } from '../store'
import type { Tab } from '../types'

const emit = defineEmits<{
  (e: 'ctx', x: number, y: number, tab: Tab): void
}>()

async function requestClose(path: string): Promise<void> {
  await closeTabSafe(path)
}
</script>

<style scoped>
.tabs {
  display: flex;
  background: var(--panel-2);
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  flex-shrink: 0;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  padding: 6px 8px 6px 12px;
  border-right: 1px solid var(--border);
  cursor: pointer;
  user-select: none;
  color: var(--muted);
}

.tab.active {
  background: var(--panel);
  color: var(--text);
  box-shadow: inset 0 2px 0 var(--accent);
}

.tab.external .tab-name {
  color: #b5892b;
}

.tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flag {
  color: var(--accent);
  font-size: 10px;
  flex-shrink: 0;
}

.flag.external {
  color: #b5892b;
  font-size: 11px;
}

.close {
  border: none;
  background: transparent;
  padding: 0 4px;
  font-size: 14px;
  color: var(--muted);
  border-radius: 4px;
}

.close:hover {
  background: var(--hover);
  color: var(--text);
}
</style>
