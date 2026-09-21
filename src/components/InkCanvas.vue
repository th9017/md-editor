<template>
  <Teleport to="body">
    <div class="modal-mask ink-mask" @click.self="requestCancel">
      <div ref="boxEl" class="modal ink-modal" tabindex="-1" @keydown.stop="onKey">
        <h3>手写块</h3>

        <div class="ink-bar">
          <label class="ink-field">
            颜色
            <input type="color" :value="color" @input="onPickColor" />
          </label>
          <span class="ink-swatches">
            <button
              v-for="c in PRESETS"
              :key="c"
              type="button"
              class="ink-swatch"
              :class="{ on: color === c }"
              :style="{ background: c }"
              :title="c"
              @click="pickColor(c)"
            />
          </span>
          <label class="ink-field">
            粗细 <b>{{ size.toFixed(1) }}</b>
            <input type="range" min="0.5" max="12" step="0.5" :value="size" @input="onPickSize" />
          </label>
          <button type="button" :class="{ on: !eraser }" @click="setTool(false)">画笔</button>
          <button type="button" :class="{ on: eraser }" @click="setTool(true)">整笔橡皮</button>
          <button type="button" :disabled="undoStack.length === 0" @click="undo">撤销</button>
          <button type="button" :disabled="redoStack.length === 0" @click="redo">重做</button>
          <button type="button" class="danger" :disabled="strokes.length === 0" @click="clearAll">清空</button>
          <span class="spacer" />
          <span class="ink-press">{{ pressHint }}</span>
        </div>

        <div ref="stageEl" class="ink-stage">
          <canvas
            ref="canvasEl"
            :style="{ cursor: eraser ? 'cell' : 'crosshair' }"
            @pointerdown="onDown"
            @pointermove="onMove"
            @pointerup="onUp"
            @pointercancel="onUp"
            @contextmenu.prevent
          />
        </div>

        <p v-if="!store.root" class="ink-warn">尚未打开工作区文件夹，画的内容不会丢，打开文件夹后即可保存。</p>
        <p v-if="error" class="ink-err">{{ error }}</p>

        <div class="row">
          <button type="button" @click="requestCancel">取消</button>
          <button
            type="button"
            class="primary"
            :disabled="saving || !store.root || strokes.length === 0"
            @click="doSave"
          >
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  drawStroke,
  drawStrokeTail,
  hitStroke,
  INK_W,
  MIN_P,
  pushSample,
  serializeInkSvg,
  smoothPressure,
  speedPressure,
  type InkDoc,
  type InkStroke,
} from '../ink'
import { askConfirm } from '../tauri'
import { setInkColor, setInkSize, setInkTool, store } from '../store'

const props = defineProps<{
  /** 初始内容：新建 = newInkDoc()；重编辑 = 从 SVG 解析出来的墨迹 */
  doc: InkDoc
  /** 落盘并插入正文；返回 null = 成功，字符串 = 失败文案（磁盘工作全部在父组件，画板不碰工作区） */
  onSubmit: (svg: string) => Promise<string | null>
}>()
const emit = defineEmits<{ cancel: [] }>()

const PRESETS = ['#1f2328', '#cf222e', '#0969da', '#1a7f37', '#a87143']
const UNDO_CAP = 50

const boxEl = ref<HTMLDivElement>()
const stageEl = ref<HTMLDivElement>()
const canvasEl = ref<HTMLCanvasElement>()
const strokes = ref<InkStroke[]>([])
const undoStack = ref<InkStroke[][]>([])
const redoStack = ref<InkStroke[][]>([])
const error = ref('')
const saving = ref(false)
const size = ref(store.inkSize)
const eraser = ref(store.inkEraser)
/** '' = 未显式选色，跟随主题正文色 */
const picked = ref(store.inkColor)
const themeText = ref('#1f2328')
const penSeen = ref(false)

const color = computed(() => picked.value || themeText.value)
const pressHint = computed(() =>
  penSeen.value ? '已检测到压感笔：线宽随压力变化' : '鼠标 / 触摸：按速度变化线宽',
)

/** 正在绘制的笔画：drawnTo = 已画到的段索引（段 i 指 pts[i-1] → pts[i]）；real = 本笔已确认拿到真实压力 */
let active: {
  st: InkStroke
  drawnTo: number
  lastX: number
  lastY: number
  lastT: number
  real: boolean
} | null = null
let erasing = false

// ---------- 初始化 / 尺寸 ----------

