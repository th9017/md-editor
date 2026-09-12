<template>
  <div>
    <div
      class="tree-row"
      :class="{ active: store.activePath === node.path }"
      :style="{ paddingLeft: 6 + depth * 14 + 'px' }"
      @click="onClick"
      @contextmenu.prevent="onCtx"
    >
      <span class="twist">{{ node.isDir ? (node.expanded ? '▾' : '▸') : '' }}</span>
      <span class="ico">{{ icon }}</span>
      <span class="label" :title="node.path">{{ node.name }}</span>
      <span v-if="badge" class="badge" :class="badge">{{ badge }}</span>
    </div>
    <template v-if="node.isDir && node.expanded">
      <FileTreeItem v-for="c in node.children" :key="c.path" :node="c" :depth="depth + 1" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import type { FileNode } from '../types'
import { gitChangeMap, openFileAt, store } from '../store'
import { readDirShallow, relPath } from '../tauri'

defineOptions({ name: 'FileTreeItem' })

const props = defineProps<{ node: FileNode; depth: number }>()

// App.vue 提供：打开文件树右键菜单
const openTreeCtx = inject<(x: number, y: number, node: FileNode) => void>('openTreeCtx', () => {})

const icon = computed(() => {
  if (props.node.isDir) return '📁'
  const n = props.node.name.toLowerCase()
  if (n.endsWith('.md') || n.endsWith('.markdown')) return '📝'
  return '📄'
})

/** Git 状态角标：M 修改 / A 新增 / D 删除 / R 重命名 / U 未跟踪 */
const badge = computed<string | ''>(() => {
  if (!store.gitRepo || props.node.isDir) return ''
  const hit = gitChangeMap.value.get(relPath(props.node.path, store.root))
  if (!hit) return ''
  if (hit === '??') return 'U'
  return hit
})

function onCtx(e: MouseEvent): void {
  openTreeCtx(e.clientX, e.clientY, props.node)
}

async function onClick(): Promise<void> {
  const node = props.node
  if (node.isDir) {
    node.expanded = !node.expanded
    if (node.expanded && !node.loaded) {
      node.children = await readDirShallow(node.path)
      node.loaded = true
    }
    return
  }
  await openFileAt(node.path)
}
</script>

<style scoped>
.tree-row {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 25px;
  padding-right: 8px;
  margin: 0 4px;
  border-radius: 5px;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}

.tree-row:hover {
  background: var(--hover);
}

.tree-row.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.twist {
  width: 12px;
  color: var(--muted);
  font-size: 10px;
  flex-shrink: 0;
}

.ico {
  font-size: 12px;
  flex-shrink: 0;
}

.label {
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.badge {
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}

.badge.M {
  color: #d4740c;
}

.badge.A,
.badge.R {
  color: var(--ok);
}

.badge.D {
  color: var(--err);
}

.badge.U {
  color: var(--muted);
}
</style>
