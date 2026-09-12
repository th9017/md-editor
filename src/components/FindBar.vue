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
          <button
            class="fb-btn"
            :disabled="stepDisabled"
            :title="stepDisabled ? '正则/全词模式下暂不支持逐个跳转' : '上一个 (Shift+Enter)'"
            @click="findPrev"
          >
            ↑
          </button>
          <button
            class="fb-btn"
            :disabled="stepDisabled"
            :title="stepDisabled ? '正则/全词模式下暂不支持逐个跳转' : '下一个 (Enter)'"
            @click="findNext()"
          >
            ↓
          </button>
          <button class="fb-btn" :class="{ on: caseSensitive }" title="区分大小写" @click="toggleCase">Aa</button>
          <button
            class="fb-btn"
            :class="{ on: matchMode === 'regex' }"
            title="正则模式"
            @click="toggleMode('regex')"
          >
            .*
          </button>
          <button
            class="fb-btn"
            :class="{ on: matchMode === 'word' }"
            title="全词匹配"
            @click="toggleMode('word')"
          >
            词
          </button>
          <button class="fb-btn" title="展开替换" @click="showReplace = !showReplace">替换</button>
          <button class="fb-btn" title="关闭 (Esc)" @click="close">×</button>
        </div>
        <div v-if="regexInvalid" class="fb-hint">正则表达式无效</div>
        <div v-if="showReplace" class="fb-row">
          <input v-model="replacement" class="fb-input" type="text" placeholder="替换为…" @keydown.enter="replaceAll" />
          <button
            class="fb-btn wide"
            :disabled="!query || stepDisabled"
            :title="stepDisabled ? '正则/全词模式下暂不支持逐个跳转' : undefined"
            @click="replaceCurrent"
          >
            替换当前
          </button>
          <button class="fb-btn wide" :disabled="!query || regexInvalid" @click="replaceAll">全部替换</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { store } from '../store'

/** 匹配模式：字面量 / 正则 / 全词（三者互斥，同一时刻只有一种生效；大小写为独立开关） */
type MatchMode = 'literal' | 'regex' | 'word'

const query = ref('')
const replacement = ref('')
const caseSensitive = ref(false)
const showReplace = ref(false)
const queryEl = ref<HTMLInputElement>()
const matchMode = ref<MatchMode>('literal')

watch(
  () => store.showFindBar,
  async (open) => {
    if (!open) return
    await nextTick()
    queryEl.value?.focus()
    queryEl.value?.select()
  },
)

/** 按当前模式与大小写开关构造匹配用 RegExp：
 *  - 字面量模式（或空查询）返回 re = null，走原有 indexOf 路径
 *  - 全词模式：查询转义后用 \b…\b 包裹
 *  - 正则模式：直接以查询为模式串
 *  - 非法正则：invalid = true，计数按 0 处理且不执行任何替换 */
const compiled = computed<{ re: RegExp | null; invalid: boolean }>(() => {
  const q = query.value
  if (matchMode.value === 'literal' || !q) return { re: null, invalid: false }
  const flags = caseSensitive.value ? 'g' : 'gi'
  try {
    const source = matchMode.value === 'word' ? `\\b${escapeRegExp(q)}\\b` : q
    return { re: new RegExp(source, flags), invalid: false }
  } catch {
    return { re: null, invalid: true }
  }
})

/** 正则表达式是否非法（驱动面板内提示与替换拦截） */
const regexInvalid = computed(() => compiled.value.invalid)

/** 正则/全词模式下 window.find 只能字面量定位，上一个/下一个/替换当前 一并置灰 */
const stepDisabled = computed(() => matchMode.value !== 'literal')

const countText = computed(() => {
  const q = query.value
  const tab = store.active
  if (!q || !tab) return ''
  const c = compiled.value
  // 非法正则：计为 0 处，由面板内的「正则表达式无效」提示说明原因
  if (c.invalid) return '0 处'
  if (c.re) {
    const n = countByRegex(tab.content, c.re)
    return n ? `${n} 处` : '无匹配'
  }
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

/** 用全局 RegExp 统计匹配数（遇到零长匹配时手动前进一位，避免死循环） */
function countByRegex(haystack: string, re: RegExp): number {
  re.lastIndex = 0
  let count = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(haystack)) !== null) {
    count++
    if (m[0].length === 0) re.lastIndex++
  }
  return count
}

/** 在编辑器 DOM 中查找下一个匹配（window.find 会自动滚动到该处并选中） */
function findNext(backwards = false): void {
  // 正则/全词模式下 window.find 无法按模式定位，逐个跳转已随按钮一起禁用
  if (matchMode.value !== 'literal') return
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

/** 切换匹配模式：开启一个即关闭其他；再次点击已生效的按钮则回到字面量模式 */
function toggleMode(mode: 'regex' | 'word'): void {
  matchMode.value = matchMode.value === mode ? 'literal' : mode
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceCurrent(): void {
  // 与按钮置灰保持一致：正则/全词模式下不做逐个定位替换
  if (matchMode.value !== 'literal') return
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
  const c = compiled.value
  // 非法正则：不执行任何替换
  if (c.invalid) return
  if (c.re) {
    // 正则/全词模式：以函数形式写入替换串，保证按字面量替换，不做 $1 等分组展开
    tab.content = tab.content.replace(c.re, () => r)
  } else if (caseSensitive.value) {
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

.fb-hint {
  font-size: 11px;
  color: var(--err);
  padding: 0 2px;
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
