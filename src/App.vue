<template>
  <div class="app">
    <TitleBar />

    <div class="main">
      <ActivityRail />

      <aside class="sidebar" :class="{ collapsed: store.sidebarCollapsed }">
        <FileTree v-if="store.sidebarView === 'files'" ref="treeRef" @new-file="startNewFile" @new-folder="startNewFolder" />
        <SearchPanel v-else-if="store.sidebarView === 'search'" @open="openPath" @replaced="notify" />
        <GitPanel v-else-if="store.sidebarView === 'git'" @open="openPath" />
        <OutlinePanel v-else-if="store.sidebarView === 'outline'" @jump="jumpTo" />
        <RecentPanel v-else-if="store.sidebarView === 'recent'" @open-folder="openRecentFolder" @open-file="openRecentFile" />
        <SettingsPanel v-else-if="store.sidebarView === 'settings'" />
      </aside>

      <section class="center">
        <div class="topbar">
          <template v-if="store.focusedTab?.kind === 'md'">
            <div class="seg">
              <button :class="{ on: store.mdMode === 'wysiwyg' }" @click="setMdMode('wysiwyg')">所见即所得</button>
              <button :class="{ on: store.mdMode === 'ir' }" @click="setMdMode('ir')">即时渲染</button>
              <button :class="{ on: store.mdMode === 'sv' }" @click="setMdMode('sv')">分屏预览</button>
            </div>
            <div class="export-wrap">
              <button class="outline" @click.stop="exportOpen = !exportOpen">导出 ▾</button>
              <div v-if="exportOpen" class="export-menu">
                <button class="ctx-item" @click="doExport('html')">导出 HTML</button>
                <button class="ctx-item" @click="doExport('pdf')">导出 PDF（打印）</button>
                <button class="ctx-item" @click="doExport('copy')">复制为 HTML</button>
              </div>
            </div>
          </template>
          <span class="spacer" />
          <button class="outline" title="查找 / 替换（Ctrl+F）" @click="openFind">查找</button>
          <button class="outline" title="快速打开（Ctrl+P）" @click="store.showQuickOpen = true">快速打开</button>
        </div>

        <TabsBar @ctx="onTabCtx" />

        <div class="editor-stage" :class="{ 'has-editor-bg': !!store.bgImage && !!store.bgUrl }">
          <div v-if="store.bgImage && store.bgUrl" class="editor-bg" />
          <div v-if="store.bgImage && store.bgUrl" class="editor-dim" />

          <div class="editor-area">
            <div v-if="store.focusedTab?.externalChanged" class="ext-banner">
              <span>「{{ store.focusedTab.name }}」已在外部被修改。</span>
              <span class="ext-actions">
                <button class="outline" @click="reloadExternal">重新加载</button>
                <button class="outline" @click="keepMine">保留我的版本</button>
              </span>
            </div>

            <div v-if="!store.active" class="welcome">
              <h1>MD 编辑器</h1>
              <p>本地轻量的 Markdown 写作工具</p>
              <div class="welcome-actions">
                <button class="primary big" @click="newUntitledDoc">📝 新建文档</button>
                <button class="outline big" @click="openFolder">📂 打开文件夹</button>
              </div>
              <ul>
                <li>分屏预览 / 即时渲染 / 所见即所得一键切换，KaTeX 公式渲染</li>
                <li>粘贴截图直接存图，大纲、全文搜索、Git 一应俱全</li>
                <li>Ctrl+P 快速打开 · Ctrl+F 查找替换 · Ctrl+Shift+P 命令面板</li>
              </ul>
            </div>
            <template v-else-if="store.splitView">
              <div class="panes">
                <div
                  class="pane"
                  :class="{ focused: store.focusedPane === 'primary' }"
                  @mousedown="setFocusedPane('primary')"
                >
                  <MarkdownEditor
                    v-if="store.active.kind === 'md'"
                    ref="mdApi"
                    :key="'p' + store.active.path + store.theme"
                    :path="store.active.path"
                    :value="store.active.content"
                    :revision="store.contentRevision"
                    :focused="store.focusedPane !== 'secondary'"
                    @update="onInputPrimary"
                  />
                  <TextEditor
                    v-else-if="store.active.kind === 'text'"
                    :key="'tp' + store.active.path + store.theme + textTick"
                    :path="store.active.path"
                    :value="store.active.content"
                    :revision="store.contentRevision"
                    :vim="store.vimMode"
                    @update="onInputPrimary"
                  />
                  <div v-else class="pane-empty">该文件类型暂不支持编辑</div>
                </div>
                <div class="pane-divider" />
                <div
                  class="pane"
                  :class="{ focused: store.focusedPane === 'secondary' }"
                  @mousedown="setFocusedPane('secondary')"
                >
                  <div class="pane-head">
                    <span class="pane-title" :title="store.secondary?.path">{{ store.secondary?.name ?? '副窗格' }}</span>
                    <button class="outline" @click="toggleSplitView()">退出分屏</button>
                  </div>
                  <template v-if="store.secondary">
                    <MarkdownEditor
                      v-if="store.secondary.kind === 'md'"
                      ref="mdApiSec"
                      :key="'s' + store.secondary.path + store.theme"
                      :path="store.secondary.path"
                      :value="store.secondary.content"
                      :revision="store.contentRevision"
                      :focused="store.focusedPane === 'secondary'"
                      @update="onInputSecondary"
                    />
                    <TextEditor
                      v-else-if="store.secondary.kind === 'text'"
                      :key="'ts' + store.secondary.path + store.theme + textTick"
                      :path="store.secondary.path"
                      :value="store.secondary.content"
                      :revision="store.contentRevision"
                      :vim="store.vimMode"
                      @update="onInputSecondary"
                    />
                    <div v-else class="pane-empty">该文件类型暂不支持编辑</div>
                  </template>
                  <div v-else class="pane-empty">在标签页右键选择「在右窗格打开」<br />开启另一个文件同时编辑</div>
                </div>
              </div>
            </template>
            <template v-else>
              <MarkdownEditor
                v-if="store.active.kind === 'md'"
                ref="mdApi"
                :key="store.active.path + store.theme"
                :path="store.active.path"
                :value="store.active.content"
                :revision="store.contentRevision"
                :focused="true"
                @update="onInputPrimary"
              />
              <TextEditor
                v-else-if="store.active.kind === 'text'"
                :key="'t' + store.active.path + store.theme + textTick"
                :path="store.active.path"
                :value="store.active.content"
                :revision="store.contentRevision"
                :vim="store.vimMode"
                @update="onInputPrimary"
              />
              <div v-else class="welcome">
                <p>该文件类型暂不支持编辑（仅支持 Markdown 与文本类文件）</p>
              </div>
            </template>
          </div>
        </div>

        <LogPanel v-if="store.logVisible" />
      </section>
    </div>

    <footer class="statusbar">
      <span>{{ store.root ? baseName(store.root) : '未打开文件夹' }}</span>
      <span v-if="store.gitRepo && store.gitBranch" class="branch" :title="'分支：' + store.gitBranch">
        ⑂ {{ store.gitBranch }}
      </span>
      <span class="spacer" />
      <span class="flash">{{ flash }}</span>
      <span v-if="store.vimMode && store.focusedTab?.kind === 'text'" class="vim-badge" title="Vim 模式（纯文本编辑器）">VIM</span>
      <span v-if="store.focusedTab">
        <template v-if="stats">{{ stats.chars }} 字 · {{ stats.words }} 词 · 约 {{ stats.minutes }} 分钟 · </template>
        <span :class="{ dirty: dirty }">{{ dirty ? '未保存' : '已保存' }}</span>
      </span>
    </footer>

    <FindBar />
    <QuickOpen />
    <CommandPalette :commands="commands" />

    <ContextMenu
      v-if="ctx"
      :x="ctx.x"
      :y="ctx.y"
      :items="ctx.items"
      @close="ctx = null"
    />
    <InputModal
      v-if="modal"
      :title="modal.title"
      :placeholder="modal.placeholder"
      :initial="modal.initial"
      :ok-label="modal.okLabel"
      @confirm="modal.onConfirm"
      @cancel="modal = null"
    />

    <CloseConfirm v-if="showCloseConfirm" @choice="onCloseChoice" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { ask } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import {
  actionForCombo,
  addRecentFolder,
  closeTab,
  closeTabSafe,
  comboFromEvent,
  confirmOpenLarge,
  isUntitled,
  newUntitledDoc,
  openInSecondaryPane,
  openTab,
  refreshGit,
  restoreSession,
  saveActive,
  saveTab,
  saveTabAs,
  schedulePersistSession,
  scheduleSave,
  setAutoSave,
  setFocusedPane,
  setFocusMode,
  setMdMode,
  setSidebarView,
  setTheme,
  setTypewriter,
  setVimMode,
  store,
  toggleSidebarCollapsed,
  toggleSplitView,
  type ActionId,
} from './store'
import {
  baseName,
  createFile,
  createFolder,
  deleteEntry,
  fileMtimes,
  isTextFile,
  joinPath,
  parentDir,
  pickFile,
  pickFolder,
  pickSaveFile,
  readDirShallow,
  renameEntry,
} from './tauri'
import { buildStandaloneHtml, inlineWorkspaceImages, printHtml } from './export'
import { openFileInNewWindow } from './multiwindow'
import type { FileNode, Heading } from './types'
import TitleBar from './components/TitleBar.vue'
import ActivityRail from './components/ActivityRail.vue'
import FileTree from './components/FileTree.vue'
import SearchPanel from './components/SearchPanel.vue'
import GitPanel from './components/GitPanel.vue'
import OutlinePanel from './components/OutlinePanel.vue'
import RecentPanel from './components/RecentPanel.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import TabsBar from './components/TabsBar.vue'
import MarkdownEditor from './components/MarkdownEditor.vue'
import TextEditor from './components/TextEditor.vue'
import LogPanel from './components/LogPanel.vue'
import FindBar from './components/FindBar.vue'
import QuickOpen from './components/QuickOpen.vue'
import CommandPalette, { type CommandItem } from './components/CommandPalette.vue'
import ContextMenu from './components/ContextMenu.vue'
import CloseConfirm from './components/CloseConfirm.vue'
import InputModal from './components/InputModal.vue'

