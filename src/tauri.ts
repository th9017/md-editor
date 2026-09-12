import { open, save } from '@tauri-apps/plugin-dialog'
import {
  readDir,
  readTextFile,
  writeTextFile,
  writeFile,
  readFile,
  exists,
  mkdir,
  rename,
  remove,
} from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import type { FileNode, GitOut, GitStatus, ReplaceOut, SearchHit, Snapshot } from './types'

/** 弹出系统对话框选择一个文件夹，取消时返回 null */
export async function pickFolder(): Promise<string | null> {
  const dir = await open({ directory: true, multiple: false, title: '选择工作文件夹' })
  return typeof dir === 'string' ? dir : null
}

/** 弹出系统对话框选择一个文件，取消时返回 null */
export async function pickFile(filters: { name: string; extensions: string[] }[]): Promise<string | null> {
  const p = await open({ directory: false, multiple: false, filters, title: '打开文件' })
  return typeof p === 'string' ? p : null
}

export function kindOf(name: string): 'md' | 'text' | 'other' {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (TEXT_EXTS.has(ext)) return 'text'
  return 'other'
}

/** 文本类扩展名；其余（图片、pdf 等）不作为文本打开 */
const TEXT_EXTS = new Set([
  'txt', 'log', 'json', 'toml', 'yaml', 'yml', 'html', 'css', 'js', 'ts', 'csv', 'cfg',
])

export function isTextFile(name: string): boolean {
  return kindOf(name) !== 'other'
}

export function joinPath(dir: string, name: string): string {
  return dir.endsWith('\\') || dir.endsWith('/') ? dir + name : dir + '\\' + name
}

export function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

export function parentDir(p: string): string {
  const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return idx > 0 ? p.slice(0, idx) : p
}

/** 绝对路径 → 相对工作区根的路径（用于 Git 状态匹配等） */
export function relPath(abs: string, root: string): string {
  const a = abs.replaceAll('/', '\\')
  const r = root.replaceAll('/', '\\')
  const prefix = r.endsWith('\\') ? r : r + '\\'
  return a.startsWith(prefix) ? a.slice(prefix.length) : a
}

const SKIP_NAMES = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information'])

/**
 * 读取目录的一层子项（懒加载文件树用）。
 * 跳过隐藏/系统目录；返回按「文件夹在前、名称排序」的节点，children 恒为空数组。
 */
export async function readDirShallow(path: string): Promise<FileNode[]> {
  const entries = await readDir(path)
  const nodes: FileNode[] = []
  for (const e of entries) {
    const name = e.name ?? ''
    if (!name || name.startsWith('.') || name.startsWith('$') || SKIP_NAMES.has(name)) continue
    const full = joinPath(path, name)
    if (e.isDirectory) {
      nodes.push({ name, path: full, isDir: true, expanded: false, loaded: false, children: [] })
    } else if (e.isFile) {
      nodes.push({ name, path: full, isDir: false, loaded: true, children: [] })
    }
  }
  nodes.sort((a, b) =>
    a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh') : a.isDir ? -1 : 1,
  )
  return nodes
}

/** 读文本文件；非文本或读取失败时抛错，由调用方提示 */
export async function readTextFileChecked(path: string, name: string): Promise<string> {
  if (!isTextFile(name)) {
    throw new Error('暂不支持打开该类型文件（仅支持 Markdown 与文本类文件）')
  }
  return await readTextFile(path)
}

// ---------- 文件管理（文件树新建/重命名/删除） ----------

export async function createFile(path: string): Promise<void> {
  await writeTextFile(path, '')
}

/** 写入二进制文件（图片粘贴用） */
export async function writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
  await writeFile(path, data)
}

export async function createFolder(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

export async function renameEntry(from: string, to: string): Promise<void> {
  await rename(from, to)
}

export async function deleteEntry(path: string, isDir: boolean): Promise<void> {
  await remove(path, { recursive: isDir })
}

// ---------- v0.3.0 Rust 命令 ----------

/** 应用数据目录（背景图、历史快照存放根） */
export async function appDataDir(): Promise<string> {
  return await invoke<string>('data_dir')
}

/** 会话持久化：把 JSON 字符串写入应用数据目录的 session.json（便携模式由 Rust 端解析） */
export async function saveSession(json: string): Promise<void> {
  await invoke('save_session', { content: json })
}

/** 读取会话 JSON 字符串；文件不存在或读取失败返回空字符串 */
export async function loadSession(): Promise<string> {
  return await invoke<string>('load_session')
}

/** 取走并清空首启动暂存的待打开路径（冷启动文件关联 / 命令行参数） */
export function takePendingOpenPaths(): Promise<string[]> {
  return invoke<string[]>('take_pending_open_paths')
}

export async function searchWorkspace(root: string, query: string): Promise<SearchHit[]> {
  return await invoke<SearchHit[]>('search_workspace', { root, query })
}

/** 跨文件全文替换（preview=true 只统计；执行时 Rust 侧逐文件先存本地历史快照） */
export async function replaceWorkspace(
  root: string,
  query: string,
  replacement: string,
  preview: boolean,
): Promise<ReplaceOut> {
  return await invoke<ReplaceOut>('replace_workspace', { root, query, replacement, preview })
}

export async function listWorkspaceFiles(root: string): Promise<string[]> {
  return await invoke<string[]>('list_workspace_files', { root })
}

export async function gitRun(repo: string, args: string[]): Promise<GitOut> {
  return await invoke<GitOut>('git_run', { repo, args })
}

export async function gitStatus(repo: string): Promise<GitStatus> {
  return await invoke<GitStatus>('git_status', { repo })
}

/** 返回 { 绝对路径: mtime 毫秒 | null(文件不存在) } */
export async function fileMtimes(paths: string[]): Promise<Record<string, number | null>> {
  return await invoke<Record<string, number | null>>('read_file_meta', { paths })
}

/** 把背景图拷贝进应用数据目录，返回存储路径 */
export async function saveBgImage(src: string): Promise<string> {
  return await invoke<string>('save_bg_image', { src })
}

export async function readImageBytes(path: string): Promise<Uint8Array> {
  return await readFile(path)
}

export async function saveSnapshot(path: string, content: string): Promise<void> {
  await invoke('save_snapshot', { path, content })
}

export async function listSnapshots(path: string): Promise<Snapshot[]> {
  return await invoke<Snapshot[]>('list_snapshots', { path })
}

export async function readSnapshotFile(file: string): Promise<string> {
  return await invoke<string>('read_snapshot_file', { file })
}

// ---------- 导出 ----------

export async function pickSaveFile(defaultName: string, filters: { name: string; extensions: string[] }[]): Promise<string | null> {
  const p = await save({ defaultPath: defaultName, filters })
  return typeof p === 'string' ? p : null
}

export async function fileExists(path: string): Promise<boolean> {
  return await exists(path)
}
