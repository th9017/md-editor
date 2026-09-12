<template>
  <nav class="rail">
    <button
      type="button"
      class="rail-btn"
      :class="{ active: store.sidebarView === 'files' }"
      title="文件"
      @click="onRail('files')"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
    </button>
    <button
      type="button"
      class="rail-btn"
      :class="{ active: store.sidebarView === 'search' }"
      title="搜索"
      @click="onRail('search')"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <circle cx="11" cy="11" r="7" />
        <line x1="16.5" y1="16.5" x2="21" y2="21" />
      </svg>
    </button>
    <button
      type="button"
      class="rail-btn"
      :class="{ active: store.sidebarView === 'git' }"
      title="Git"
      @click="onRail('git')"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="6" cy="5" r="2.2" />
        <circle cx="6" cy="19" r="2.2" />
        <circle cx="18" cy="7" r="2.2" />
        <path d="M6 7.2v9.6" />
        <path d="M18 9.2a8 8 0 0 1-8 8H8.2" />
      </svg>
    </button>
    <button
      type="button"
      class="rail-btn"
      :class="{ active: store.sidebarView === 'outline' }"
      title="大纲"
      @click="onRail('outline')"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <line x1="9" y1="6" x2="20" y2="6" />
        <line x1="9" y1="12" x2="20" y2="12" />
        <line x1="9" y1="18" x2="20" y2="18" />
        <circle cx="4.5" cy="6" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="4.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="4.5" cy="18" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    </button>
    <button
      type="button"
      class="rail-btn"
      :class="{ active: store.sidebarView === 'recent' }"
      title="最近"
      @click="onRail('recent')"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7v5l3.5 2" />
      </svg>
    </button>
    <button
      type="button"
      class="rail-btn"
      :class="{ active: store.sidebarView === 'settings' }"
      title="设置"
      @click="onRail('settings')"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { setSidebarView, store, toggleSidebarCollapsed } from '../store'
import type { SidebarView } from '../types'

/** 点当前激活视图图标 = 收起/展开侧栏；点其他图标 = 切换视图（并自动展开） */
function onRail(v: SidebarView): void {
  if (store.sidebarView === v) toggleSidebarCollapsed()
  else setSidebarView(v)
}
</script>

<style scoped>
.rail {
  width: 44px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 4px 0;
  background: var(--panel);
  border-right: 1px solid var(--border);
}

.rail-btn {
  position: relative;
  height: 40px;
  padding: 0;
  border: none;
  border-radius: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
}

.rail-btn:hover {
  color: var(--text);
}

.rail-btn.active {
  color: var(--accent);
}

/* 左侧 2px 选中指示条 */
.rail-btn.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 9px;
  bottom: 9px;
  width: 2px;
  border-radius: 0 2px 2px 0;
  background: var(--accent);
}
</style>
