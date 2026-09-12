<template>
  <div class="tabs">
    <div
      v-for="(t, idx) in store.tabs"
      :key="t.path"
      class="tab"
      :class="{
        active: t.path === store.activePath,
        external: t.externalChanged,
        lifting: dragActive && dragFromIdx === idx,
      }"
      :title="t.path"
      @click="onTabClick(t.path)"
      @mousedown="onTabMouseDown($event, idx)"
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
import { onBeforeUnmount, ref } from 'vue'
import { closeTabSafe, store } from '../store'
import type { Tab } from '../types'

const emit = defineEmits<{
  (e: 'ctx', x: number, y: number, tab: Tab): void
}>()

async function requestClose(path: string): Promise<void> {
  await closeTabSafe(path)
}

// ---------- 标签拖拽排序 ----------
// Tauri WebView 开启 dragDropEnabled 后 HTML5 拖拽事件不可靠，这里用鼠标事件自实现。

const dragActive = ref(false)
const dragFromIdx = ref(-1)
let dragging = false // 已超过位移阈值、真正进入拖拽
let suppressClick = false // 拖拽结束后吞掉紧随的 click，避免误切换
let startX = 0

function onTabMouseDown(e: MouseEvent, index: number): void {
  if (e.button !== 0) return
  if ((e.target as HTMLElement).closest('.close')) return
  dragFromIdx.value = index
  dragging = false
  startX = e.clientX
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent): void {
  const from = dragFromIdx.value
  if (from < 0) return
  if (!dragging) {
    if (Math.abs(e.clientX - startX) < 5) return
    dragging = true
    dragActive.value = true
  }
  const target = tabIndexAt(e.clientX)
  if (target >= 0 && target !== from) {
    const [moved] = store.tabs.splice(from, 1)
    store.tabs.splice(target, 0, moved)
    dragFromIdx.value = target
  }
}

/** 鼠标 X 落在哪个标签区间内（-1 = 都不在） */
function tabIndexAt(clientX: number): number {
  const els = document.querySelectorAll<HTMLElement>('.tabs > .tab')
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect()
    if (clientX >= r.left && clientX < r.right) return i
  }
  return -1
}

function onMouseUp(): void {
  detachDragListeners()
  if (dragging) suppressClick = true
  dragging = false
  dragActive.value = false
  dragFromIdx.value = -1
}

function detachDragListeners(): void {
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
}

function onTabClick(path: string): void {
  if (suppressClick) {
    suppressClick = false
    return
  }
  store.activePath = path
}

onBeforeUnmount(detachDragListeners)
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

.tab.lifting {
  opacity: 0.45;
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
