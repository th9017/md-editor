import type { ThemeId } from './types'

export interface ThemeDescriptor {
  /** 是否深色系（决定 Vditor 编辑器外壳与内容主题） */
  dark: boolean
  /** 代码高亮样式名（Vditor hljs.style，对应 public/vditor/dist/js/highlight.js/styles/） */
  hljs: string
  /** CodeMirror 是否使用 oneDark */
  cmDark: boolean
}

/**
 * 主题描述符单一来源：外观变量在 style.css 的 [data-theme] 组里，
 * 这里只放「行为相关」的描述（深浅、代码高亮配色选择）。
 *
 * hljs 名字必须是 Vditor CODE_THEME 白名单里的，且 public/vditor/dist/js/highlight.js/styles/ 下有同名文件；
 * 否则 Vditor 不报错、静默回退成浅色 github（暗色主题下代码块会变成深底深字）。
 */
export const THEMES: Record<ThemeId, ThemeDescriptor> = {
  light: { dark: false, hljs: 'github', cmDark: false },
  dark: { dark: true, hljs: 'github-dark', cmDark: true },
  green: { dark: false, hljs: 'gml', cmDark: false },
  paper: { dark: false, hljs: 'kimbie-light', cmDark: false },
  ink: { dark: true, hljs: 'tokyo-night-dark', cmDark: true },
}

export function isDarkTheme(theme: ThemeId): boolean {
  return THEMES[theme].dark
}

export function hljsStyle(theme: ThemeId): string {
  return THEMES[theme].hljs
}

export function cmDark(theme: ThemeId): boolean {
  return THEMES[theme].cmDark
}
