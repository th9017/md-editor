<template>
  <div ref="el" class="md-editor"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import { convertFileSrc } from '@tauri-apps/api/core'
import { scheduleSave, store } from '../store'
import { hljsStyle, isDarkTheme } from '../theme'
import { createFolder, joinPath, writeBinaryFile } from '../tauri'
import type { Heading, MdMode } from '../types'

type VditorOptions = ConstructorParameters<typeof Vditor>[1]

const props = defineProps<{ path: string; value: string; revision?: number }>()
const emit = defineEmits<{ (e: 'update', value: string): void }>()

/** 精简工具栏：去掉录音 / 重复导出入口 / 帮助等噪音项 */
const TOOLBAR = [
  'headings', 'bold', 'italic', 'strike', 'link',
  '|',
  'list', 'ordered-list', 'check', 'outdent', 'indent',
  '|',
  'quote', 'code', 'inline-code', 'table',
  '|',
  'upload',
  '|',
  'undo', 'redo',
  '|',
  'edit-mode', 'fullscreen', 'more',
]

const el = ref<HTMLDivElement>()
let vditor: Vditor | null = null
let scrollContainer: HTMLElement | null = null
let headingEls: HTMLElement[] = []
let spyRaf = 0
let typewriterRaf = 0
let editingEl: HTMLElement | null = null
let mirrorEl: HTMLDivElement | null = null
let elInputHandler: (() => void) | null = null
let elSelectionHandler: (() => void) | null = null
let docSelectionHandler: (() => void) | null = null
let fixupRaf = 0
let imgObserver: MutationObserver | null = null

const dark = (): boolean => isDarkTheme(store.theme)

/** Vditor 不支持运行时改 mode/主题，切换时整体重建实例 */
function build(mode: MdMode): void {
  detachCaretListeners()
  vditor?.destroy()
  vditor = null
  if (!el.value) return
  const d = dark()
  vditor = new Vditor(el.value, {
    cdn: '/vditor',
    mode,
    value: props.value,
    lang: 'zh_CN',
    height: '100%',
    toolbar: TOOLBAR,
    theme: d ? 'dark' : 'classic',
    cache: { enable: false },
    preview: {
      math: { engine: 'KaTeX', inlineDigit: true },
      hljs: { style: hljsStyle(store.theme), lineNumber: false },
    },
    upload: {
      accept: 'image/*',
      handler: (files: File[]) => handleImageUpload(files),
    },
    input: (value: string) => {
      emit('update', deCorruptAssetUrls(value))
      scheduleSave()
      parseOutlineSoon(value)
      onCaretActivity()
      queueFixup()
    },
    after: () => {
      // 装载内容主题 CSS：暗色主题下 .vditor-reset 需要浅色文字，否则文字与背景同色
      try {
        vditor?.setTheme(d ? 'dark' : 'classic', d ? 'dark' : 'light', hljsStyle(store.theme))
      } catch {
        /* 内容主题加载失败时退回默认外观 */
      }
      parseOutlineSoon(props.value)
      setupScrollSpy()
      setupCaretListeners(mode)
      setupImgFixup()
      fixupImgs()
    },
  } as VditorOptions)
}

// ---------- 图片路径：工作区相对路径 → asset 协议（仅渲染层，不污染源码） ----------

function isRelativeSrc(src: string): boolean {
  return !/^(https?:|data:|blob:|asset:|http:\/\/asset\.)/i.test(src) && src.trim() !== ''
}

/** 把渲染 DOM 里相对路径的 <img> 映射为磁盘文件（asset 协议），原始相对路径存 data-rel-src */
function fixupImgs(): void {
  if (!el.value || !store.root) return
  el.value.querySelectorAll<HTMLImageElement>('img:not([data-rel-src])').forEach((img) => {
    const src = img.getAttribute('src') ?? ''
    if (!isRelativeSrc(src)) return
    let decoded = src
    try {
      decoded = decodeURIComponent(src)
    } catch {
      /* 保留原样 */
    }
    img.dataset.relSrc = src
    img.src = convertFileSrc(joinPath(store.root, decoded))
  })
}

