<template>
  <Teleport to="body">
    <div v-if="store.showPalette" class="cp-mask" @mousedown.self="close">
      <div class="cp-panel">
        <input
          ref="inputEl"
          v-model="q"
          class="cp-input"
          type="text"
          placeholder="输入命令名，回车执行（Ctrl+Shift+P）…"
          @keydown="onKey"
        />
        <div class="cp-list">
          <div v-if="!filtered.length" class="cp-empty">无匹配命令</div>
          <div
            v-for="(item, i) in filtered"
            :key="item.id"
            class="cp-item"
            :class="{ active: i === sel }"
            @mouseenter="sel = i"
            @click="run(item)"
          >
            <span class="cp-label">{{ item.label }}</span>
            <span v-if="item.keywords" class="cp-keys">{{ item.keywords }}</span>
          </div>
        </div>
        <div class="cp-foot">↑↓ 选择 · Enter 执行 · Esc 关闭</div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { store } from '../store'
import { fuzzyMatch } from '../fuzzy'

export interface CommandItem {
  id: string
  label: string
  keywords?: string
  run: () => void
}

const props = defineProps<{ commands: CommandItem[] }>()

const q = ref('')
const sel = ref(0)
const inputEl = ref<HTMLInputElement>()

watch(
  () => store.showPalette,
  async (open) => {
    if (!open) return
    q.value = ''
    sel.value = 0
    await nextTick()
    inputEl.value?.focus()
  },
)

const filtered = computed(() => {
  const query = q.value.trim()
  if (!query) return props.commands.slice(0, 30)
  return props.commands
    .map((c) => ({ c, m: fuzzyMatch(c.label + ' ' + (c.keywords ?? ''), query) }))
    .filter((x) => x.m)
    .sort((a, b) => (b.m?.score ?? 0) - (a.m?.score ?? 0))
    .slice(0, 30)
    .map((x) => x.c)
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
    if (item) run(item)
  } else if (e.key === 'Escape') {
    close()
  }
}

function run(item: CommandItem): void {
  close()
  item.run()
}

function close(): void {
  store.showPalette = false
}
</script>

<style scoped>
.cp-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.25);
}

.cp-panel {
  width: 520px;
  max-width: 90vw;
  margin: 8vh auto 0;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

.cp-input {
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

.cp-list {
  max-height: 50vh;
  overflow: auto;
  padding: 4px;
}

.cp-empty {
  padding: 20px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}

.cp-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.cp-item.active {
  background: var(--accent-soft);
}

.cp-label {
  font-size: 13px;
  color: var(--text);
}

.cp-keys {
  font-size: 11px;
  color: var(--muted);
}

.cp-foot {
  padding: 6px 12px;
  font-size: 11px;
  color: var(--muted);
  border-top: 1px solid var(--border);
}
</style>
