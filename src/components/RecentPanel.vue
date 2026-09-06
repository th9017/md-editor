<template>
  <div class="panel">
    <div class="panel-head">最近打开</div>
    <div class="panel-body recent-body">
      <div v-if="!store.recentFolders.length && !store.recentFiles.length" class="placeholder">
        暂无记录
      </div>

      <template v-if="store.recentFolders.length">
        <div class="recent-section">文件夹</div>
        <div
          v-for="f in store.recentFolders"
          :key="f"
          class="recent-item"
          :title="f"
          @click="emit('open-folder', f)"
        >
          <span class="recent-ico">📁</span>
          <span class="recent-name">{{ baseName(f) }}</span>
          <span class="recent-path">{{ parentDir(f) }}</span>
          <button class="recent-remove" title="移除记录" @click.stop="removeRecentFolder(f)">×</button>
        </div>
      </template>

      <template v-if="store.recentFiles.length">
        <div class="recent-section">文件</div>
        <div
          v-for="f in store.recentFiles"
          :key="f"
          class="recent-item"
          :title="f"
          @click="emit('open-file', f)"
        >
          <span class="recent-ico">📝</span>
          <span class="recent-name">{{ baseName(f) }}</span>
          <span class="recent-path">{{ parentDir(f) }}</span>
          <button class="recent-remove" title="移除记录" @click.stop="removeRecentFile(f)">×</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { store, removeRecentFolder, removeRecentFile } from '../store'
import { baseName, parentDir } from '../tauri'

const emit = defineEmits<{
  (e: 'open-folder', path: string): void
  (e: 'open-file', path: string): void
}>()
</script>

<style scoped>
.recent-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.recent-section {
  margin: 8px 8px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.recent-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
}

.recent-item:hover {
  background: var(--hover);
}

.recent-ico {
  flex-shrink: 0;
  font-size: 13px;
}

.recent-name {
  flex-shrink: 0;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--text);
}

.recent-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--muted);
  direction: rtl;
  text-align: left;
}

.recent-remove {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 14px;
  padding: 0 4px;
  border-radius: 4px;
  opacity: 0;
}

.recent-item:hover .recent-remove {
  opacity: 1;
}

.recent-remove:hover {
  background: var(--border);
  color: var(--text);
}
</style>