/** 在组件根上挂观察器：预览重渲染 / 图片插入等任何 DOM 变化都会触发一次 fixup */
function setupImgFixup(): void {
  imgObserver?.disconnect()
  if (!el.value) return
  imgObserver = new MutationObserver(() => queueFixup())
  imgObserver.observe(el.value, { childList: true, subtree: true })
  fixupImgs()
}

function queueFixup(): void {
  cancelAnimationFrame(fixupRaf)
  fixupRaf = requestAnimationFrame(fixupImgs)
}

/** 编辑器序列化出的内容里可能混入 asset 协议地址，转回相对路径再入库 */
function deCorruptAssetUrls(value: string): string {
  if (!store.root) return value
  return value.replace(/https?:\/\/asset\.localhost\/[^\s)"'<>\\]+/g, (m) => {
    try {
      const abs = decodeURIComponent(m.replace(/^https?:\/\/asset\.localhost\//, ''))
      return relPathForward(abs)
    } catch {
      return m
    }
  })
}

function relPathForward(abs: string): string {
  const root = store.root.replaceAll('/', '\\')
  const a = abs.replaceAll('/', '\\')
  const prefix = root.endsWith('\\') ? root : root + '\\'
  const rel = a.startsWith(prefix) ? a.slice(prefix.length) : a
  return rel.replaceAll('\\', '/')
}

// ---------- 图片粘贴 / 拖拽 ----------

async function handleImageUpload(files: File[]): Promise<string | null> {
  if (!store.root) return '请先打开文件夹再粘贴图片'
  try {
    const dir = joinPath(store.root, store.imageFolder)
    await createFolder(dir)
    const parts: string[] = []
    for (const file of files) {
      const ext = extOf(file)
      const name = `IMG_${stamp()}_${rand4()}.${ext}`
      const bytes = new Uint8Array(await file.arrayBuffer())
      await writeBinaryFile(joinPath(dir, name), bytes)
      const url = `${store.imageFolder.replaceAll('\\', '/')}/${name}`
      parts.push(`![${name}](${url})`)
    }
    vditor?.insertValue(parts.join('\n'))
    return null
  } catch (e) {
    return `图片保存失败：${e}`
  }
}

function extOf(file: File): string {
  const fromName = file.name.includes('.') ? file.name.split('.').pop() : ''
  if (fromName && fromName.length <= 5) return fromName.toLowerCase()
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
  }
  return map[file.type] ?? 'png'
}

function stamp(): string {
  const d = new Date()
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function rand4(): string {
  return Math.random().toString(36).slice(2, 6)
}

// ---------- 大纲解析与滚动联动 ----------

let outlineTimer: ReturnType<typeof setTimeout> | undefined

function parseOutlineSoon(content: string): void {
  clearTimeout(outlineTimer)
  outlineTimer = setTimeout(() => parseOutline(content), 300)
}

function parseOutline(content: string): void {
  const lines = content.split('\n')
  const headings: Heading[] = []
  let inCode = false
  lines.forEach((line, idx) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inCode = !inCode
      return
    }
    if (inCode) return
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) headings.push({ level: m[1].length, text: m[2].trim(), line: idx + 1 })
  })
  store.outline = headings
}

/** 收集编辑器/预览 DOM 中的标题元素，并挂 scroll 事件做滚动联动 */
function setupScrollSpy(): void {
  if (!el.value) return
  headingEls = [...el.value.querySelectorAll('.vditor-reset :is(h1,h2,h3,h4,h5,h6)')] as HTMLElement[]
  const container = findScrollContainer()
  if (scrollContainer && scrollContainer !== container) {
    scrollContainer.removeEventListener('scroll', onScroll)
  }
  scrollContainer = container
  scrollContainer?.addEventListener('scroll', onScroll, { passive: true })
}

function findScrollContainer(): HTMLElement | null {
  if (!el.value) return null
  const candidates = el.value.querySelectorAll<HTMLElement>('.vditor-sv, .vditor-ir, .vditor-wysiwyg, .vditor-preview')
  for (const c of candidates) {
    const overflow = getComputedStyle(c).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && c.scrollHeight > c.clientHeight) return c
    const inner = c.querySelector<HTMLElement>('.vditor-reset')
    if (inner?.parentElement) {
      const po = getComputedStyle(inner.parentElement).overflowY
      if ((po === 'auto' || po === 'scroll') && inner.parentElement.scrollHeight > inner.parentElement.clientHeight) {
        return inner.parentElement
      }
    }
  }
  return null
}

