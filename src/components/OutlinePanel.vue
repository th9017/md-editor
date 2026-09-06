<template>
  <div class="panel">
    <div class="panel-head">大纲</div>
    <div class="panel-body">
      <div v-if="!items.length" class="placeholder">
        {{ store.active?.kind === 'md' ? '当前文档暂无标题' : '打开 Markdown 文件后显示大纲' }}
      </div>
      <div
        v-for="(h, i) in items"
        :key="i"
        class="ol-item"
        :class="{ active: String(h.line) === store.activeHeading }"
        :style="{ paddingLeft: 10 + (h.level - 1) * 12 + 'px' }"
        :title="h.text"
        @click="emit('jump', h)"
      >
        <span class="ol-badge">H{{ h.level }}</span>
        <span class="ol-text">{{ h.text }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Heading } from '../types'
import { store } from '../store'

const emit = defineEmits<{ (e: 'jump', h: Heading): void }>()

const items = computed<Heading[]>(() =>
  store.active && store.active.kind === 'md' ? store.outline : [],
)
</script>

<style scoped>
.ol-item {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding-right: 8px;
  cursor: pointer;
  border-radius: 6px;
  color: var(--text);
  user-select: none;
}

.ol-item:hover {
  background: var(--hover);
}

.ol-item.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.ol-badge {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0 3px;
  line-height: 14px;
}

.ol-item.active .ol-badge {
  color: var(--accent);
  border-color: var(--accent);
}

.ol-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
</style>
