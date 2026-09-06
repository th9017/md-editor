export interface FileNode {
  name: string
  path: string
  isDir: boolean
  expanded?: boolean
  loaded?: boolean
  children: FileNode[]
}

export type DocKind = 'md' | 'text' | 'other'

export type MdMode = 'wysiwyg' | 'ir' | 'sv'

export type SidebarView = 'files' | 'search' | 'git' | 'outline' | 'recent' | 'settings'

export type ThemeId = 'light' | 'dark' | 'green' | 'paper' | 'ink'

export interface Tab {
  path: string
  name: string
  kind: DocKind
  content: string
  savedContent: string
  /** 打开/保存时刻的文件 mtime（毫秒），null = 未知 */
  mtime: number | null
  /** 外部程序已修改此文件（等待用户决定重载或保留） */
  externalChanged: boolean
}

export interface Heading {
  level: number
  text: string
  line: number
}

export interface SearchHit {
  path: string
  line_no: number
  line_text: string
}

export interface GitFileChange {
  path: string
  /** porcelain 状态码：M / A / D / R / ? */
  code: string
}

export interface GitCommit {
  hash: string
  subject: string
  date: string
}

export interface GitOut {
  code: number
  stdout: string
  stderr: string
}

export interface GitStatus {
  repo: boolean
  branch: string
  changes: GitFileChange[]
}

export interface Snapshot {
  /** 快照文件绝对路径 */
  file: string
  /** 格式化的保存时间 */
  time: string
  size: number
}