function init(doc: InkDoc): void {
  strokes.value = doc.strokes.map((st) => ({ c: st.c, s: st.s, pts: st.pts.map((p) => ({ ...p })) }))
  undoStack.value = []
  redoStack.value = []
  error.value = ''
  active = null
  relayout()
}

onMounted(() => {
  themeText.value =
    getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#1f2328'
  init(props.doc)
  window.addEventListener('resize', relayout)
  boxEl.value?.focus()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', relayout)
})

watch(() => props.doc, (d) => init(d))

/** 逻辑坐标 → 显示尺寸：画布始终按 doc 的宽高比缩放，笔画坐标本身不随窗口变化 */
function relayout(): void {
  const stage = stageEl.value
  const canvas = canvasEl.value
  if (!stage || !canvas) return
  const availW = stage.clientWidth || INK_W
  const availH = Math.max(240, Math.min(window.innerHeight * 0.6, 900))
  const scale = Math.min(availW / props.doc.w, availH / props.doc.h)
  const cssW = Math.max(120, Math.round(props.doc.w * scale))
  const cssH = Math.max(84, Math.round(props.doc.h * scale))
  canvas.style.width = `${cssW}px`
  canvas.style.height = `${cssH}px`
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(cssW * dpr)
  canvas.height = Math.round(cssH * dpr)
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.setTransform(canvas.width / props.doc.w, 0, 0, canvas.height / props.doc.h, 0, 0)
    redraw(ctx)
  }
}

function redraw(ctx?: CanvasRenderingContext2D | null): void {
  const c = ctx ?? canvasEl.value?.getContext('2d')
  if (!c) return
  c.clearRect(0, 0, props.doc.w, props.doc.h)
  for (const st of strokes.value) drawStroke(c, st)
  // 整幅重绘会把正在画的笔画也画全，同步增量游标，避免随后重复描一遍
  if (active) active.drawnTo = active.st.pts.length - 1
}

// ---------- 指针采样 ----------

function toDoc(e: PointerEvent): { x: number; y: number } {
  const canvas = canvasEl.value!
  const r = canvas.getBoundingClientRect()
  const x = ((e.clientX - r.left) * props.doc.w) / (r.width || 1)
  const y = ((e.clientY - r.top) * props.doc.h) / (r.height || 1)
  return { x: clamp(x, 0, props.doc.w), y: clamp(y, 0, props.doc.h) }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** 压感只认真正的笔；鼠标与触摸按速度反推（触摸没有压力语义，恒定值会画成等宽） */
function rawPressure(e: PointerEvent, speed: number, st: { real: boolean }): number {
  if (e.pointerType === 'pen') {
    const p = e.pressure
    if (p > 0 && Math.abs(p - 0.5) > 0.02) {
      st.real = true
      return clamp(p, MIN_P, 1)
    }
    if (st.real) return clamp(p, MIN_P, 1)
  }
  return speedPressure(speed)
}

function onDown(e: PointerEvent): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  if (e.pointerType === 'touch') {
    // 掌拒：见过笔之后一律忽略手指；接触面积过大（手掌）也忽略
    if (penSeen.value) return
    if (Math.max(e.width, e.height) > 40) return
  }
  if (e.pointerType === 'pen') penSeen.value = true
  if (!e.isPrimary) return
  e.preventDefault()
  const canvas = canvasEl.value
  if (!canvas) return
  try {
    canvas.setPointerCapture(e.pointerId)
  } catch {
    /* 指针已失效（或合成事件）时拿不到捕获，继续按普通事件画 */
  }

  if (eraser.value) {
    erasing = true
    eraseAt(e)
    return
  }
  const { x, y } = toDoc(e)
  const probe = { real: false }
  const p = rawPressure(e, 0, probe)
  const st: InkStroke = { c: color.value, s: size.value, pts: [{ x, y, p: smoothPressure(undefined, p) }] }
  snapshot()
  strokes.value.push(st)
  active = { st, drawnTo: 0, lastX: x, lastY: y, lastT: e.timeStamp, real: probe.real }
  redraw()
}

function onMove(e: PointerEvent): void {
  if (eraser.value) {
    if (erasing) eraseAt(e)
    return
  }
  const a = active
  if (!a) return
  e.preventDefault()
  const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e]
  const list = events.length > 0 ? events : [e]
  let appended = false
  for (const ev of list) {
    const { x, y } = toDoc(ev)
    const dt = Math.max(1, ev.timeStamp - a.lastT)
    const speed = Math.hypot(x - a.lastX, y - a.lastY) / dt
    const raw = rawPressure(ev, speed, a)
    const p = smoothPressure(a.st.pts[a.st.pts.length - 1], raw)
    if (pushSample(a.st.pts, { x, y, p })) appended = true
    a.lastX = x
    a.lastY = y
    a.lastT = ev.timeStamp
  }
  if (!appended) return
  const ctx = canvasEl.value?.getContext('2d')
  if (!ctx) return
  if (a.st.pts.length === 1) redraw(ctx)
  else {
    drawStrokeTail(ctx, a.st, a.drawnTo)
    a.drawnTo = a.st.pts.length - 1
  }
}