interface CtxItem {
  label?: string
  danger?: boolean
  sep?: boolean
  action?: () => void
}

const treeRef = ref<InstanceType<typeof FileTree>>()

interface MdApi {
  getHtmlPortable: () => string
  refreshValue: () => void
  jumpTo: (h: Heading) => void
}
const mdApi = ref<MdApi | null>(null)
const mdApiSec = ref<MdApi | null>(null)

/** 聚焦窗格的 Markdown 编辑器实例（大纲跳转 / 导出都作用于聚焦窗格） */
function focusedMdApi(): MdApi | null {
  return store.focusedPane === 'secondary' ? mdApiSec.value : mdApi.value
}

const ctx = ref<{ x: number; y: number; items: CtxItem[] } | null>(null)
const modal = ref<{
  title: string
  placeholder?: string
  initial?: string
  okLabel?: string
  onConfirm: (v: string) => void
} | null>(null)
const exportOpen = ref(false)
const textTick = ref(0)
const flash = ref('')
const showCloseConfirm = ref(false)
let flashTimer: ReturnType<typeof setTimeout> | undefined
let unlistenFns: Array<() => void> = []

const dirty = computed(() => {
  const tab = store.focusedTab
  return !!tab && tab.content !== tab.savedContent
})

/** 中英混合字数统计：去空白字符数、中文按字 + 英文按词、预计阅读时长 */
const stats = computed(() => {
  const tab = store.focusedTab
  if (!tab || tab.kind !== 'md') return null
  const text = tab.content
  const chars = text.replace(/\s/g, '').length
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) ?? []).length
  const latin = (text.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) ?? []).length
  const words = cjk + latin
  return { chars, words, minutes: words === 0 ? 0 : Math.max(1, Math.round(words / 300)) }
})

