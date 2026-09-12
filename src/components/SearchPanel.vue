<template>
  <div class="panel">
    <div class="panel-head">搜索</div>
    <div class="panel-body search-body">
      <div v-if="!store.root" class="placeholder">打开文件夹后可全文搜索</div>
      <template v-else>
        <div class="search-box">
          <svg class="search-ico" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            v-model="q"
            class="search-input"
            type="text"
            placeholder="搜索工作区中的文本…"
            @input="scheduleRun"
            @keydown.enter="runNow"
          />
        </div>

        <div class="replace-row">
          <input v-model="r" class="replace-input" type="text" placeholder="替换为…" @keydown.enter="replaceAll" />
          <button class="replace-btn" :disabled="!q.trim() || replaceBusy" title="在整个工作区中替换全部匹配（大小写不敏感，自动备份历史）" @click="replaceAll">
            全部替换
          </button>
        </div>

        <div v-if="store.searchBusy" class="placeholder">搜索中…</div>
        <div v-else-if="q.trim() && !groups.length" class="placeholder">无匹配结果</div>

        <template v-for="g in groups" :key="g.path">
          <div class="hit-file" :title="g.path" @click="emit('open', g.path)">
            <span class="hit-file-name">{{ baseName(g.path) }}</span>
            <span class="hit-file-count">{{ g.hits.length }}</span>
          </div>
          <div
            v-for="hit in g.hits"
            :key="hit.path + hit.line_no"
            class="hit-line"
            @click="emit('open', hit.path)"
          >
            <span class="hit-no">{{ hit.line_no }}</span>
            <span class="hit-text">
              <template v-for="(seg, i) in segments(hit.line_text)" :key="i">
                <mark v-if="seg.hit">{{ seg.t }}</mark>
                <template v-else>{{ seg.t }}</template>
              </template>
            </span>
          </div>
        </template>

        <div v-if="groups.length" class="hit-summary">
          {{ totalHits }} 处匹配 · {{ groups.length }} 个文件
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { replaceAllInWorkspace, store } from '../store'
import { baseName, searchWorkspace } from '../tauri'
import type { SearchHit } from '../types'

const emit = defineEmits<{
  (e: 'open', path: string): void
  (e: 'replaced', msg: string): void
}>()

const q = ref('')
const r = ref('')
const replaceBusy = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

const groups = computed(() => {
  const map = new Map<string, SearchHit[]>()
  for (const hit of store.searchHits) {
    const list = map.get(hit.path)
    if (list) list.push(hit)
    else map.set(hit.path, [hit])
  }
  return [...map.entries()].map(([path, hits]) => ({ path, hits }))
})

const totalHits = computed(() => store.searchHits.length)

function scheduleRun(): void {
  clearTimeout(timer)
  timer = setTimeout(runNow, 400)
}

async function runNow(): Promise<void> {
  clearTimeout(timer)
  const query = q.value.trim()
  if (!store.root || !query) {
    store.searchHits = []
    return
  }
  store.searchBusy = true
  try {
    store.searchHits = await searchWorkspace(store.root, query)
  } catch (e) {
    store.searchHits = []
    store.logs = `搜索失败：${e}`
    store.logVisible = true
  } finally {
    store.searchBusy = false
  }
}

/** 跨文件全部替换：确认弹窗与打开标签同步都在 store 里完成，这里只管触发与刷新列表 */
async function replaceAll(): Promise<void> {
  if (replaceBusy.value || !store.root || !q.value.trim()) return
  replaceBusy.value = true
  try {
    const out = await replaceAllInWorkspace(q.value.trim(), r.value)
    if (out) {
      emit('replaced', `✔ 已在 ${out.files} 个文件中替换 ${out.count} 处`)
      await runNow()
    }
  } catch (e) {
    store.logs = `替换失败：${e}`
    store.logVisible = true
  } finally {
    replaceBusy.value = false
  }
}

/** 把行文本按关键词切分为 {t, hit} 片段（大小写不敏感） */
function segments(line: string): { t: string; hit: boolean }[] {
  const query = q.value.trim()
  if (!query) return [{ t: line, hit: false }]
  const lower = line.toLowerCase()
  const needle = query.toLowerCase()
  const out: { t: string; hit: boolean }[] = []
  let pos = 0
  while (pos < line.length) {
    const idx = lower.indexOf(needle, pos)
    if (idx < 0) {
      out.push({ t: line.slice(pos), hit: false })
      break
    }
    if (idx > pos) out.push({ t: line.slice(pos, idx), hit: false })
    out.push({ t: line.slice(idx, idx + needle.length), hit: true })
    pos = idx + needle.length
  }
  return out
}
</script>

<style scoped>
.search-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.search-box {
  position: relative;
  margin-bottom: 6px;
  flex-shrink: 0;
}

.search-ico {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--muted);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 6px 8px 6px 27px;
  font: inherit;
  font-size: 13px;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  outline: none;
}

.search-input:focus {
  border-color: var(--accent);
}

.replace-row {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
  flex-shrink: 0;
}

.replace-input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  font: inherit;
  font-size: 13px;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  outline: none;
}

.replace-input:focus {
  border-color: var(--accent);
}

.replace-btn {
  flex-shrink: 0;
  font-size: 12px;
  padding: 4px 10px;
}

.hit-file {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  margin-top: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
  border-radius: 6px;
}

.hit-file:hover {
  background: var(--hover);
}

.hit-file-count {
  font-weight: 400;
  color: var(--muted);
  background: var(--hover);
  border-radius: 8px;
  padding: 0 7px;
  font-size: 11px;
}

.hit-line {
  display: flex;
  gap: 8px;
  padding: 3px 8px 3px 16px;
  cursor: pointer;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.6;
}

.hit-line:hover {
  background: var(--hover);
}

.hit-no {
  flex-shrink: 0;
  width: 28px;
  text-align: right;
  color: var(--muted);
}

.hit-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}

.hit-text mark {
  background: var(--accent-soft);
  color: var(--accent);
  border-radius: 2px;
  padding: 0 1px;
}

.hit-summary {
  margin-top: 8px;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--muted);
}
</style>