function onUp(e: PointerEvent): void {
  const canvas = canvasEl.value
  if (canvas?.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
  if (erasing) {
    erasing = false
    return
  }
  if (!active) return
  active = null
  // 抬笔兜底整幅重绘：清掉增量绘制在接缝处多出的抗锯齿边缘，与存进 SVG 的路径完全同形
  redraw()
}

function eraseAt(e: PointerEvent): void {
  const { x, y } = toDoc(e)
  for (let i = strokes.value.length - 1; i >= 0; i--) {
    if (!hitStroke(strokes.value[i], x, y)) continue
    snapshot()
    strokes.value.splice(i, 1)
    redraw()
    return
  }
}

// ---------- 撤销 / 重做 / 清空 ----------

function snapshot(): void {
  undoStack.value.push(strokes.value.slice())
  if (undoStack.value.length > UNDO_CAP) undoStack.value.shift()
  redoStack.value = []
}

function undo(): void {
  const prev = undoStack.value.pop()
  if (!prev) return
  redoStack.value.push(strokes.value.slice())
  strokes.value = prev
  redraw()
}

function redo(): void {
  const next = redoStack.value.pop()
  if (!next) return
  undoStack.value.push(strokes.value.slice())
  strokes.value = next
  redraw()
}

async function clearAll(): Promise<void> {
  if (strokes.value.length === 0) return
  const yes = await askConfirm('清空当前画板的全部墨迹？', '手写块', '清空', '取消')
  if (!yes) return
  snapshot()
  strokes.value = []
  redraw()
}

const dirty = computed(() => strokes.value.length > 0 || undoStack.value.length > 0)

async function requestCancel(): Promise<void> {
  if (dirty.value) {
    const yes = await askConfirm('手写块尚未保存，确定放弃吗？', '手写块', '放弃', '继续编辑')
    if (!yes) return
  }
  emit('cancel')
}

async function doSave(): Promise<void> {
  if (saving.value || strokes.value.length === 0) return
  saving.value = true
  error.value = ''
  try {
    const err = await props.onSubmit(serializeInkSvg({ w: props.doc.w, h: props.doc.h, strokes: strokes.value }))
    if (err) error.value = err
  } catch (e) {
    error.value = `保存失败：${e}`
  } finally {
    saving.value = false
  }
}

// ---------- 工具 ----------

function pickColor(c: string): void {
  picked.value = c
  setInkColor(c)
  syncActiveStyle()
}

function onPickColor(e: Event): void {
  pickColor((e.target as HTMLInputElement).value)
}

function onPickSize(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
  size.value = v
  setInkSize(v)
  syncActiveStyle()
}

function setTool(on: boolean): void {
  eraser.value = on
  setInkTool(on)
}

/** 改颜色 / 粗细时，允许正在画的那一笔即时跟随 */
function syncActiveStyle(): void {
  if (!active) return
  active.st.c = color.value
  active.st.s = size.value
  redraw()
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    void requestCancel()
    return
  }
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    if (e.shiftKey) redo()
    else undo()
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault()
    redo()
  }
}
</script>

<style scoped>
.ink-mask {
  align-items: center;
  padding-top: 0;
}

.ink-modal {
  width: min(1040px, 94vw);
}

.ink-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.ink-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}

.ink-field input[type='color'] {
  width: 28px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
}

.ink-field input[type='range'] {
  width: 96px;
}

.ink-swatches {
  display: inline-flex;
  gap: 4px;
}

.ink-swatch {
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
}

.ink-swatch.on {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.ink-press {
  font-size: 12px;
  color: var(--muted);
}

.ink-stage {
  display: flex;
  justify-content: center;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

/* 必须：否则笔/手指拖动会被 WebView 当成滚动或选区手势 */
.ink-stage canvas {
  display: block;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.ink-warn,
.ink-err {
  margin: 8px 0 0;
  font-size: 12px;
}

.ink-warn {
  color: var(--muted);
}

.ink-err {
  color: var(--err);
}
</style>
