/**
 * 手写块领域逻辑：笔画模型、采样简化、变宽分段、命中测试、SVG 序列化与解析。
 * 纯函数模块（与 fuzzy.ts 同一定位）：不依赖 store / tauri / Vue，只接收调用方传入的 2D 上下文。
 *
 * 关键不变量（改这里之前先读）：
 * 1. 墨迹必须完全不透明。相邻段靠圆头共享端点拼合，重叠处不会出现缝隙；一旦透明就会叠深，
 *    增量绘制与整幅重绘也会不一致。
 * 2. 宽度用「因果 EMA」而不是对称窗口平滑：采样点的宽度在追加那一刻就定稿，不再被后续点影响，
 *    这样「边画边看」与「整幅重绘」「存进 SVG」三者形状一致，笔画不会在抬笔时跳变
 *    （实测：边画时每段单独 stroke，接缝处的抗锯齿覆盖比整幅重绘的连续路径略多约 5%，
 *    肉眼不可见，且 lineWidth 取值完全相同，所以不会出现粗细跳变）。
 * 3. 等宽 run 由左到右贪心合并，段 i 的归属只取决于 i 及之前的段 —— 所以增量绘制与整幅重绘
 *    得到完全相同的 run 划分。
 */

export interface InkPoint {
  x: number
  y: number
  /** 归一化线宽系数 [MIN_P, 1]：压感设备取压力，鼠标按速度反推；已做因果平滑 */
  p: number
}

export interface InkStroke {
  /** 颜色 #rrggbb */
  c: string
  /** 基准粗细（逻辑像素），实际线宽 = s * p */
  s: number
  pts: InkPoint[]
}

export interface InkDoc {
  w: number
  h: number
  strokes: InkStroke[]
}

/** 同一 run 内允许的线宽漂移（逻辑像素） */
export interface InkRun {
  w: number
  /** 段索引区间：段 i 指 pts[i-1] → pts[i] */
  from: number
  to: number
}

/** 逻辑画布尺寸：固定值，保证同一份墨迹在任何窗口/缩放下几何一致 */
export const INK_W = 1000
export const INK_H = 700

/** 采样三闸（逻辑像素） */
const MIN_DIST = 1.2
const H_TOL = 0.6
const MAX_SPAN = 10
/** 等宽 run 合并容差 */
const RUN_TOL = 0.25
/** 压力下限，避免出现零宽笔画 */
export const MIN_P = 0.25
/** 因果 EMA 系数：越大越跟手、越小越平滑 */
const EMA_ALPHA = 0.45
/** 速度→线宽的参考速度（逻辑像素/毫秒） */
const V_REF = 2.5

const HEX = /^#[0-9a-f]{6}$/i
const MAX_SVG_BYTES = 4 * 1024 * 1024
const MAX_STROKES = 2000
const MAX_POINTS = 200000

export function newInkDoc(): InkDoc {
  return { w: INK_W, h: INK_H, strokes: [] }
}