function notify(msg: string): void {
  flash.value = msg
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    if (flash.value === msg) flash.value = ''
  }, 2500)
}

// ---------- 工作区与文件打开 ----------

async function openFolder(): Promise<void> {
  const dir = await pickFolder()
  if (dir) await setRootAndLoad(dir)
}

async function setRootAndLoad(dir: string): Promise<void> {
  store.root = dir
  store.tree = await readDirShallow(dir)
  addRecentFolder(dir)
  refreshGit().catch(() => {})
}

async function openFileAbs(abs: string): Promise<void> {
  try {
    const content = await readTextFile(abs)
    // 超大文件实时渲染会卡顿，先征求用户同意
    if (!(await confirmOpenLarge(baseName(abs), content))) return
    const mt = await fileMtimes([abs])
    openTab(abs, content, mt[abs] ?? null)
  } catch (e) {
    store.logs = String(e)
    store.logVisible = true
  }
}

function openPath(p: string): void {
  // 全文搜索/Git 面板传来的路径可能是绝对路径或相对工作区的路径
  const abs = /^([a-zA-Z]:[\\/]|\/)/.test(p) ? p : joinPath(store.root, p)
  void openFileAbs(abs.replaceAll('/', '\\'))
}

async function openRecentFolder(dir: string): Promise<void> {
  await setRootAndLoad(dir)
}

