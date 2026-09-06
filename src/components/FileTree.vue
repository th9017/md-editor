<template>
  <div class="file-tree">
    <div class="tree-head">
      <span class="tree-title">文件</span>
      <span class="spacer" />
      <button v-if="store.root" class="icon-btn" title="新建文件" @click="emit('new-file', store.root)">＋</button>
      <button v-if="store.root" class="icon-btn" title="新建文件夹" @click="emit('new-folder', store.root)">📁＋</button>
      <button v-if="store.root" class="icon-btn" title="刷新" @click="refreshRoot">⟳</button>
    </div>
    <div v-if="!store.root" class="tree-empty">尚未打开文件夹</div>
    <div v-else class="tree-body">
      <FileTreeItem v-for="n in store.tree" :key="n.path" :node="n" :depth="0" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { store } from '../store'
import { readDirShallow } from '../tauri'
import type { FileNode } from '../types'
import FileTreeItem from './FileTreeItem.vue'

const emit = defineEmits<{
  (e: 'new-file', dir: string): void
  (e: 'new-folder', dir: string): void
}>()

async function refreshRoot(): Promise<void> {
  if (!store.root) return
  store.tree = await readDirShallow(store.root)
}

/** 重载某个目录层（文件管理操作后调用）；dirPath 为空或等于根时刷新根层 */
async function reloadDir(dirPath: string): Promise<void> {
  if (!store.root) return
  if (!dirPath || dirPath === store.root) {
    await refreshRoot()
    return
  }
  const node = findDir(store.tree, dirPath)
  if (node) {
    node.children = await readDirShallow(dirPath)
    node.loaded = true
  }
}

function findDir(nodes: FileNode[], path: string): FileNode | null {
  for (const n of nodes) {
    if (!n.isDir) continue
    if (n.path === path) return n
    const found = findDir(n.children, path)
    if (found) return found
  }
  return null
}

defineExpose({ refreshRoot, reloadDir })
</script>

<style scoped>
.file-tree {
  height: 100%;
  display: flex;
  flex-direction: column;
  font-size: 13px;
}

.tree-head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 10px 4px;
  flex-shrink: 0;
}

.tree-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  letter-spacing: 0.05em;
}

.spacer {
  flex: 1;
}

.icon-btn {
  border: none;
  background: transparent;
  padding: 2px 6px;
  font-size: 12px;
  color: var(--muted);
  border-radius: 4px;
}

.icon-btn:hover {
  color: var(--text);
  background: var(--hover);
}

.tree-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 0 10px;
}

.tree-empty {
  color: var(--muted);
  text-align: center;
  padding: 24px 12px;
}
</style>