function onScroll(): void {
  cancelAnimationFrame(spyRaf)
  spyRaf = requestAnimationFrame(() => {
    if (!scrollContainer || !store.outline.length) return
    const top = scrollContainer.getBoundingClientRect().top
    let current: HTMLElement | null = null
    for (const node of headingEls) {
      if (node.getBoundingClientRect().top - top <= 48) current = node
      else break
    }
    if (current) syncActiveHeading(current)
  })
}

function syncActiveHeading(element: HTMLElement): void {
  const text = element.textContent?.trim() ?? ''
  const heading = store.outline.find((h) => h.text === text)
  if (heading) store.activeHeading = String(heading.line)
}

/** 大纲点击跳转：按文本在编辑器/预览 DOM 中定位标题元素 */
function jumpTo(heading: Heading): void {
  if (!el.value) return
  const target = headingEls.find((n) => (n.textContent?.trim() ?? '') === heading.text)
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    store.activeHeading = String(heading.line)
    return
  }
  // DOM 中没找到（如 sv 模式源码侧）则按行号比例滚动
  if (scrollContainer) {
    const lines = props.value.split('\n').length
    const ratio = Math.min(1, Math.max(0, (heading.line - 1) / Math.max(1, lines)))
    scrollContainer.scrollTop = ratio * scrollContainer.scrollHeight
  }
}

// ---------- 打字机 / 专注模式 ----------

/**
 * 打字机的两个前置事实决定了实现方式：
 * 1. vditor 把 options.input 包在 undoDelay=800ms 的防抖里，连续打字期间永不触发，
 *    所以必须绕开它，直接监听编辑元素的原生 input / selectionchange；
 * 2. sv 分屏的源码侧是 textarea，其光标不进入 document 选区（window.getSelection 看不见），
 *    必须用镜像 div 测量光标纵坐标；ir/wysiwyg 是 contenteditable，走选区几何。
 */

/**
 * 定位当前编辑形态的实际编辑元素。
 * 注意 vditor 把三种编辑形态的元素同时放进 DOM（wysiwyg 的 pre、ir 的 pre、sv 的 textarea），
 * 仅靠显隐切换，所以必须按模式限定选择器，否则会命中隐藏形态的元素。
 */
function locateEditingEl(mode: MdMode): HTMLElement | null {
  if (!el.value) return null
  if (mode === 'sv') return el.value.querySelector<HTMLElement>('textarea.vditor-sv')
  return el.value.querySelector<HTMLElement>(
    mode === 'ir' ? '.vditor-ir .vditor-reset' : '.vditor-wysiwyg .vditor-reset',
  )
}

/** 在编辑元素上挂原生事件触发打字机 / 专注模式；build 重建与卸载时都要 detach */
function setupCaretListeners(mode: MdMode): void {
  detachCaretListeners()
  const target = locateEditingEl(mode)
  editingEl = target
  if (!target) return
  elInputHandler = () => onCaretActivity()
  target.addEventListener('input', elInputHandler)
  if (target instanceof HTMLTextAreaElement) {
    // Chromium 对 textarea 派发元素级 selectionchange，方向键 / 点击移动光标也能触发
    elSelectionHandler = () => onCaretActivity()
    target.addEventListener('selectionchange', elSelectionHandler)
  } else {
    docSelectionHandler = () => {
      const sel = window.getSelection()
      if (sel?.anchorNode && target.contains(sel.anchorNode)) onCaretActivity()
    }
    document.addEventListener('selectionchange', docSelectionHandler)
  }
}

function detachCaretListeners(): void {
  if (elInputHandler && editingEl) editingEl.removeEventListener('input', elInputHandler)
  if (elSelectionHandler && editingEl) {
    editingEl.removeEventListener('selectionchange', elSelectionHandler)
  }
  if (docSelectionHandler) document.removeEventListener('selectionchange', docSelectionHandler)
  elInputHandler = null
  elSelectionHandler = null
  docSelectionHandler = null
  editingEl = null
}

/** 光标当前是否落在编辑元素内（sv 看 activeElement，contenteditable 看选区锚点） */
function caretInEditingEl(): boolean {
  const target = editingEl
  if (!target) return false
  if (target instanceof HTMLTextAreaElement) return document.activeElement === target
  const sel = window.getSelection()
  return !!(sel?.anchorNode && target.contains(sel.anchorNode))
}