async function openRecentFile(f: string): Promise<void> {
  await setRootAndLoad(parentDir(f))
  await openFileAbs(f)
}

async function openFileViaDialog(): Promise<void> {
  const f = await pickFile([
    { name: 'Markdown', extensions: ['md', 'markdown'] },
    { name: '文本文件', extensions: ['txt', 'log', 'json', 'toml', 'yaml', 'yml', 'html', 'css', 'js', 'ts', 'csv', 'cfg'] },
    { name: '所有文件', extensions: ['*'] },
  ])
  if (f) await openRecentFile(f)
}

// ---------- 拖拽 / 外部路径打开（拖进窗口与单实例转发共用同一入口） ----------

/** 无扩展名的路径按目录处理 */
function isDirLike(p: string): boolean {
  return !baseName(p).includes('.')
}

async function openDroppedPaths(paths: string[]): Promise<void> {
  let unsupported = 0
  for (const p of paths) {
    if (isTextFile(baseName(p))) {
      await openRecentFile(p)
    } else if (isDirLike(p)) {
      try {
        await setRootAndLoad(p)
      } catch {
        store.root = ''
        unsupported += 1
      }
    } else {
      unsupported += 1
    }
  }
  if (unsupported) notify('仅支持拖入 Markdown / 文本文件与文件夹')
}

// ---------- 窗口关闭保护 ----------

async function onCloseChoice(choice: 'save' | 'discard' | 'cancel'): Promise<void> {
  showCloseConfirm.value = false
  if (choice === 'cancel') return
  if (choice === 'save') {
    // 逐个保存；未命名文档会弹保存对话框，用户取消则中止关闭
    for (const t of [...store.tabs]) {
      if (t.content !== t.savedContent) {
        const ok = await saveTab(t)
        if (!ok) return
      }
    }
  }
  void getCurrentWebviewWindow().destroy()
}

/** 恢复会话后补载文件树与 Git 状态（不写最近列表） */
async function fillTree(): Promise<void> {
  try {
    store.tree = await readDirShallow(store.root)
  } catch {
    store.root = ''
  }
  refreshGit().catch(() => {})
}

/** 主窗格输入：写入活动标签并调度它自己的自动保存 */
function onInputPrimary(value: string): void {
  const tab = store.active
  if (!tab) return
  tab.content = value
  scheduleSave(1200, tab)
}

/** 副窗格输入：写入副窗格标签（绝不能写进活动标签，否则分屏下会互相覆盖文件） */
function onInputSecondary(value: string): void {
  const tab = store.secondary
  if (!tab) return
  tab.content = value
  scheduleSave(1200, tab)
}

// ---------- 大纲 ----------

function jumpTo(h: Heading): void {
  focusedMdApi()?.jumpTo(h)
}

// ---------- 查找 / 命令面板 / 快速打开 ----------

function openFind(): void {
  const tab = store.focusedTab
  if (!tab) return
  if (tab.kind === 'md') store.showFindBar = true
  else notify('文本文件请直接按 Ctrl+F 使用内置搜索')
}

// ---------- 导出 ----------

async function currentHtml(): Promise<string | null> {
  const tab = store.focusedTab
  if (!tab || tab.kind !== 'md') return null
  const body = focusedMdApi()?.getHtmlPortable() ?? ''
  if (!body.trim()) {
    notify('未能获取渲染内容')
    return null
  }
  try {
    const inlined = await inlineWorkspaceImages(body, store.root)
    return await buildStandaloneHtml(tab.name.replace(/\.(md|markdown)$/i, ''), inlined)
  } catch (e) {
    store.logs = `导出失败：${e}`
    store.logVisible = true
    return null
  }
}

async function doExport(kind: 'html' | 'pdf' | 'copy'): Promise<void> {
  exportOpen.value = false
  const tab = store.focusedTab
  if (!tab) return
  const html = await currentHtml()
  if (!html) return
  const base = tab.name.replace(/\.(md|markdown)$/i, '')
  try {
    if (kind === 'html') {
      const target = await pickSaveFile(base + '.html', [{ name: 'HTML', extensions: ['html'] }])
      if (!target) return
      await writeTextFile(target, html)
      notify('✔ 已导出 HTML')
    } else if (kind === 'pdf') {
      await printHtml(html)
      notify('已调起打印，可选择“另存为 PDF”')
    } else {
      await navigator.clipboard.writeText(html)
      notify('✔ HTML 已复制到剪贴板')
    }
  } catch (e) {
    store.logs = `导出失败：${e}`
    store.logVisible = true
  }
}

