import { reactive } from 'vue'
import { ask } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import type {
  FileNode,
  GitCommit,
  GitFileChange,
  Heading,
  MdMode,
  SearchHit,
  SidebarView,
  Tab,
  ThemeId,
} from './types'
import { baseName, fileMtimes, gitStatus, kindOf, saveSnapshot } from './tauri'

type Theme = ThemeId

function loadFlag<T extends string>(key: string, def: T): T {
  return (localStorage.getItem(key) as T | null) ?? def
}

function loadNum(key: string, def: number): number {
  const v = Number(localStorage.getItem(key))
  return Number.isFinite(v) && localStorage.getItem(key) !== null ? v : def
}

function loadList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function saveList(key: string, list: string[]) {
  localStorage.setItem(key, JSON.stringify(list))
}

export const store = reactive({
  // 工作区与文件
  root: '',
  tree: [] as FileNode[],
  tabs: [] as Tab[],
  activePath: '',
  // 侧栏视图
  sidebarView: loadFlag<SidebarView>('mdtex.sidebarView', 'files'),
  // Markdown 编辑
  mdMode: loadFlag<MdMode>('mdtex.mdMode', 'sv'),
  // 外观设置
  theme: loadFlag<Theme>('mdtex.theme', 'light'),
  accent: localStorage.getItem('mdtex.accent') || '',
  fontSize: loadNum('mdtex.fontSize', 15),
  lineHeight: loadFlag<'normal' | 'relaxed'>('mdtex.lineHeight', 'normal'),
  bgImage: localStorage.getItem('mdtex.bgImage') || '',
  bgDim: loadNum('mdtex.bgDim', 35),
  bgBlur: loadNum('mdtex.bgBlur', 0),
  /** 背景图的对象 URL（由存储的图片文件生成，运行时有效） */
  bgUrl: '',
  // 行为设置
  autoSave: loadFlag<'on' | 'off'>('mdtex.autoSave', 'on') === 'on',
  imageFolder: localStorage.getItem('mdtex.imageFolder') || 'assets',
  typewriter: loadFlag<'on' | 'off'>('mdtex.typewriter', 'off') === 'on',
  focusMode: loadFlag<'on' | 'off'>('mdtex.focusMode', 'off') === 'on',
  // 大纲
  outline: [] as Heading[],
  activeHeading: '',
  // 全文搜索
  searchQuery: '',
  searchHits: [] as SearchHit[],
  searchBusy: false,
  // Git
  gitInstalled: true,
  gitRepo: false,
  gitBranch: '',
  gitChanges: [] as GitFileChange[],
  gitHistory: [] as GitCommit[],
  gitBusy: false,
  gitMessage: '',
  // 最近打开
  recentFolders: loadList('mdtex.recentFolders'),
  recentFiles: loadList('mdtex.recentFiles'),
  // 输出日志
  logs: '',
  logVisible: false,
  // 浮层开关
  showFindBar: false,
  showQuickOpen: false,
  showPalette: false,
  /** 程序性内容替换计数（查找全部替换/外部重载时 +1，编辑器据此刷新显示） */
  contentRevision: 0,

  get active(): Tab | undefined {
    return this.tabs.find((t) => t.path === this.activePath)
  },
})

// ---------- 标签页 ----------

export function openTab(path: string, content: string, mtime: number | null = null) {
  const existing = store.tabs.find((t) => t.path === path)
  if (existing) {
    existing.externalChanged = false
    store.activePath = path
    return
  }
  store.tabs.push({
    path,
    name: baseName(path),
    kind: kindOf(path),
    content,
    savedContent: content,
    mtime,
    externalChanged: false,
  })
  store.activePath = path
  addRecentFile(path)
}

export async function closeTab(path: string): Promise<void> {
  const idx = store.tabs.findIndex((t) => t.path === path)
  if (idx < 0) return
  store.tabs.splice(idx, 1)
  if (store.activePath === path) {
    const next = store.tabs[idx] ?? store.tabs[idx - 1]
    store.activePath = next?.path ?? ''
  }
}

/** 关闭前对未保存内容弹确认（保存/丢弃） */
export async function closeTabSafe(path: string): Promise<void> {
  const tab = store.tabs.find((t) => t.path === path)
  if (tab && tab.content !== tab.savedContent) {
    const save = await ask(
      `「${tab.name}」有未保存的更改。\n\n点击“保存”将更改写入文件，点击“丢弃”直接关闭。`,
      {
        title: '关闭文件',
        kind: 'warning',
        okLabel: '保存',
        cancelLabel: '丢弃',
      },
    )
    if (save) await saveTab(tab)
  }
  await closeTab(path)
}

// ---------- 保存 ----------

