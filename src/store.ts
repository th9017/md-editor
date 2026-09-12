import { computed, reactive } from 'vue'
import { ask } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
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
import {
  baseName,
  fileMtimes,
  gitRun,
  gitStatus,
  isTextFile,
  kindOf,
  loadSession,
  parentDir,
  pickSaveFile,
  readDirShallow,
  replaceWorkspace,
  saveSession,
  saveSnapshot,
} from './tauri'

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

// ---------- 快捷键 ----------

export type ActionId =
  | 'palette'
  | 'quickOpen'
  | 'find'
  | 'newDoc'
  | 'openFile'
  | 'save'
  | 'saveAs'
  | 'toggleSidebar'
  | 'toggleSplit'

/** 应用级全局动作清单（Vditor / CodeMirror 编辑器内置键位不在此列，无法改绑） */
export const ACTIONS: { id: ActionId; label: string }[] = [
  { id: 'palette', label: '命令面板' },
  { id: 'quickOpen', label: '快速打开' },
  { id: 'find', label: '查找 / 替换' },
  { id: 'newDoc', label: '新建文档' },
  { id: 'openFile', label: '打开文件' },
  { id: 'save', label: '保存' },
  { id: 'saveAs', label: '另存为' },
  { id: 'toggleSidebar', label: '收起 / 展开侧栏' },
  { id: 'toggleSplit', label: '开启 / 关闭双栏分屏' },
]

export const DEFAULT_KEYMAP: Record<ActionId, string> = {
  palette: 'Ctrl+Shift+P',
  quickOpen: 'Ctrl+P',
  find: 'Ctrl+F',
  newDoc: 'Ctrl+N',
  openFile: 'Ctrl+O',
  save: 'Ctrl+S',
  saveAs: 'Ctrl+Shift+S',
  toggleSidebar: 'Ctrl+B',
  toggleSplit: 'Ctrl+\\',
}

/** 读 localStorage 的用户键位覆盖，并与默认表合并（防止旧数据缺项） */
function loadKeymap(): Record<ActionId, string> {
  const merged = { ...DEFAULT_KEYMAP }
  try {
    const saved = JSON.parse(localStorage.getItem('mdtex.keymap') ?? '{}') as unknown
    if (saved && typeof saved === 'object') {
      for (const a of ACTIONS) {
        const v = (saved as Record<string, unknown>)[a.id]
        if (typeof v === 'string' && v) merged[a.id] = v
      }
    }
  } catch {
    /* 损坏的键位数据按默认表处理 */
  }
  return merged
}

/** 修改一个动作的绑定并持久化；返回冲突提示文案，null 表示成功 */
export function setKeybinding(action: ActionId, keys: string): string | null {
  const clash = ACTIONS.find((a) => a.id !== action && store.keymap[a.id] === keys)
  if (clash) return `与「${clash.label}」冲突，未修改`
  store.keymap[action] = keys
  localStorage.setItem('mdtex.keymap', JSON.stringify(store.keymap))
  return null
}

export function resetKeybindings(): void {
  for (const a of ACTIONS) store.keymap[a.id] = DEFAULT_KEYMAP[a.id]
  localStorage.setItem('mdtex.keymap', JSON.stringify(store.keymap))
}