// ---------- 外部修改检测 ----------

let pollTimer: ReturnType<typeof setInterval> | undefined

async function pollExternalChanges(): Promise<void> {
  // 未命名文档没有磁盘路径，不参与 mtime 轮询（否则会误报外部修改）
  const textTabs = store.tabs.filter(
    (t) => (t.kind === 'md' || t.kind === 'text') && !isUntitled(t.path),
  )
  if (!textTabs.length) return
  try {
    const mt = await fileMtimes(textTabs.map((t) => t.path))
    for (const tab of textTabs) {
      const t = mt[tab.path]
      if (t == null) {
        tab.externalChanged = true
      } else if (tab.mtime != null && t - tab.mtime > 1000) {
        tab.externalChanged = true
      }
    }
  } catch {
    /* 轮询失败忽略 */
  }
}

async function reloadExternal(): Promise<void> {
  const tab = store.focusedTab
  if (!tab) return
  try {
    const content = await readTextFile(tab.path)
    tab.content = content
    tab.savedContent = content
    tab.externalChanged = false
    const mt = await fileMtimes([tab.path])
    const t = mt[tab.path]
    if (t != null) tab.mtime = t
    if (tab.kind === 'md') store.contentRevision++
    else textTick.value++
    notify('已重新加载外部修改')
  } catch (e) {
    store.logs = `重新加载失败：${e}`
    store.logVisible = true
  }
}

function keepMine(): void {
  const tab = store.focusedTab
  if (!tab) return
  tab.externalChanged = false
  tab.mtime = Date.now()
  notify('已保留当前内容，保存时将覆盖外部修改')
}

// ---------- 文件树右键管理 ----------

provide('openTreeCtx', (x: number, y: number, node: FileNode) => {
  const dir = node.isDir ? node.path : parentDir(node.path)
  const items: CtxItem[] = []
  if (node.isDir) {
    items.push(
      { label: '新建文件', action: () => startNewFile(dir) },
      { label: '新建文件夹', action: () => startNewFolder(dir) },
      { sep: true },
    )
  } else {
    items.push({ label: '在新窗口打开', action: () => openFileInNewWindow(node.path) })
  }
  items.push(
    { label: '重命名', action: () => startRename(node) },
    { label: '删除', danger: true, action: () => startDelete(node) },
    { sep: true },
    {
      label: '在资源管理器中显示',
      action: () => {
        revealItemInDir(node.path).catch((e) => {
          store.logs = String(e)
          store.logVisible = true
        })
      },
    },
  )
  ctx.value = { x, y, items }
})

function askName(title: string, initial: string, cb: (v: string) => void, placeholder = ''): void {
  modal.value = {
    title,
    initial,
    placeholder,
    okLabel: '确定',
    onConfirm: (v) => {
      modal.value = null
      cb(v)
    },
  }
}

function startNewFile(dir: string): void {
  askName('新建文件（默认保存为 .md）', '', (name) => {
    if (!name) return
    const withExt = name.includes('.') ? name : name + '.md'
    const target = joinPath(dir, withExt)
    void (async () => {
      try {
        await createFile(target)
        await treeRef.value?.reloadDir(dir)
        await openFileAbs(target)
        notify('✔ 已创建 ' + baseName(target))
      } catch (e) {
        store.logs = String(e)
        store.logVisible = true
      }
    })()
  }, '文件名')
}

function startNewFolder(dir: string): void {
  askName('新建文件夹', '', (name) => {
    if (!name) return
    void (async () => {
      try {
        await createFolder(joinPath(dir, name))
        await treeRef.value?.reloadDir(dir)
        notify('✔ 已创建文件夹 ' + name)
      } catch (e) {
        store.logs = String(e)
        store.logVisible = true
      }
    })()
  }, '文件夹名')
}

