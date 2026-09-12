<template>
  <div class="panel">
    <div class="panel-head">Git</div>
    <div class="panel-body git-body">
      <div v-if="!store.root" class="placeholder">打开文件夹后显示 Git 状态</div>

      <div v-else-if="!store.gitInstalled" class="placeholder">
        未检测到 Git。<br />请安装 Git for Windows 后重启应用。
      </div>

      <div v-else-if="!store.gitRepo" class="placeholder">
        此文件夹不是 Git 仓库。<br />可在终端执行 <code>git init</code> 后重试。
      </div>

      <template v-else>
        <div class="git-branch">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="8" r="2.5" />
            <path d="M6 8.5v7M18 10.5c0 3-4 3.5-9 4" />
          </svg>
          <b>{{ store.gitBranch || '(无分支)' }}</b>
          <span class="git-spacer" />
          <button class="mini" :disabled="store.gitBusy" title="拉取远程更新" @click="doPull">拉取</button>
          <button class="mini" :disabled="store.gitBusy" title="推送到远程" @click="doPush">推送</button>
        </div>

        <div class="git-section">更改（{{ store.gitChanges.length }}）</div>
        <div v-if="!store.gitChanges.length" class="git-empty">工作区干净，没有未提交的更改</div>
        <div
          v-for="c in store.gitChanges"
          :key="c.path"
          class="git-change"
          :title="c.path"
          @click="c.code !== 'D' && emit('open', c.path)"
        >
          <span class="git-code" :class="codeClass(c.code)">{{ c.code }}</span>
          <span class="git-path">{{ c.path }}</span>
        </div>

        <div class="git-commit">
          <textarea
            v-model="msg"
            class="git-msg"
            rows="2"
            placeholder="提交说明…（Ctrl+Enter 提交）"
            @keydown.ctrl.enter.prevent="doCommit"
          />
          <button class="commit-btn" :disabled="store.gitBusy || !msg.trim()" @click="doCommit">
            {{ store.gitBusy ? '处理中…' : '提交全部改动' }}
          </button>
        </div>

        <div class="git-section">历史</div>
        <div v-if="!store.gitHistory.length" class="git-empty">暂无提交</div>
        <div v-for="c in store.gitHistory" :key="c.hash" class="git-log" :title="c.subject">
          <span class="git-hash">{{ c.hash }}</span>
          <span class="git-subject">{{ c.subject }}</span>
          <span class="git-date">{{ c.date }}</span>
        </div>

        <div v-if="store.gitMessage" class="git-msg-out">{{ store.gitMessage }}</div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { refreshGit, store } from '../store'
import { gitRun } from '../tauri'

const emit = defineEmits<{ (e: 'open', path: string): void }>()

const msg = ref('')

onMounted(() => void refresh())
watch(() => store.root, () => void refresh())

async function refresh(): Promise<void> {
  store.gitHistory = []
  store.gitMessage = ''
  if (!store.root) return
  // 状态与历史都收敛到 store 侧实现（withHistory=true 时一并拉取提交历史）
  await refreshGit(true)
}

async function doCommit(): Promise<void> {
  const message = msg.value.trim()
  if (!message || store.gitBusy) return
  store.gitBusy = true
  store.gitMessage = ''
  try {
    const add = await gitRun(store.root, ['add', '-A'])
    if (add.code !== 0) throw new Error(add.stderr || 'add 失败')
    const commit = await gitRun(store.root, ['commit', '-m', message])
    if (commit.code !== 0) {
      store.gitMessage = (commit.stderr || commit.stdout || '提交失败').trim()
    } else {
      msg.value = ''
      store.gitMessage = '✔ 提交成功'
    }
    await refresh()
  } catch (e) {
    store.gitMessage = String(e)
  } finally {
    store.gitBusy = false
  }
}

async function doPush(): Promise<void> {
  if (store.gitBusy) return
  store.gitBusy = true
  store.gitMessage = '推送中…'
  try {
    const out = await gitRun(store.root, ['push'])
    store.gitMessage = out.code === 0 ? '✔ 推送成功' : (out.stderr || '推送失败').trim()
  } finally {
    store.gitBusy = false
  }
}

async function doPull(): Promise<void> {
  if (store.gitBusy) return
  store.gitBusy = true
  store.gitMessage = '拉取中…'
  try {
    const out = await gitRun(store.root, ['pull'])
    store.gitMessage = out.code === 0 ? '✔ 拉取成功' : (out.stderr || '拉取失败').trim()
    await refresh()
  } finally {
    store.gitBusy = false
  }
}

function codeClass(code: string): string {
  if (code === 'A') return 'add'
  if (code === 'D') return 'del'
  if (code === '?') return 'untrack'
  return 'mod'
}
</script>

<style scoped>
.git-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}

.git-branch {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  color: var(--text);
}

.git-branch svg {
  color: var(--accent);
}

.git-spacer {
  flex: 1;
}

.mini {
  font-size: 12px;
  padding: 2px 9px;
}

.git-section {
  margin: 10px 8px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.git-empty {
  padding: 2px 8px;
  font-size: 12px;
  color: var(--muted);
}

.git-change {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
}

.git-change:hover {
  background: var(--hover);
}

.git-code {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
}

.git-code.mod { color: #b5892b; background: rgba(181, 137, 43, 0.15); }
.git-code.add { color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); }
.git-code.del { color: var(--err); background: color-mix(in srgb, var(--err) 14%, transparent); }
.git-code.untrack { color: var(--muted); background: var(--hover); }
.git-code.r { color: var(--accent); background: var(--accent-soft); }

.git-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}

.git-commit {
  margin: 10px 8px 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.git-msg {
  resize: none;
  font: inherit;
  font-size: 13px;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  outline: none;
}

.git-msg:focus {
  border-color: var(--accent);
}

.commit-btn {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.commit-btn:hover:not(:disabled) {
  filter: brightness(1.08);
  background: var(--accent);
}

.git-log {
  display: flex;
  align-items: baseline;
  gap: 7px;
  padding: 3px 8px;
  border-radius: 6px;
  line-height: 1.5;
}

.git-hash {
  flex-shrink: 0;
  font-family: Consolas, monospace;
  font-size: 11px;
  color: var(--accent);
}

.git-subject {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-size: 12px;
}

.git-date {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--muted);
}

.git-msg-out {
  margin: 8px 8px 0;
  padding: 6px 8px;
  font-size: 12px;
  color: var(--muted);
  background: var(--panel-2);
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 120px;
  overflow: auto;
}
</style>
