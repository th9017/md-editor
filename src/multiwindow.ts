import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { baseName } from './tauri'
import { logError } from './store'

/**
 * 在新窗口打开一个文件（Typora 模式：一窗一文件）。
 * 新窗口运行同一前端，通过 ?file= 启动参数定位文件。
 */
export function openFileInNewWindow(absPath: string): void {
  const label = 'editor-' + Date.now()
  const win = new WebviewWindow(label, {
    url: 'index.html?file=' + encodeURIComponent(absPath),
    title: baseName(absPath),
    decorations: false,
    width: 1100,
    height: 760,
    minWidth: 940,
    minHeight: 600,
    center: true,
  })
  win.once('tauri://error', (e: unknown) => {
    logError(`打开新窗口失败：${JSON.stringify((e as { payload?: unknown })?.payload ?? e)}`)
  })
}