/** KeyboardEvent → 归一化组合键（如 "Ctrl+Shift+P"）；纯修饰键返回 '' */
export function comboFromEvent(e: KeyboardEvent): string {
  const k = e.key
  if (!k || k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta') return ''
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Win')
  parts.push(k.length === 1 ? k.toUpperCase() : k === ' ' ? 'Space' : k)
  return parts.join('+')
}

/** 组合键 → 动作（查当前键位表） */
export function actionForCombo(combo: string): ActionId | null {
  return ACTIONS.find((a) => store.keymap[a.id] === combo)?.id ?? null
}

export const store = reactive({
  // 工作区与文件
  root: '',
  tree: [] as FileNode[],
  tabs: [] as Tab[],
  activePath: '',
  // 侧栏视图
  sidebarView: loadFlag<SidebarView>('mdtex.sidebarView', 'files'),
  // Markdown 编辑（默认所见即所得；仅在设置里切换过的用户保留自己的选择）
  mdMode: loadFlag<MdMode>('mdtex.mdMode', 'wysiwyg'),
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
  /** Vim 模式（仅作用于 CodeMirror 纯文本编辑器；Vditor 无 Vim 支持） */
  vimMode: loadFlag<'on' | 'off'>('mdtex.vimMode', 'off') === 'on',
  /** 侧栏收起（每窗口独立，与 sidebarView 同策略） */
  sidebarCollapsed: loadFlag<'on' | 'off'>('mdtex.sidebarCollapsed', 'off') === 'on',
  // 双栏分屏
  splitView: false,
  /** 副窗格显示的标签路径（'' = 副窗格空置） */
  secondaryPath: '',
  /** 分屏下当前聚焦的窗格：保存/查找/导出/大纲/状态栏都跟随它 */
  focusedPane: 'primary' as 'primary' | 'secondary',
  // 快捷键绑定（mdtex.keymap 覆盖默认表）
  keymap: loadKeymap(),
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

  get secondary(): Tab | undefined {
    return this.tabs.find((t) => t.path === this.secondaryPath)
  },

  /** 分屏下聚焦窗格对应的标签；未分屏时恒等于主窗格（active） */
  get focusedTab(): Tab | undefined {
    return this.focusedPane === 'secondary' ? this.secondary : this.active
  },
})

// ---------- 标签页 ----------

/** 输出错误到日志面板（各处 store.logs=…; logVisible=true 样板的统一入口） */
export function logError(msg: string): void {
  store.logs = msg
  store.logVisible = true
}

/** 读磁盘文件并打开为标签：类型检查 + 超大文件确认 + mtime 基线。
 *  文件树 / 快速打开 / 搜索与 Git 面板 / 系统对话框共用这一条打开路径。返回是否成功打开。 */
export async function openFileAt(abs: string): Promise<boolean> {
  try {
    if (!isTextFile(baseName(abs))) {
      throw new Error('暂不支持打开该类型文件（仅支持 Markdown 与文本类文件）')
    }
    const content = await readTextFile(abs)
    // 超大文件实时渲染会卡顿，先征求用户同意
    if (!(await confirmOpenLarge(baseName(abs), content))) return false
    const mt = await fileMtimes([abs]).catch(() => ({}) as Record<string, number | null>)
    openTab(abs, content, mt[abs] ?? null)
    return true
  } catch (e) {
    logError(String(e))
    return false
  }
}

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
  if (store.secondaryPath === path) {
    // 副窗格的标签被关闭：换成剩余标签里第一个非活动标签，没有则副窗格空置
    store.secondaryPath = store.tabs.find((t) => t.path !== store.activePath)?.path ?? ''
    if (store.focusedPane === 'secondary' && !store.secondaryPath) store.focusedPane = 'primary'
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
    if (save) {
      const saved = await saveTab(tab)
      if (!saved) return // 用户在保存对话框点了取消 → 不关闭，保留内容
    }
  }
  await closeTab(path)
}

// ---------- 未命名文档 ----------

const UNTITLED_PREFIX = 'untitled:'

/** 是否为「未命名文档」（尚未落盘，path 是内存伪路径；Windows 文件名不允许冒号，不会与真实文件撞名） */
export function isUntitled(path: string): boolean {
  return path.startsWith(UNTITLED_PREFIX)
}

/** 取一个未被现有标签占用的未命名伪路径序号 */
function allocUntitledPath(): string {
  const used = new Set(
    store.tabs
      .filter((t) => isUntitled(t.path))
      .map((t) => Number(t.path.slice(UNTITLED_PREFIX.length))),
  )
  let n = 1
  while (used.has(n)) n += 1
  return UNTITLED_PREFIX + n
}

/** 新建未命名文档：不落盘，首次保存（Ctrl+S）时再询问位置与文件名 */
export function newUntitledDoc(): void {
  const path = allocUntitledPath()
  store.tabs.push({
    path,
    name: path === UNTITLED_PREFIX + '1' ? '未命名.md' : `未命名-${path.slice(UNTITLED_PREFIX.length)}.md`,
    kind: 'md',
    content: '',
    savedContent: '',
    mtime: null,
    externalChanged: false,
  })
  store.activePath = path
}

// ---------- 会话恢复（主窗口专用，兼作崩溃/退出草稿恢复） ----------