function startRename(node: FileNode): void {
  askName(`重命名「${node.name}」`, node.name, (name) => {
    if (!name || name === node.name) return
    const target = joinPath(parentDir(node.path), name)
    void (async () => {
      try {
        await renameEntry(node.path, target)
        for (const t of store.tabs) {
          if (t.path === node.path) {
            t.path = target
            t.name = baseName(target)
          } else if (t.path.startsWith(node.path + '\\')) {
            t.path = target + t.path.slice(node.path.length)
            t.name = baseName(t.path)
          }
        }
        if (store.activePath === node.path) store.activePath = target
        await treeRef.value?.reloadDir(parentDir(node.path))
        refreshGit().catch(() => {})
      } catch (e) {
        store.logs = String(e)
        store.logVisible = true
      }
    })()
  })
}

function startDelete(node: FileNode): void {
  void (async () => {
    const ok = await ask(`确定删除「${node.name}」吗？${node.isDir ? '文件夹及其全部内容' : '此操作不可恢复'}。`, {
      title: '删除',
      kind: 'warning',
      okLabel: '删除',
      cancelLabel: '取消',
    })
    if (!ok) return
    try {
      await deleteEntry(node.path, node.isDir)
      for (const t of [...store.tabs]) {
        if (t.path === node.path || t.path.startsWith(node.path + '\\')) {
          await closeTab(t.path)
        }
      }
      await treeRef.value?.reloadDir(parentDir(node.path))
      refreshGit().catch(() => {})
    } catch (e) {
      store.logs = String(e)
      store.logVisible = true
    }
  })()
}

// ---------- 标签页右键 ----------

function onTabCtx(x: number, y: number, tab: import('./types').Tab): void {
  const idx = store.tabs.findIndex((t) => t.path === tab.path)
  const closeOthers = async () => {
    for (const t of [...store.tabs]) {
      if (t.path !== tab.path) await closeTabSafe(t.path)
    }
  }
  const closeRight = async () => {
    for (const t of [...store.tabs].slice(idx + 1)) await closeTabSafe(t.path)
  }
  // 未命名文档没有磁盘路径，隐藏依赖真实路径的菜单项
  const untitled = isUntitled(tab.path)
  const items: CtxItem[] = []
  if (!untitled) items.push({ label: '在新窗口打开', action: () => openFileInNewWindow(tab.path) })
  items.push({ label: '在右窗格打开', action: () => openInSecondaryPane(tab.path) })
  items.push(
    {
      label: '另存为',
      action: () => {
        void saveTabAs(tab).then((ok) => {
          if (ok) notify('✔ 已另存')
        })
      },
    },
    { label: '关闭', action: () => void closeTabSafe(tab.path) },
    { label: '关闭其他', action: () => void closeOthers() },
    { label: '关闭右侧', action: () => void closeRight() },
  )
  if (!untitled) {
    items.push(
      { sep: true },
      {
        label: '复制文件路径',
        action: () => {
          navigator.clipboard.writeText(tab.path)
          notify('路径已复制')
        },
      },
      {
        label: '在资源管理器中显示',
        action: () => {
          revealItemInDir(tab.path).catch((e) => {
            store.logs = String(e)
            store.logVisible = true
          })
        },
      },
    )
  }
  ctx.value = { x, y, items }
}

// ---------- 命令面板 ----------

