<template>
  <Teleport to="body">
    <div v-if="store.showFindBar && store.active" class="fb-wrap">
      <div class="fb-bar">
        <div class="fb-row">
          <input
            ref="queryEl"
            v-model="query"
            class="fb-input"
            type="text"
            placeholder="查找…"
            @keydown.enter="findNext()"
            @keydown.esc="close"
          />
          <span class="fb-count">{{ countText }}</span>
          <button class="fb-btn" title="上一个 (Shift+Enter)" @click="findPrev">↑</button>
          <button class="fb-btn" title="下一个 (Enter)" @click="findNext()">↓</button>
          <button class="fb-btn" :class="{ on: caseSensitive }" title="区分大小写" @click="toggleCase">Aa</button>
          <button class="fb-btn" title="展开替换" @click="showReplace = !showReplace">替换</button>
          <button class="fb-btn" title="关闭 (Esc)" @click="close">×</button>
        </div>
        <div v-if="showReplace" class="fb-row">
          <input v-model="replacement" class="fb-input" type="text" placeholder="替换为…" @keydown.enter="replaceAll" />
          <button class="fb-btn wide" :disabled="!query" @click="replaceCurrent">替换当前</button>
          <button class="fb-btn wide" :disabled="!query" @click="replaceAll">全部替换</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { store } from '../store'

const query = ref('')
const replacement = ref('')
const caseSensitive = ref(false)
const showReplace = ref(false)
const queryEl = ref<HTMLInputElement>()

watch(
  () => store.showFindBar,
  async (open) => {
    if (!open) return
    await nextTick()
    queryEl.value?.focus()
    queryEl.value?.select()
  },
)

const countText = computed(() => {
  const q = query.value
  const tab = store.active
  if (!q || !tab) return ''
  const n = occurrences(tab.content, q)
  return n ? `${n} 处` : '无匹配'
})

function occurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  const h = caseSensitive.value ? haystack : haystack.toLowerCase()
  const n = caseSensitive.value ? needle : needle.toLowerCase()
  let count = 0
  let pos = 0
  while ((pos = h.indexOf(n, pos)) >= 0) {
    count++
    pos += n.length
  }
  return count
}

/** 在编辑器 DOM 中查找下一个匹配（window.find 会自动滚动到该处并选中） */
function findNext(backwards = false): void {
  const q = query.value
  if (!q) return
  const found = (window as unknown as {
    find: (s: string, cs: boolean, back: boolean, wrap: boolean) => boolean
  }).find(q, caseSensitive.value, backwards, true)
  if (!found) {
    // 从头再找一次（光标可能在最后一个匹配之后）
    ;(window as unknown as {
      find: (s: string, cs: boolean, back: boolean, wrap: boolean) => boolean
    }).find(q, caseSensitive.value, backwards, true)
  }
}

function findPrev(): void {
  findNext(true)
}

function toggleCase(): void {
  caseSensitive.value = !caseSensitive.value
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceCurrent(): void {
  const sel = window.getSelection()
  const q = query.value
  if (!sel || sel.isCollapsed || !q) {
    findNext()
    return
  }
  const selected = sel.toString()
  const equals = caseSensitive.value ? selected === q : selected.toLowerCase() === q.toLowerCase()
  if (equals) {
    document.execCommand('insertText', false, replacement.value)
  }
  findNext()
}

function replaceAll(): void {
  const tab = store.active
  const q = query.value
  const r = replacement.value
  if (!tab || !q) return
  if (caseSensitive.value) {
    tab.content = tab.content.split(q).join(r)
  } else {
    tab.content = tab.content.replace(new RegExp(escapeRegExp(q), 'gi'), () => r)
  }
  // 通知编辑器按新内容刷新显示
  store.contentRevision++
}

function close(): void {
  store.showFindBar = false
}
</script>

<style scoped>
.fb-wrap {
  position: fixed;
  top: 44px;
  right: 20px;
  z-index: 90;
}

.fb-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.15);
  padding: 8px;
  width: 380px;
}

.fb-row {
  display: flex;
  align-items: center;
  gap: 5px;
}

.fb-input {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  font: inherit;
  font-size: 13px;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  outline: none;
}

.fb-input:focus {
  border-color: var(--accent);
}

.fb-count {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--muted);
  min-width: 34px;
  text-align: center;
}

.fb-btn {
  flex-shrink: 0;
  font-size: 12px;
  padding: 4px 8px;
  min-width: 28px;
}

.fb-btn.wide {
  min-width: 64px;
}

.fb-btn.on {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
</style>
