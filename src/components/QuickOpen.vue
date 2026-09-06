<template>
  <Teleport to="body">
    <div v-if="store.showQuickOpen" class="qo-mask" @mousedown.self="close">
      <div class="qo-panel">
        <input
          ref="inputEl"
          v-model="q"
          class="qo-input"
          type="text"
          placeholder="输入文件名，回车打开（Ctrl+P）…"
          @keydown="onKey"
        />
        <div class="qo-list">
          <div v-if="!store.root" class="qo-empty">先打开文件夹</div>
          <div v-else-if="!filtered.length" class="qo-empty">无匹配文件</div>
          <div
            v-for="(item, i) in filtered"
            :key="item.path"
            class="qo-item"
            :class="{ active: i === sel }"
            :title="item.path"
            @mouseenter="sel = i"
            @click="choose(item.path)"
          >
            <span class="qo-name">{{ baseName(item.path) }}</span>
            <span class="qo-dir">{{ dirOf(item.path) }}</span>
          </div>
        </div>
        <div class="qo-foot">{{ filtered.length }} 个文件 · ↑↓ 选择 · Enter 打开 · Esc 关闭</div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { store } from '../store'
import { baseName, listWorkspaceFiles, parentDir, readTextFileChecked } from '../tauri'
import { openTab } from '../store'
import { fuzzyMatch } from '../fuzzy'

const emit = defineEmits<{ (e: 'opened', path: string): void }>()

const q = ref('')
const sel = ref(0)
const files = ref<string[]>([])
const inputEl = ref<HTMLInputElement>()

watch(
  () => store.showQuickOpen,
  async (open) => {
    if (!open) return
    q.value = ''
    sel.value = 0
    files.value = store.root ? await listWorkspaceFiles(store.root) : []
    await nextTick()
    inputEl.value?.focus()
  },
)

const filtered = computed(() => {
  const query = q.value.trim()
  if (!query) return files.value.slice(0, 50).map((p) => ({ path: p, score: 0 }))
  const matched = files.value
    .map((p) => ({ path: p, m: fuzzyMatch(p, query) }))
    .filter((x): x is { path: string; m: NonNullable<ReturnType<typeof fuzzyMatch>> } => !!x.m)
    .sort((a, b) => b.m.score - a.m.score)
    .slice(0, 50)
  return matched.map((x) => ({ path: x.path, score: x.m.score }))
})

function onKey(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    sel.value = Math.min(sel.value + 1, filtered.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    sel.value = Math.max(sel.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const item = filtered.value[sel.value]
    if (item) choose(item.path)
  } else if (e.key === 'Escape') {
    close()
  }
}

async function choose(path: string): Promise<void> {
  close()
  const name = baseName(path)
  try {
    openTab(path, await readTextFileChecked(path, name))
    emit('opened', path)
  } catch (e) {
    store.logs = String(e)
    store.logVisible = true
  }
}

function close(): void {
  store.showQuickOpen = false
}

function dirOf(p: string): string {
  return parentDir(p)
}
</script>

<style scoped>
.qo-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.25);
}

.qo-panel {
  width: 560px;
  max-width: 90vw;
  margin: 8vh auto 0;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

.qo-input {
  width: 100%;
  box-sizing: border-box;
  padding: 12px 14px;
  font: inherit;
  font-size: 15px;
  color: var(--text);
  background: var(--panel);
  border: none;
  border-bottom: 1px solid var(--border);
  outline: none;
}

.qo-list {
  max-height: 50vh;
  overflow: auto;
  padding: 4px;
}

.qo-empty {
  padding: 20px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}

.qo-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.qo-item.active {
  background: var(--accent-soft);
}

.qo-name {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--text);
  font-weight: 600;
}

.qo-dir {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--muted);
  direction: rtl;
  text-align: left;
}

.qo-foot {
  padding: 6px 12px;
  font-size: 11px;
  color: var(--muted);
  border-top: 1px solid var(--border);
}
</style>
