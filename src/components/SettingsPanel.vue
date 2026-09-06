<template>
  <div class="panel">
    <div class="panel-head">设置</div>
    <div class="panel-body">
      <!-- 主题 -->
      <section class="sec">
        <h4 class="sec-title">主题</h4>
        <div class="theme-row">
          <button
            v-for="t in THEMES"
            :key="t.id"
            type="button"
            class="theme-card"
            :class="{ on: store.theme === t.id }"
            @click="setTheme(t.id)"
          >
            <span class="theme-swatch" :style="{ background: t.color }" />
            <span class="theme-name">{{ t.label }}</span>
          </button>
        </div>
      </section>

      <!-- 强调色 -->
      <section class="sec">
        <h4 class="sec-title">强调色</h4>
        <div class="accent-row">
          <button
            v-for="c in ACCENTS"
            :key="c"
            type="button"
            class="accent-dot"
            :class="{ on: store.accent === c }"
            :style="{ background: c }"
            :title="c"
            @click="setAccent(c)"
          />
          <input
            type="color"
            class="accent-custom"
            :value="store.accent || DEFAULT_ACCENT"
            title="自定义颜色"
            @input="onCustomAccent"
          />
          <button type="button" class="accent-reset" @click="setAccent('')">恢复默认</button>
        </div>
      </section>

      <!-- 字号与行距 -->
      <section class="sec">
        <h4 class="sec-title">字号</h4>
        <div class="row-inline">
          <input
            type="range"
            class="grow"
            min="13"
            max="20"
            step="1"
            :value="store.fontSize"
            @input="onFontSize"
          />
          <span class="range-value">{{ store.fontSize }}px</span>
        </div>
        <div class="row-inline">
          <span class="row-label">行距</span>
          <div class="seg">
            <button type="button" :class="{ on: store.lineHeight === 'normal' }" @click="setLineHeight('normal')">常规</button>
            <button type="button" :class="{ on: store.lineHeight === 'relaxed' }" @click="setLineHeight('relaxed')">宽松</button>
          </div>
        </div>
      </section>

      <!-- 写作区背景 -->
      <section class="sec">
        <h4 class="sec-title">写作区背景</h4>
        <div class="row-inline">
          <button type="button" class="outline" :disabled="bgBusy" @click="pickBackground">选择图片</button>
          <button type="button" @click="removeBackground">移除背景</button>
        </div>
        <div class="row-inline">
          <span class="row-label">遮罩</span>
          <input type="range" class="grow" min="0" max="80" step="1" :value="store.bgDim" @input="onDim" />
          <span class="range-value">{{ store.bgDim }}</span>
        </div>
        <div class="row-inline">
          <span class="row-label">模糊</span>
          <input type="range" class="grow" min="0" max="20" step="1" :value="store.bgBlur" @input="onBlur" />
          <span class="range-value">{{ store.bgBlur }}</span>
        </div>
        <p class="hint">遮罩越深，文字越清晰。</p>
      </section>

      <!-- 行为 -->
      <section class="sec">
        <h4 class="sec-title">行为</h4>
        <label class="check-row">
          <input type="checkbox" :checked="store.autoSave" @change="onAutoSave" />
          <span>自动保存</span>
        </label>
        <div class="row-inline field-row">
          <span class="row-label">图片保存文件夹</span>
          <input
            type="text"
            class="grow"
            :value="store.imageFolder"
            placeholder="assets"
            @change="onImageFolder"
          />
        </div>
        <label class="check-row">
          <input type="checkbox" :checked="store.typewriter" @change="onTypewriter" />
          <span>打字机模式</span>
        </label>
        <label class="check-row">
          <input type="checkbox" :checked="store.focusMode" @change="onFocusMode" />
          <span>专注模式</span>
        </label>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import {
  setAccent,
  setAutoSave,
  setBg,
  setFocusMode,
  setFontSize,
  setImageFolder,
  setLineHeight,
  setTheme,
  setTypewriter,
  store,
} from '../store'
import { baseName, readImageBytes, saveBgImage } from '../tauri'
import type { ThemeId } from '../types'

const DEFAULT_ACCENT = '#0969da'

const THEMES: { id: ThemeId; label: string; color: string }[] = [
  { id: 'light', label: '亮色', color: '#ffffff' },
  { id: 'dark', label: '暗色', color: '#222327' },
  { id: 'green', label: '豆沙绿', color: '#eaf3ea' },
  { id: 'paper', label: '宣纸暖黄', color: '#f9f4e7' },
  { id: 'ink', label: '墨蓝', color: '#1d2634' },
]

