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
let fixupRaf = 0
let imgObserver: MutationObserver | null = null

const dark = (): boolean => isDarkTheme(store.theme)

/** Vditor 不支持运行时改 mode/主题，切换时整体重建实例 */
function build(mode: MdMode): void {
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
 * 打字机：把光标所在位置滚动到可视区垂直居中。
 * 用选区矩形 + 最近可滚动祖先实现，对所见即所得 / 即时渲染 / 分屏源码三种模式通用。
 */
function scrollCaretToCenter(): void {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  if (rect.height === 0 && rect.top === 0) return
  let node: HTMLElement | null =
    sel.anchorNode instanceof HTMLElement
      ? sel.anchorNode
      : sel.anchorNode?.parentElement ?? null
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
  const delta = rect.top + rect.height / 2 - (box.top + box.height / 2)
  if (Math.abs(delta) > 2) scroller.scrollTop += delta
}

function onCaretActivity(): void {
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