interface SessionTab {
  path: string
  name: string
  kind: Tab['kind']
  content: string
  savedContent: string
  mtime: number | null
}

interface SessionData {
  root: string
  activePath: string
  secondaryPath: string
  splitView: boolean
  tabs: SessionTab[]
}

/** 只有主窗口负责会话读写；editor-* 多窗口的未保存内容由关闭确认兜底 */
const isMainWindow = getCurrentWebviewWindow().label === 'main'

let sessionTimer: ReturnType<typeof setTimeout> | undefined
let sessionRestored = false

/** 标签/工作区变化后防抖写入会话（失败静默，不影响编辑） */
export function schedulePersistSession(delay = 1000): void {
  if (!isMainWindow) return
  clearTimeout(sessionTimer)
  sessionTimer = setTimeout(() => {
    const data: SessionData = {
      root: store.root,
      activePath: store.activePath,
      secondaryPath: store.secondaryPath,
      splitView: store.splitView,
      tabs: store.tabs.map((t) => ({
        path: t.path,
        name: t.name,
        kind: t.kind,
        content: t.content,
        savedContent: t.savedContent,
        mtime: t.mtime,
      })),
    }
    saveSession(JSON.stringify(data)).catch(() => {})
  }, delay)
}

/** 启动时恢复上次会话；返回是否恢复出了标签（工作区目录由调用方补载文件树） */
export async function restoreSession(): Promise<boolean> {
  if (!isMainWindow || sessionRestored) return false
  sessionRestored = true
  try {
    const raw = await loadSession()
    if (!raw) return false
    const data = JSON.parse(raw) as SessionData
    if (!data || !Array.isArray(data.tabs) || !data.tabs.length) return false
    for (const t of data.tabs) {
      if (!t || typeof t.path !== 'string') continue
      const kind: Tab['kind'] = t.kind === 'text' || t.kind === 'other' ? t.kind : 'md'
      if (isUntitled(t.path)) {
        // 未命名草稿：重新分配伪路径，内容与名称原样恢复
        store.tabs.push({
          path: allocUntitledPath(),
          name: t.name || '未命名.md',
          kind,
          content: t.content ?? '',
          savedContent: t.savedContent ?? '',
          mtime: null,
          externalChanged: false,
        })
      } else {
        store.tabs.push({
          path: t.path,
          name: t.name || baseName(t.path),
          kind,
          content: t.content ?? '',
          savedContent: t.savedContent ?? t.content ?? '',
          mtime: typeof t.mtime === 'number' ? t.mtime : null,
          externalChanged: false,
        })
      }
    }
    if (!store.tabs.length) return false
    store.activePath = store.tabs.some((t) => t.path === data.activePath)
      ? data.activePath
      : store.tabs[0].path
    if (typeof data.root === 'string') store.root = data.root
    // 分屏状态：副窗格标签必须仍存在且不同于活动标签
    if (data.splitView && typeof data.secondaryPath === 'string') {
      const sec = store.tabs.find((t) => t.path === data.secondaryPath)
      if (sec && sec.path !== store.activePath) {
        store.secondaryPath = sec.path
        store.splitView = true
      }
    }
    return true
  } catch {
    return false
  }
}

// ---------- 双栏分屏 ----------

/** 开启 / 关闭分屏；开启时副窗格默认放第一个非活动标签 */
export function toggleSplitView(): void {
  if (!store.splitView) {
    if (store.tabs.length < 2) return
    store.splitView = true
    store.secondaryPath = store.tabs.find((t) => t.path !== store.activePath)?.path ?? ''
    if (!store.secondaryPath) store.splitView = false
    return
  }
  store.splitView = false
  store.secondaryPath = ''
  store.focusedPane = 'primary'
}

/** 把标签放进副窗格（标签页右键「在右窗格打开」），并聚焦副窗格便于直接编辑 */
export function openInSecondaryPane(path: string): void {
  const tab = store.tabs.find((t) => t.path === path)
  if (!tab) return
  store.splitView = true
  if (path === store.activePath) return
  store.secondaryPath = path
  store.focusedPane = 'secondary'
}

/** 切换聚焦窗格（窗格位置固定，聚焦决定保存/查找/导出/大纲/状态栏的目标） */
export function setFocusedPane(which: 'primary' | 'secondary'): void {
  if (!store.splitView) return
  if (which === 'secondary' && !store.secondaryPath) return
  store.focusedPane = which
}

