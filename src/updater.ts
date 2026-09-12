// ---------- 检查更新（仅手动触发，平时不联网） ----------
// 轻量方案：读取 GitHub Releases 最新发布信息，比对版本号后引导用户到发布页手动下载。
// 不做自动下载安装（那需要 tauri-plugin-updater + 签名密钥，发版流程会复杂很多）。

const RELEASES_API = 'https://api.github.com/repos/th9017/md-editor/releases/latest'
export const RELEASES_PAGE = 'https://github.com/th9017/md-editor/releases/latest'

export interface UpdateInfo {
  /** 最新版本号（去掉前缀 v） */
  version: string
  /** 发布说明原文（Markdown） */
  notes: string
}

/** "v0.5.10-beta" → [0, 5, 10]；非数字段截断，解析失败返回 [0,0,0] */
function parseVersion(v: string): number[] {
  const core = v.replace(/^v/i, '').split(/[-+]/)[0]
  const parts = core.split('.').map((n) => Number.parseInt(n, 10))
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return [0, 0, 0]
  while (parts.length < 3) parts.push(0)
  return parts.slice(0, 3)
}

/** 语义化版本比较：latest 是否严格大于 current */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

/** 查询 GitHub 最新发布；网络不可达 / 限流时抛错，由调用方提示 */
export async function fetchLatestRelease(): Promise<UpdateInfo> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(RELEASES_API, {
      signal: ctrl.signal,
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { tag_name?: unknown; body?: unknown }
    const version = String(data.tag_name ?? '').trim()
    if (!version) throw new Error('响应中没有版本号')
    return { version: version.replace(/^v/i, ''), notes: String(data.body ?? '') }
  } finally {
    clearTimeout(timer)
  }
}

/** 更新说明太长时截断（弹窗空间有限，完整说明在发布页看） */
export function truncateNotes(notes: string, max = 600): string {
  const t = notes.trim()
  return t.length > max ? t.slice(0, max) + '\n…（完整说明见发布页）' : t
}