/** 打字机：把光标所在位置滚动到可视区垂直居中，按编辑形态分两条测量路径 */
function scrollCaretToCenter(): void {
  if (!caretInEditingEl()) return
  const target = editingEl
  if (!target) return
  if (target instanceof HTMLTextAreaElement) scrollTextareaCaretToCenter(target)
  else scrollSelectionToCenter()
}

/** sv 模式：textarea 光标几何不可得，用同款样式的隐藏镜像 div 折算光标纵坐标 */
function scrollTextareaCaretToCenter(textarea: HTMLTextAreaElement): void {
  if (textarea.clientWidth === 0) return
  const mirror = ensureMirrorEl()
  const cs = getComputedStyle(textarea)
  // 镜像逐项对齐 textarea，折行位置才一致；clientWidth 已排除滚动条与边框
  mirror.style.width = `${textarea.clientWidth}px`
  mirror.style.fontFamily = cs.fontFamily
  mirror.style.fontSize = cs.fontSize
  mirror.style.fontWeight = cs.fontWeight
  mirror.style.fontStyle = cs.fontStyle
  mirror.style.lineHeight = cs.lineHeight
  mirror.style.letterSpacing = cs.letterSpacing
  mirror.style.wordSpacing = cs.wordSpacing
  mirror.style.tabSize = cs.tabSize
  mirror.style.textIndent = cs.textIndent
  mirror.style.padding = cs.padding
  mirror.style.whiteSpace = cs.whiteSpace
  mirror.style.overflowWrap = cs.overflowWrap
  mirror.style.wordBreak = cs.wordBreak
  const text = textarea.value.slice(0, textarea.selectionEnd)
  // 以换行结尾（或空文本）时最后一行不产生行盒，补零宽字符才能量出该行位置
  mirror.textContent = /\n$|^$/.test(text) ? `${text}\u200b` : text
  const marker = document.createElement('span')
  marker.textContent = '\u200b'
  mirror.appendChild(marker)
  const top = marker.offsetTop
  const lineHeight = Number.parseFloat(cs.lineHeight) || marker.offsetHeight
  const delta = top + lineHeight / 2 - (textarea.scrollTop + textarea.clientHeight / 2)
  if (Math.abs(delta) > 2) textarea.scrollTop += delta
}

function ensureMirrorEl(): HTMLDivElement {
  if (!mirrorEl) {
    mirrorEl = document.createElement('div')
    mirrorEl.setAttribute('aria-hidden', 'true')
    mirrorEl.style.position = 'absolute'
    mirrorEl.style.top = '-9999px'
    mirrorEl.style.left = '-9999px'
    mirrorEl.style.visibility = 'hidden'
    mirrorEl.style.overflow = 'hidden'
    mirrorEl.style.boxSizing = 'border-box'
    mirrorEl.style.border = '0'
    mirrorEl.style.margin = '0'
    document.body.appendChild(mirrorEl)
  }
  return mirrorEl
}

/** 折叠选区到光标端取矩形；空行 / 块尾等全零矩形时回退到邻字符、再回退到父块 */
function caretRect(sel: Selection): { rect: DOMRect; node: Node } | null {
  const range = sel.getRangeAt(0).cloneRange()
  range.collapse(false)
  const node = range.startContainer
  const rect = range.getBoundingClientRect()
  if (rect.height !== 0 || rect.top !== 0) return { rect, node }
  const offset = range.startOffset
  for (const [s, e] of [[offset - 1, offset], [offset, offset + 1]]) {
    if (s < 0) continue
    try {
      const probe = range.cloneRange()
      probe.setStart(node, s)
      probe.setEnd(node, e)
      const r = probe.getBoundingClientRect()
      if (r.height !== 0 || r.top !== 0) return { rect: r, node }
    } catch {
      /* 偏移越界（元素节点按子节点数计）忽略 */
    }
  }
  // 空行时光标父块恰好覆盖该行；.vditor-reset 本体的矩形覆盖整篇，没有定位意义
  const parent = node instanceof Element ? node : node.parentElement
  if (parent && !parent.classList.contains('vditor-reset')) {
    const r = parent.getBoundingClientRect()
    if (r.height !== 0 || r.top !== 0) return { rect: r, node }
  }
  return null
}