const commands = computed<CommandItem[]>(() => [
  { id: 'open-folder', label: '打开文件夹', keywords: 'folder open', run: () => void openFolder() },
  { id: 'open-file', label: '打开文件…', keywords: 'open file ctrl o', run: () => void openFileViaDialog() },
  { id: 'quick-open', label: '快速打开文件…', keywords: 'goto ctrl p', run: () => (store.showQuickOpen = true) },
  {
    id: 'open-new-window',
    label: '在新窗口打开当前文件',
    keywords: 'new window',
    run: () => {
      if (store.focusedTab) openFileInNewWindow(store.focusedTab.path)
      else notify('先打开一个文件')
    },
  },
  { id: 'find', label: '查找 / 替换…', keywords: 'search replace ctrl f', run: openFind },
  { id: 'new-doc', label: '新建文档（保存时选择位置）', keywords: 'new document ctrl n', run: () => newUntitledDoc() },
  // 未打开工作区时「新建文件」无处落盘，转为新建未命名文档
  { id: 'new-file', label: '新建文件', keywords: 'new file', run: () => (store.root ? startNewFile(store.root) : newUntitledDoc()) },
  { id: 'new-folder', label: '新建文件夹', keywords: 'new folder', run: () => startNewFolder(store.root || '') },
  { id: 'mode-wysiwyg', label: '切换到所见即所得', run: () => setMdMode('wysiwyg') },
  { id: 'mode-ir', label: '切换到即时渲染', run: () => setMdMode('ir') },
  { id: 'mode-sv', label: '切换到分屏预览', run: () => setMdMode('sv') },
  {
    id: 'theme-toggle',
    label: '切换亮色 / 暗色主题',
    run: () => setTheme(store.theme === 'dark' || store.theme === 'ink' ? 'light' : 'dark'),
  },
  { id: 'export-html', label: '导出 HTML', run: () => void doExport('html') },
  { id: 'export-pdf', label: '导出 PDF（打印）', run: () => void doExport('pdf') },
  { id: 'export-copy', label: '复制为 HTML', run: () => void doExport('copy') },
  { id: 'typewriter', label: (store.typewriter ? '关闭' : '开启') + '打字机模式', run: () => setTypewriter(!store.typewriter) },
  { id: 'focus', label: (store.focusMode ? '关闭' : '开启') + '专注模式', run: () => setFocusMode(!store.focusMode) },
  { id: 'autosave', label: (store.autoSave ? '关闭' : '开启') + '自动保存', run: () => setAutoSave(!store.autoSave) },
  { id: 'vim', label: (store.vimMode ? '关闭' : '开启') + 'Vim 模式（纯文本编辑器）', keywords: 'vim modal edit', run: () => setVimMode(!store.vimMode) },
  { id: 'split', label: (store.splitView ? '关闭' : '开启') + '双栏分屏', keywords: 'split pane 双栏', run: () => toggleSplitView() },
  { id: 'collapse-sidebar', label: (store.sidebarCollapsed ? '展开' : '收起') + '侧栏', keywords: 'sidebar collapse 侧栏', run: () => toggleSidebarCollapsed() },
  { id: 'view-git', label: '显示 Git 面板', run: () => setSidebarView('git') },
  { id: 'view-search', label: '显示全文搜索', run: () => setSidebarView('search') },
  { id: 'view-outline', label: '显示大纲', run: () => setSidebarView('outline') },
  { id: 'view-recent', label: '显示最近打开', run: () => setSidebarView('recent') },
  { id: 'view-settings', label: '打开设置', run: () => setSidebarView('settings') },
  { id: 'save', label: '保存当前文件', run: () => runAction('save') },
  { id: 'save-as', label: '另存为…', keywords: 'save as', run: () => runAction('saveAs') },
])

// ---------- 全局快捷键 ----------

function runAction(action: ActionId): void {
  switch (action) {
    case 'palette':
      store.showPalette = !store.showPalette
      break
    case 'quickOpen':
      store.showQuickOpen = !store.showQuickOpen
      break
    case 'find':
      openFind()
      break
    case 'newDoc':
      newUntitledDoc()
      break
    case 'openFile':
      void openFileViaDialog()
      break
    case 'save':
      saveActive()
        .then((saved) => {
          if (saved) notify('✔ 已保存')
        })
        .catch((err) => {
          store.logs = `保存失败：${err}`
          store.logVisible = true
        })
      break
    case 'saveAs':
      if (!store.focusedTab) {
        notify('先打开一个文件')
        break
      }
      saveTabAs(store.focusedTab)
        .then((ok) => {
          if (ok) notify('✔ 已另存')
        })
        .catch((err) => {
          store.logs = `另存为失败：${err}`
          store.logVisible = true
        })
      break
    case 'toggleSidebar':
      toggleSidebarCollapsed()
      break
    case 'toggleSplit':
      if (store.splitView || store.tabs.length >= 2) toggleSplitView()
      else notify('至少打开两个文件才能分屏')
      break
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.defaultPrevented) return
  if (e.key === 'Escape') exportOpen.value = false
  const action = actionForCombo(comboFromEvent(e))
  // 文本文件的查找交给 CodeMirror 内置搜索
  if (!action || (action === 'find' && store.focusedTab?.kind !== 'md')) return
  e.preventDefault()
  runAction(action)
}

// ---------- 生命周期 ----------

function onWindowFocus(): void {
  void treeRef.value?.refreshRoot()
  refreshGit().catch(() => {})
}

// 标签与工作区的任何变化 → 防抖持久化会话（仅主窗口实际写盘）
watch([() => store.root, () => store.activePath, () => store.tabs], () => schedulePersistSession(), {
  deep: true,
})