export async function saveTab(tab: Tab): Promise<void> {
  if (tab.content === tab.savedContent) return
  // 保存前留一份旧版快照（本地历史），失败不阻塞保存
  if (tab.savedContent) {
    try {
      await saveSnapshot(tab.path, tab.savedContent)
    } catch {
      /* 忽略快照失败 */
    }
  }
  await writeTextFile(tab.path, tab.content)
  tab.savedContent = tab.content
  // 取写入后的真实 mtime，作为外部修改检测的基线
  fileMtimes([tab.path])
    .then((m) => {
      const t = m[tab.path]
      if (t != null) tab.mtime = t
    })
    .catch(() => {})
}

export async function saveActive(): Promise<void> {
  const t = store.active
  if (t) await saveTab(t)
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

let gitRefreshTimer: ReturnType<typeof setTimeout> | undefined

/** 保存后延迟刷新 Git 状态（避免频繁调用 git 进程） */
function scheduleGitRefresh(): void {
  clearTimeout(gitRefreshTimer)
  gitRefreshTimer = setTimeout(() => {
    refreshGit().catch(() => {})
  }, 2000)
}

/** 输入防抖自动保存 */
export function scheduleSave(delay = 1200): void {
  if (!store.autoSave) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveActive()
      .then(() => {
        if (store.gitRepo) scheduleGitRefresh()
      })
      .catch((e) => {
        store.logs = `自动保存失败：${e}`
        store.logVisible = true
      })
  }, delay)
}

// ---------- Git 状态（供状态栏与 Git 面板共享） ----------

export async function refreshGit(): Promise<void> {
  if (!store.root) {
    store.gitRepo = false
    store.gitBranch = ''
    store.gitChanges = []
    return
  }
  try {
    const st = await gitStatus(store.root)
    store.gitInstalled = true
    store.gitRepo = st.repo
    store.gitBranch = st.branch
    store.gitChanges = st.changes
  } catch {
    store.gitInstalled = false
  }
}

// ---------- 外观与设置 ----------

export function setTheme(theme: Theme) {
  store.theme = theme
  document.documentElement.dataset.theme = theme
  localStorage.setItem('mdtex.theme', theme)
}

export function setAccent(accent: string) {
  store.accent = accent
  if (accent) document.documentElement.style.setProperty('--accent', accent)
  else document.documentElement.style.removeProperty('--accent')
  localStorage.setItem('mdtex.accent', accent)
}

export function setFontSize(size: number) {
  store.fontSize = size
  document.documentElement.style.setProperty('--editor-font-size', `${size}px`)
  localStorage.setItem('mdtex.fontSize', String(size))
}

export function setLineHeight(v: 'normal' | 'relaxed') {
  store.lineHeight = v
  document.documentElement.dataset.lineHeight = v
  localStorage.setItem('mdtex.lineHeight', v)
}

export function setMdMode(mode: MdMode) {
  store.mdMode = mode
  localStorage.setItem('mdtex.mdMode', mode)
}

export function setSidebarView(v: SidebarView) {
  store.sidebarView = v
  localStorage.setItem('mdtex.sidebarView', v)
}

export function setAutoSave(on: boolean) {
  store.autoSave = on
  localStorage.setItem('mdtex.autoSave', on ? 'on' : 'off')
}

export function setImageFolder(folder: string) {
  store.imageFolder = folder || 'assets'
  localStorage.setItem('mdtex.imageFolder', store.imageFolder)
}

export function setTypewriter(on: boolean) {
  store.typewriter = on
  localStorage.setItem('mdtex.typewriter', on ? 'on' : 'off')
}

export function setFocusMode(on: boolean) {
  store.focusMode = on
  document.documentElement.dataset.focus = on ? 'on' : 'off'
  localStorage.setItem('mdtex.focusMode', on ? 'on' : 'off')
}

export function setBg(bgImage: string, bgDim: number, bgBlur: number) {
  store.bgImage = bgImage
  store.bgDim = bgDim
  store.bgBlur = bgBlur
  localStorage.setItem('mdtex.bgImage', bgImage)
  localStorage.setItem('mdtex.bgDim', String(bgDim))
  localStorage.setItem('mdtex.bgBlur', String(bgBlur))
}

// ---------- 最近打开 ----------

export function addRecentFolder(path: string) {
  store.recentFolders = [path, ...store.recentFolders.filter((p) => p !== path)].slice(0, 10)
  saveList('mdtex.recentFolders', store.recentFolders)
}

export function addRecentFile(path: string) {
  store.recentFiles = [path, ...store.recentFiles.filter((p) => p !== path)].slice(0, 10)
  saveList('mdtex.recentFiles', store.recentFiles)
}

export function removeRecentFolder(path: string) {
  store.recentFolders = store.recentFolders.filter((p) => p !== path)
  saveList('mdtex.recentFolders', store.recentFolders)
}

export function removeRecentFile(path: string) {
  store.recentFiles = store.recentFiles.filter((p) => p !== path)
  saveList('mdtex.recentFiles', store.recentFiles)
}