/** ir/wysiwyg：光标矩形 + 最近可滚动祖先，直接改 scrollTop 居中 */
function scrollSelectionToCenter(): void {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return
  const caret = caretRect(sel)
  if (!caret) return
  let node: HTMLElement | null =
    caret.node instanceof HTMLElement ? caret.node : caret.node.parentElement
  let scroller: HTMLElement | null = null
  while (node && node !== document.body) {
    const oy = getComputedStyle(node).overflowY
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) {
      scroller = node
      break
    }
    node = node.parentElement
  }
  if (!scroller) return
  const box = scroller.getBoundingClientRect()
  const delta = caret.rect.top + caret.rect.height / 2 - (box.top + box.height / 2)
  if (Math.abs(delta) > 2) scroller.scrollTop += delta
}

function onCaretActivity(): void {
  if (!caretInEditingEl()) return
  const block = focusBlockEl()
  if (block && store.focusMode) {
    el.value?.querySelectorAll('.vditor-reset .vditor-focus').forEach((n) => {
      if (n !== block) n.classList.remove('vditor-focus')
    })
    block.classList.add('vditor-focus')
  }
  if (store.typewriter) {
    cancelAnimationFrame(typewriterRaf)
    typewriterRaf = requestAnimationFrame(scrollCaretToCenter)
  }
}

/** 光标所在块（.vditor-reset 的直接子元素），所见即所得 / 即时渲染用 */
function focusBlockEl(): HTMLElement | null {
  const sel = window.getSelection()
  if (!sel || !sel.anchorNode) return null
  let node: Node | null = sel.anchorNode
  const reset = el.value?.querySelector('.vditor-reset')
  if (!reset) return null
  while (node && node.parentElement !== reset) node = node.parentElement
  return node instanceof HTMLElement ? node : null
}

// ---------- 对外能力（导出 / 外部内容刷新） ----------

defineExpose({
  /** 当前文档的渲染 HTML（导出用）：临时把图片 src 换回相对路径，保证导出文件可移植 */
  getHtmlPortable: (): string => {
    if (!vditor || !el.value) return ''
    const imgs = [...el.value.querySelectorAll<HTMLImageElement>('img[data-rel-src]')]
    const saved = imgs.map((i) => ({ el: i, cur: i.src, rel: i.dataset.relSrc ?? '' }))
    saved.forEach((s) => {
      if (s.rel) s.el.src = s.rel
    })
    try {
      return vditor.getHTML()
    } catch {
      return ''
    } finally {
      saved.forEach((s) => {
        if (s.rel) s.el.src = s.cur
      })
    }
  },
  /** 程序性替换内容后刷新编辑器显示（查找替换 / 外部重载） */
  refreshValue: (): void => {
    if (vditor) vditor.setValue(props.value)
    parseOutlineSoon(props.value)
  },
  jumpTo,
})

// ---------- 生命周期与联动 ----------

onMounted(() => build(store.mdMode))
watch(() => store.mdMode, (m) => build(m))
watch(() => store.theme, () => build(store.mdMode))
watch(() => store.typewriter, (on) => {
  // 打开开关立即把当前光标居中一次，否则首次开启毫无反馈
  if (on) onCaretActivity()
})
watch(
  () => props.revision,
  () => {
    if (vditor) vditor.setValue(props.value)
    parseOutlineSoon(props.value)
    setupScrollSpy()
    fixupImgs()
  },
)
watch(() => props.path, () => {
  /* 切换文件时光标状态随重建自动重置 */
})

onBeforeUnmount(() => {
  clearTimeout(outlineTimer)
  cancelAnimationFrame(spyRaf)
  cancelAnimationFrame(typewriterRaf)
  cancelAnimationFrame(fixupRaf)
  detachCaretListeners()
  mirrorEl?.remove()
  mirrorEl = null
  imgObserver?.disconnect()
  imgObserver = null
  scrollContainer?.removeEventListener('scroll', onScroll)
  vditor?.destroy()
  vditor = null
})
</script>

<style scoped>
.md-editor {
  flex: 1;
  min-height: 0;
}

.md-editor :deep(.vditor) {
  border: none;
  border-radius: 0;
}
</style>
