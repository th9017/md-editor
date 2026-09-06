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
 */
export const THEMES: Record<ThemeId, ThemeDescriptor> = {
  light: { dark: false, hljs: 'github', cmDark: false },
  dark: { dark: true, hljs: 'native', cmDark: true },
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