const ACCENTS = ['#0969da', '#2da44e', '#bf3989', '#d4740c', '#d1242f', '#7d56c9']

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  bmp: 'image/bmp',
}

const bgBusy = ref(false)

function valueOf(e: Event): string {
  return (e.target as HTMLInputElement).value
}

function checkedOf(e: Event): boolean {
  return (e.target as HTMLInputElement).checked
}

function mimeOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_MIME[ext] ?? 'image/png'
}

function onCustomAccent(e: Event): void {
  setAccent(valueOf(e))
}

function onFontSize(e: Event): void {
  setFontSize(Number(valueOf(e)))
}

function onDim(e: Event): void {
  setBg(store.bgImage, Number(valueOf(e)), store.bgBlur)
}

function onBlur(e: Event): void {
  setBg(store.bgImage, store.bgDim, Number(valueOf(e)))
}

function onAutoSave(e: Event): void {
  setAutoSave(checkedOf(e))
}

function onTypewriter(e: Event): void {
  setTypewriter(checkedOf(e))
}

function onFocusMode(e: Event): void {
  setFocusMode(checkedOf(e))
}

function onImageFolder(e: Event): void {
  setImageFolder(valueOf(e).trim())
}

/** 选图 → 拷入应用数据目录 → 生成 blob URL 供预览 */
async function pickBackground(): Promise<void> {
  const picked = await open({
    multiple: false,
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
  })
  if (typeof picked !== 'string') return
  bgBusy.value = true
  try {
    const stored = await saveBgImage(picked)
    const bytes = await readImageBytes(stored)
    // 拷贝为 ArrayBuffer 视图，规避 ArrayBufferLike 与 BlobPart 的类型不兼容
    const blob = new Blob([new Uint8Array(bytes)], { type: mimeOf(stored) })
    if (store.bgUrl) URL.revokeObjectURL(store.bgUrl)
    store.bgUrl = URL.createObjectURL(blob)
    setBg(baseName(stored), store.bgDim, store.bgBlur)
  } catch (e) {
    store.logs = `设置背景图失败：${e}`
    store.logVisible = true
  } finally {
    bgBusy.value = false
  }
}

function removeBackground(): void {
  if (store.bgUrl) URL.revokeObjectURL(store.bgUrl)
  store.bgUrl = ''
  setBg('', 0, 0)
}
</script>

<style scoped>
.sec {
  padding: 12px 6px;
}

.sec + .sec {
  border-top: 1px solid var(--border);
}

.sec-title {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  letter-spacing: 0.05em;
}

/* 主题卡片 */
.theme-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.theme-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: none;
  border-radius: 8px;
}

.theme-card:hover {
  background: var(--hover);
}

.theme-swatch {
  display: block;
  width: 64px;
  height: 40px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
}

.theme-card.on .theme-swatch {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.theme-name {
  font-size: 11px;
  color: var(--muted);
}

.theme-card.on .theme-name {
  color: var(--accent);
  font-weight: 600;
}

/* 强调色色板 */
.accent-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.accent-dot {
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid rgb(0 0 0 / 0.15);
}

.accent-dot.on {
  box-shadow: 0 0 0 2px var(--panel), 0 0 0 4px var(--accent);
}

.accent-custom {
  width: 28px;
}

.accent-reset {
  border: none;
  padding: 2px 6px;
  font-size: 12px;
  color: var(--muted);
}

.accent-reset:hover {
  color: var(--accent);
  background: var(--accent-soft);
}

/* 行布局 */
.row-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.field-row {
  margin: 2px 0 8px;
}

.grow {
  flex: 1;
  min-width: 0;
}

.row-label {
  font-size: 12px;
  color: var(--muted);
  flex-shrink: 0;
}

.range-value {
  font-size: 12px;
  color: var(--muted);
  min-width: 34px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* 行距分段按钮 */
.seg {
  display: flex;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.seg button {
  border: none;
  border-radius: 0;
  padding: 3px 12px;
  font-size: 12px;
}

.seg button.on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.hint {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--muted);
}

/* checkbox 行 */
.check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius);
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}

.check-row:hover {
  background: var(--hover);
}

.check-row input[type='checkbox'] {
  accent-color: var(--accent);
  margin: 0;
}
</style>