/** 无压感设备（鼠标/部分触摸）按速度反推：快=细、慢=粗 */
export function speedPressure(speed: number): number {
  return clamp(1 - speed / V_REF, MIN_P, 1)
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * 追加一个采样点。返回 false 表示被三闸丢弃。
 * 抖动过滤放在调用方（InkCanvas）按批次做，这里只做几何抽稀。
 */
export function pushSample(pts: InkPoint[], c: InkPoint): boolean {
  const n = pts.length
  if (n === 0) {
    pts.push(c)
    return true
  }
  const a = pts[n - 1]
  const d = Math.hypot(c.x - a.x, c.y - a.y)
  if (d < MIN_DIST) return false
  if (n >= 2 && d < MAX_SPAN) {
    // 叉积 = |ab| × 点到弦 a-b 的垂距：垂距小于阈值即判近共线，可丢（同 notekit 的曲率判据）
    const b = pts[n - 2]
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    const lenAB = Math.hypot(a.x - b.x, a.y - b.y)
    if (Math.abs(cross) < lenAB * H_TOL) return false
  }
  pts.push(c)
  return true
}

/**
 * 由「原始归一化压力」算出本点最终写入的 p：因果 EMA，追加即定稿。
 * 首个点直接用原始值，避免整笔比预期细。
 */
export function smoothPressure(prev: InkPoint | undefined, raw: number): number {
  if (!prev) return clamp(raw, MIN_P, 1)
  const v = EMA_ALPHA * clamp(raw, MIN_P, 1) + (1 - EMA_ALPHA) * prev.p
  return clamp(v, MIN_P, 1)
}

/** 段 i（pts[i-1] → pts[i]）的标称线宽 */
function segWidth(st: InkStroke, i: number): number {
  return (st.s * (st.pts[i - 1].p + st.pts[i].p)) / 2
}

/**
 * 等宽 run 划分：段 i 的归属只取决于 ≤ i 的段（左到右贪心），因此增量绘制与整幅重绘一致。
 */
export function widthRuns(st: InkStroke): InkRun[] {
  const runs: InkRun[] = []
  for (let i = 1; i < st.pts.length; i++) {
    const w = segWidth(st, i)
    const last = runs[runs.length - 1]
    if (last && Math.abs(w - last.w) <= RUN_TOL) last.to = i
    else runs.push({ w, from: i, to: i })
  }
  return runs
}

/** 单点笔画（点一下）的落笔半径 */
export function dotRadius(st: InkStroke): number {
  return Math.max(0.3, (st.s * (st.pts[0]?.p ?? 1)) / 2)
}

/** 画整条笔画（整幅重绘 / 撤销 / 加载后用） */
export function drawStroke(ctx: CanvasRenderingContext2D, st: InkStroke): void {
  const { pts } = st
  if (pts.length === 0) return
  ctx.strokeStyle = st.c
  ctx.fillStyle = st.c
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (pts.length === 1) {
    ctx.beginPath()
    ctx.arc(pts[0].x, pts[0].y, dotRadius(st), 0, Math.PI * 2)
    ctx.fill()
    return
  }
  for (const run of widthRuns(st)) {
    ctx.beginPath()
    ctx.lineWidth = run.w
    ctx.moveTo(pts[run.from - 1].x, pts[run.from - 1].y)
    for (let i = run.from; i <= run.to; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.stroke()
  }
}

/** 增量画一条正在绘制的笔画：只画 segFrom 之后的段。
 *  每段单独 stroke（圆头在共享端点重合，接缝不可见），线宽取该段所属 run 的宽度；
 *  run 划分是左到右贪心的，与整幅重绘得到的划分完全一致。 */
export function drawStrokeTail(ctx: CanvasRenderingContext2D, st: InkStroke, segFrom: number): void {
  const { pts } = st
  if (pts.length <= 1) return
  ctx.strokeStyle = st.c
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const run of widthRuns(st)) {
    const from = Math.max(run.from, segFrom + 1)
    if (from > run.to) continue
    ctx.beginPath()
    ctx.lineWidth = run.w
    ctx.moveTo(pts[from - 1].x, pts[from - 1].y)
    for (let i = from; i <= run.to; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.stroke()
  }
}

/** 点到线段的距离平方 */
function distToSegSq(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return (px - x1) ** 2 + (py - y1) ** 2
  let t = ((px - x1) * dx + (py - y1) * dy) / len2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return (px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2
}

/** 整笔命中测试（橡皮用）：点到任一线段的距离落在「笔画半宽 + extra」内即命中 */
export function hitStroke(st: InkStroke, x: number, y: number, extra = 6): boolean {
  const { pts } = st
  if (pts.length === 0) return false
  if (pts.length === 1) {
    return Math.hypot(x - pts[0].x, y - pts[0].y) <= dotRadius(st) + extra
  }
  for (let i = 1; i < pts.length; i++) {
    const tol = extra + segWidth(st, i) / 2
    if (tol * tol >= distToSegSq(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y)) return true
  }
  return false
}

// ---------- SVG 序列化 / 解析 ----------

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/**
 * 存成可再编辑的矢量 SVG：
 * - 每条 run 一个 <path>，线宽写在 stroke-width 上（与画布 run 划分完全一致）
 * - 原始笔画内嵌在 <metadata id="mdtex-ink"> 里（扁平三元组，体积最小），点击图片即可重开编辑
 * - 无背景矩形、无 style / currentColor / 外链 —— 以 <img> 加载的 SVG 是隔离上下文，只有内联属性可靠
 */
export function serializeInkSvg(doc: InkDoc): string {
  const payload = {
    v: 1,
    w: doc.w,
    h: doc.h,
    strokes: doc.strokes.map((st) => {
      const flat: number[] = []
      for (const p of st.pts) {
        flat.push(round1(p.x), round1(p.y), round2(p.p))
      }
      return { c: HEX.test(st.c) ? st.c.toLowerCase() : '#1f2328', s: round1(st.s), p: flat }
    }),
  }
  let body = ''
  for (const st of doc.strokes) {
    if (st.pts.length === 0) continue
    const color = HEX.test(st.c) ? st.c.toLowerCase() : '#1f2328'
    if (st.pts.length === 1) {
      body += `<circle cx="${round1(st.pts[0].x)}" cy="${round1(st.pts[0].y)}" r="${round1(dotRadius(st))}" fill="${color}"/>`
      continue
    }
    for (const run of widthRuns(st)) {
      let d = `M${round1(st.pts[run.from - 1].x)} ${round1(st.pts[run.from - 1].y)}`
      for (let i = run.from; i <= run.to; i++) d += `L${round1(st.pts[i].x)} ${round1(st.pts[i].y)}`
      body += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${round2(run.w)}" stroke-linecap="round" stroke-linejoin="round"/>`
    }
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.w}" height="${doc.h}" viewBox="0 0 ${doc.w} ${doc.h}">\n` +
    `<metadata id="mdtex-ink">${JSON.stringify(payload)}</metadata>\n` +
    `<g>${body}</g>\n</svg>\n`
  )
}

const META_RE = /<metadata[^>]*\bid=["']mdtex-ink["'][^>]*>([\s\S]*?)<\/metadata>/i

/**
 * 解析手写块 SVG（磁盘上的文件是用户可改的文本，必须防御式解析，永不抛错）。
 * 返回 null = 不是手写块 / 数据损坏；返回 { strokes: [] } = 合法但空白的手写块（清空过，要能重开）。
 */
export function parseInkSvg(text: string): InkDoc | null {
  if (!text || text.length > MAX_SVG_BYTES) return null
  const m = META_RE.exec(text)
  if (!m) return null
  let raw: unknown
  try {
    raw = JSON.parse(m[1])
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as { v?: unknown; w?: unknown; h?: unknown; strokes?: unknown }
  if (obj.v !== 1 || !Array.isArray(obj.strokes)) return null
  const w = numOr(obj.w, INK_W, 100, 5000)
  const h = numOr(obj.h, INK_H, 100, 5000)
  const strokes: InkStroke[] = []
  let budget = MAX_POINTS
  for (const item of obj.strokes.slice(0, MAX_STROKES)) {
    if (!item || typeof item !== 'object') continue
    const s = item as { c?: unknown; s?: unknown; p?: unknown }
    const color = typeof s.c === 'string' && HEX.test(s.c) ? s.c.toLowerCase() : '#1f2328'
    const size = numOr(s.s, 2.5, 0.1, 64)
    if (!Array.isArray(s.p) || s.p.length < 3) continue
    const pts: InkPoint[] = []
    for (let i = 0; i + 2 < s.p.length && budget > 0; i += 3) {
      const x = numOr(s.p[i], NaN, -10000, 10000)
      const y = numOr(s.p[i + 1], NaN, -10000, 10000)
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      pts.push({ x, y, p: numOr(s.p[i + 2], 1, MIN_P, 1) })
      budget--
    }
    if (pts.length > 0) strokes.push({ c: color, s: size, pts })
  }
  return { w, h, strokes }
}

function numOr(v: unknown, fallback: number, lo: number, hi: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return clamp(v, lo, hi)
}