// 分屏下从标签栏点到「副窗格正在显示的文件」：把原主窗格文件挪去副窗格，避免两窗格显示同一文件
watch(
  () => store.activePath,
  (now, before) => {
    if (store.splitView && now && now === store.secondaryPath && before && before !== now) {
      store.secondaryPath = before
    }
  },
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('focus', onWindowFocus)
  pollTimer = setInterval(() => void pollExternalChanges(), 3000)
  // 多窗口：?file= 启动参数 → 以文件所在目录为工作区，单标签打开
  const bootFile = new URLSearchParams(window.location.search).get('file')
  if (bootFile) {
    void openRecentFile(bootFile)
  } else {
    // 主窗口：恢复上次会话（含未命名文档草稿），随后补载文件树
    void restoreSession().then((ok) => {
      if (ok && store.root) void fillTree()
      schedulePersistSession(0)
    })
  }
  // 窗口关闭保护：有未保存内容时拦截，弹三选确认
  void getCurrentWebviewWindow()
    .onCloseRequested((event) => {
      if (!store.tabs.some((t) => t.content !== t.savedContent)) return
      event.preventDefault()
      showCloseConfirm.value = true
    })
    .then((un) => unlistenFns.push(un))
  // 拖拽文件 / 文件夹进窗口打开
  void getCurrentWebview()
    .onDragDropEvent((event) => {
      const payload = event.payload
      if (payload.type !== 'drop' || !payload.paths.length) return
      void openDroppedPaths([...payload.paths])
    })
    .then((un) => unlistenFns.push(un))
  // 单实例 / 文件关联：Rust 侧转发来的打开路径
  void listen<string[]>('open-paths', (e) => {
    if (Array.isArray(e.payload) && e.payload.length) void openDroppedPaths(e.payload)
  }).then((un) => unlistenFns.push(un))
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('focus', onWindowFocus)
  clearInterval(pollTimer)
  for (const un of unlistenFns) un()
})
</script>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.main {
  flex: 1;
  display: flex;
  min-height: 0;
}

.sidebar {
  width: 260px;
  flex-shrink: 0;
  background: var(--panel);
  border-right: 1px solid var(--border);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: width 0.15s ease;
}

.sidebar.collapsed {
  width: 0;
  border-right: none;
}

.center {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  position: relative;
  z-index: 5;
}

.seg {
  display: flex;
}

.seg button {
  border-radius: 0;
  margin-left: -1px;
  border-color: var(--border);
}

.seg button:first-child {
  border-radius: var(--radius) 0 0 var(--radius);
  margin-left: 0;
}

.seg button:last-child {
  border-radius: 0 var(--radius) var(--radius) 0;
}

.export-wrap {
  position: relative;
}

.export-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 190px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow-2);
  padding: 5px;
  z-index: 50;
}

.big {
  font-size: 15px;
  padding: 8px 20px;
}

.welcome-actions {
  display: flex;
  gap: 10px;
}

.spacer {
  flex: 1;
}

.editor-area {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 1;
}

/* 双栏分屏 */
.panes {
  flex: 1;
  min-height: 0;
  display: flex;
}

.pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* 聚焦窗格顶部细高亮条 */
.pane.focused {
  box-shadow: inset 0 2px 0 var(--accent);
}

.pane-divider {
  width: 1px;
  background: var(--border);
  flex-shrink: 0;
}

.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 10px;
  font-size: 12px;
  color: var(--muted);
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.pane-head button {
  font-size: 11px;
  padding: 1px 8px;
}

.pane-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pane-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  font-size: 13px;
  padding: 16px;
  text-align: center;
  line-height: 2;
}

.vim-badge {
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 8px;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 600;
}

.ext-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 14px;
  font-size: 13px;
  background: color-mix(in srgb, #b5892b 14%, var(--panel));
  border-bottom: 1px solid #b5892b;
  color: var(--text);
  flex-shrink: 0;
}

.ext-actions {
  display: flex;
  gap: 6px;
}

.statusbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 3px 12px;
  font-size: 12px;
  color: var(--muted);
  background: var(--panel);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
}

.branch {
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 8px;
  padding: 0 8px;
  font-size: 11px;
}

.flash {
  color: var(--ok);
}

.dirty {
  color: var(--accent);
}

.welcome {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--muted);
  padding: 24px;
  text-align: center;
}

.welcome h1 {
  color: var(--text);
  margin: 0;
}

.welcome ul {
  text-align: left;
  line-height: 2;
  max-width: 560px;
}
</style>
