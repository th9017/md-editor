<template>
  <div class="titlebar" data-tauri-drag-region @dblclick="onDblclick">
    <div class="left">
      <span class="logo" data-tauri-drag-region />
      <span class="app-name" data-tauri-drag-region>MD 编辑器</span>
      <span class="divider" data-tauri-drag-region />
      <span class="file-name" data-tauri-drag-region>{{ store.active?.name ?? '' }}</span>
      <span v-if="dirty" class="dirty-dot" title="未保存" />
    </div>
    <div class="win-btns">
      <button type="button" class="win-btn" title="最小化" @click="appWindow.minimize()">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round">
          <line x1="3.5" y1="8" x2="12.5" y2="8" />
        </svg>
      </button>
      <button type="button" class="win-btn" title="最大化 / 还原" @click="appWindow.toggleMaximize()">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1">
          <rect x="4" y="4" width="8" height="8" />
        </svg>
      </button>
      <button type="button" class="win-btn close" title="关闭" @click="appWindow.close()">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round">
          <line x1="4.5" y1="4.5" x2="11.5" y2="11.5" />
          <line x1="11.5" y1="4.5" x2="4.5" y2="11.5" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { store } from '../store'

const appWindow = getCurrentWindow()

const dirty = computed(() => {
  const tab = store.active
  return !!tab && tab.content !== tab.savedContent
})

/** 双击标题栏切换最大化（按钮上的双击除外） */
function onDblclick(e: MouseEvent): void {
  if ((e.target as HTMLElement).closest('button')) return
  appWindow.toggleMaximize()
}
</script>

<style scoped>
.titlebar {
  height: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  user-select: none;
}

.left {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 12px;
  min-width: 0;
}

.logo {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}

.app-name {
  font-weight: 700;
  font-size: 13px;
}

.divider {
  width: 1px;
  height: 14px;
  background: var(--border);
  flex-shrink: 0;
}

.file-name {
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dirty-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #f7a41d;
  flex-shrink: 0;
}

.win-btns {
  display: flex;
  height: 100%;
}

.titlebar .win-btn {
  width: 40px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text);
  background: transparent;
}

.titlebar .win-btn:hover {
  background: var(--hover);
}

.titlebar .win-btn.close:hover {
  background: #e81123;
  color: #fff;
}
</style>
