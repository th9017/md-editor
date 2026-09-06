<template>
  <div ref="el" class="md-editor"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import { scheduleSave, store } from '../store'
import { createFolder, joinPath, writeBinaryFile } from '../tauri'
import type { Heading, MdMode } from '../types'

type VditorOptions = ConstructorParameters<typeof Vditor>[1]

const props = defineProps<{ path: string; value: string; revision?: number }>()
const emit = defineEmits<{ (e: 'update', value: string): void }>()

const el = ref<HTMLDivElement>()
let vditor: Vditor | null = null
let scrollContainer: HTMLElement | null = null
let headingEls: HTMLElement[] = []
let spyRaf = 0
let caretBlock: Element | null = null

const isDarkTheme = (): boolean => store.theme === 'dark' || store.theme === 'ink'

/** Vditor 不支持运行时改 mode/主题，切换时整体重建实例 */
function build(mode: MdMode): void {
  vditor?.destroy()
  vditor = null
  if (!el.value) return
  vditor = new Vditor(el.value, {
    cdn: '/vditor',
    mode,
    value: props.value,
    lang: 'zh_CN',
    height: '100%',
    theme: isDarkTheme() ? 'dark' : 'classic',
    cache: { enable: false },
    preview: {
      math: { engine: 'KaTeX', inlineDigit: true },
      hljs: { style: isDarkTheme() ? 'native' : 'github', lineNumber: false },
    },
    upload: {
      accept: 'image/*',
      handler: (files: File[]) => handleImageUpload(files),
    },
    input: (value: string) => {
      emit('update', value)
      scheduleSave()
      parseOutlineSoon(value)
      onCaretActivity()
    },
    after: () => {
      // 装载内容主题 CSS：暗色主题下 .vditor-reset 需要浅色文字，否则文字与背景同色
      const dark = isDarkTheme()
      try {
        vditor?.setTheme(dark ? 'dark' : 'classic', dark ? 'dark' : 'light', dark ? 'native' : 'github')
      } catch {
        /* 内容主题加载失败时退回默认外观 */
      }
      parseOutlineSoon(props.value)
      setupScrollSpy()
    },
  } as VditorOptions)
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

/** 收集编辑器/预览 DOM 中的标题元素，并挂 IntersectionObserver 滚动联动 */
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
    if (overflow === 'auto' || overflow === 'scroll') return c
    const inner = c.querySelector<HTMLElement>('[style*="overflow"], .vditor-reset')
    if (inner) {
      const p = inner.parentElement
      if (p) {
        const po = getComputedStyle(p).overflowY
        if (po === 'auto' || po === 'scroll') return p
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
  // DOM 中没找到（如 sv 模式源码侧）则滚动到源码对应行： approximation via scroll container top ratio
  if (scrollContainer) {
    const lines = props.value.split('\n').length
    const ratio = Math.min(1, Math.max(0, (heading.line - 1) / Math.max(1, lines)))
    scrollContainer.scrollTop = ratio * scrollContainer.scrollHeight
  }
}

// ---------- 打字机 / 专注模式 ----------

function onCaretActivity(): void {
  if (!store.typewriter && !store.focusMode) return
  const block = caretBlockEl()
  if (!block) return
  if (store.focusMode) {
    el.value?.querySelectorAll('.vditor-reset .vditor-focus').forEach((n) => {
      if (n !== block) n.classList.remove('vditor-focus')
    })
    block.classList.add('vditor-focus')
  }
  if (store.typewriter && block !== caretBlock) {
    caretBlock = block
    block.scrollIntoView({ block: 'center', behavior: 'auto' })
  }
}

function caretBlockEl(): HTMLElement | null {
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
  /** 当前文档的渲染 HTML（导出用） */
  getHtml: (): string => {
    try {
      return vditor?.getHTML() ?? ''
    } catch {
      return ''
    }
  },
  /** 程序性替换内容后刷新编辑器显示（查找替换/外部重载） */
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
  },
)
watch(() => props.path, () => {
  caretBlock = null
})

onBeforeUnmount(() => {
  clearTimeout(outlineTimer)
  cancelAnimationFrame(spyRaf)
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