// ---------- 保存 ----------

const SAVE_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown'] },
  { name: '文本文件', extensions: ['txt'] },
  { name: '所有文件', extensions: ['*'] },
]

/** 未命名文档首存 / 手动另存为：弹系统对话框询问保存位置与文件名；取消返回 false（内容不落盘） */
export async function saveTabAs(tab: Tab): Promise<boolean> {
  const target = await pickSaveFile(tab.name, SAVE_FILTERS)
  if (!target) return false
  // 目标路径若已被其他标签打开：内容干净则让其让位，有未保存更改则中止
  const existing = store.tabs.find((t) => t.path === target && t !== tab)
  if (existing) {
    if (existing.content !== existing.savedContent) {
      logError(`「${existing.name}」已在其他标签打开且有未保存更改，已取消覆盖保存`)
      return false
    }
    await closeTab(target)
  }
  const oldPath = tab.path
  await writeTextFile(target, tab.content)
  tab.path = target
  tab.name = baseName(target)
  // 标签身份由伪路径换成真实路径，活动标签指针必须跟着改，否则编辑区会退回欢迎页
  if (store.activePath === oldPath) store.activePath = target
  const kind = kindOf(target)
  if (kind !== 'other') tab.kind = kind
  tab.savedContent = tab.content
  // 取写入后的真实 mtime，作为外部修改检测的基线
  fileMtimes([target])
    .then((m) => {
      const t = m[target]
      if (t != null) tab.mtime = t
    })
    .catch(() => {})
  addRecentFile(target)
  // 之前没打开工作区时，把保存位置设为工作区（与按文件打开多窗口时的行为一致）
  if (!store.root) {
    store.root = parentDir(target)
    try {
      store.tree = await readDirShallow(store.root)
    } catch {
      /* 目录读不到就不填充文件树 */
    }
    addRecentFolder(store.root)
    refreshGit().catch(() => {})
  }
  return true
}

export async function saveTab(tab: Tab): Promise<boolean> {
  if (tab.content === tab.savedContent) return true
  // 未命名文档首次保存：先询问位置与文件名，取消则保持未保存状态
  if (isUntitled(tab.path)) return await saveTabAs(tab)
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
  return true
}

export async function saveActive(): Promise<boolean> {
  // 分屏下保存「聚焦窗格」的文件（Ctrl+S 保存的是正在编辑的那个）
  const t = store.focusedTab
  if (!t) return true
  return await saveTab(t)
}

/** 另存为：对活动标签弹对话框选择新位置写入 */
export async function saveActiveAs(): Promise<boolean> {
  const t = store.active
  if (!t) return true
  return await saveTabAs(t)
}

/** 打开大文件（>1MB）前确认；按 UTF-8 字节数判断（中文 3 字节/字，字符数会低估体积）；返回 false 表示用户取消打开 */
export async function confirmOpenLarge(name: string, content: string): Promise<boolean> {
  const bytes = new TextEncoder().encode(content).length
  if (bytes <= 1024 * 1024) return true
  return await ask(
    `「${name}」约 ${(bytes / 1024 / 1024).toFixed(1)} MB，实时渲染可能明显卡顿。\n\n仍要打开吗？`,
    { title: '打开大文件', kind: 'warning', okLabel: '仍要打开', cancelLabel: '取消' },
  )
}

// ---------- 跨文件替换 ----------

export interface ReplaceSummary {
  files: number
  count: number
}

/** 跨文件全部替换（大小写不敏感字面量，与全文搜索语义一致）：
 *  先预览命中数量弹确认，执行时 Rust 侧逐文件自动备份本地历史快照；
 *  已打开的干净标签重读磁盘同步，有未保存修改的标签标为「外部已修改」由用户裁决。
 *  取消或无匹配返回 null。 */
export async function replaceAllInWorkspace(query: string, replacement: string): Promise<ReplaceSummary | null> {
  if (!store.root || !query.trim()) return null
  const preview = await replaceWorkspace(store.root, query, replacement, true)
  if (!preview.count) return null
  const ok = await ask(
    `将在 ${preview.files.length} 个文件中替换 ${preview.count} 处。\n\n「${query}」→「${replacement}」\n\n替换前会为每个受影响文件自动保存一份本地历史快照。`,
    { title: '全部替换', kind: 'warning', okLabel: '全部替换', cancelLabel: '取消' },
  )
  if (!ok) return null
  const out = await replaceWorkspace(store.root, query, replacement, false)
  const touched = new Set(out.files)
  for (const tab of store.tabs) {
    if (isUntitled(tab.path) || !touched.has(tab.path)) continue
    if (tab.content === tab.savedContent) {
      // 干净标签：直接以磁盘新内容为准
      try {
        const fresh = await readTextFile(tab.path)
        tab.content = fresh
        tab.savedContent = fresh
      } catch {
        /* 读不到就交给外部修改检测兜底 */
      }
    } else {
      // 有未保存修改：不能静默覆盖，交给「外部已修改」横幅
      tab.externalChanged = true
    }
  }
  // 回填 mtime 基线，避免 3 秒轮询把已同步的标签误报为外部修改
  const mt = await fileMtimes([...touched]).catch(() => ({}) as Record<string, number | null>)
  for (const tab of store.tabs) {
    const t = mt[tab.path]
    if (t != null) tab.mtime = t
  }
  // 刷新编辑器显示（md 与 text 编辑器都监听 revision）
  store.contentRevision++
  if (store.gitRepo) scheduleGitRefresh()
  return { files: out.files.length, count: out.count }
}

/** 每个标签一个自动保存计时器（分屏双窗格交替输入互不打断） */
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

let gitRefreshTimer: ReturnType<typeof setTimeout> | undefined

/** 保存后延迟刷新 Git 状态（避免频繁调用 git 进程） */
function scheduleGitRefresh(): void {
  clearTimeout(gitRefreshTimer)
  gitRefreshTimer = setTimeout(() => {
    refreshGit().catch(() => {})
  }, 2000)
}

/** 输入防抖自动保存；可指定目标标签（分屏双窗格各自保存各自的文件），缺省为聚焦窗格 */
export function scheduleSave(delay = 1200, target?: Tab): void {
  if (!store.autoSave) return
  const tab = target ?? store.focusedTab
  if (!tab) return
  // 未命名文档不自动保存：首次落盘需询问位置，自动弹对话框会打断输入
  if (isUntitled(tab.path)) return
  clearTimeout(saveTimers.get(tab.path))
  saveTimers.set(
    tab.path,
    setTimeout(() => {
      saveTimers.delete(tab.path)
      saveTab(tab)
        .then(() => {
          if (store.gitRepo) scheduleGitRefresh()
        })
        .catch((e) => {
          logError(`自动保存失败：${e}`)
        })
    }, delay),
  )
}

// ---------- Git 状态（供状态栏与 Git 面板共享） ----------

/** Git 状态读取的唯一实现；withHistory=true 时同时拉取最近提交历史（Git 面板用） */
export async function refreshGit(withHistory = false): Promise<void> {
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
    if (withHistory && st.repo) await loadGitHistory()
  } catch (e) {
    store.gitInstalled = false
    store.logs = `Git 检测失败：${e}`
  }
}

/** 拉取最近 20 条提交历史 */
async function loadGitHistory(): Promise<void> {
  const out = await gitRun(store.root, ['log', '--pretty=format:%h%x1f%s%x1f%ar', '-n', '20'])
  if (out.code !== 0) {
    store.gitHistory = []
    return
  }
  store.gitHistory = out.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, subject, date] = line.split('\x1f')
      return { hash, subject, date: date ?? '' }
    })
}

/** path → Git 变更码映射（文件树角标 O(1) 查询，避免每个节点线性扫 gitChanges） */
export const gitChangeMap = computed(() => new Map(store.gitChanges.map((c) => [c.path, c.code])))

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
  // 侧栏收起时点任意图标即唤回
  if (store.sidebarCollapsed) setSidebarCollapsed(false)
}

export function setSidebarCollapsed(on: boolean) {
  store.sidebarCollapsed = on
  localStorage.setItem('mdtex.sidebarCollapsed', on ? 'on' : 'off')
}

export function toggleSidebarCollapsed(): void {
  setSidebarCollapsed(!store.sidebarCollapsed)
}

export function setVimMode(on: boolean) {
  store.vimMode = on
  localStorage.setItem('mdtex.vimMode', on ? 'on' : 'off')
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
