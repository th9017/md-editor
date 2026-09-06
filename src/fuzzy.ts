export interface FuzzyResult {
  score: number
  /** 命中的字符索引（用于高亮） */
  positions: number[]
}

/**
 * 子序列模糊匹配：query 的字符按序出现在 text 中即命中。
 * 评分：基础 +1/字符；连续命中额外 +3；命中位置在分隔符（/\\ -_ . 空格）后额外 +5。
 * 返回 null 表示不匹配。
 */
export function fuzzyMatch(text: string, query: string): FuzzyResult | null {
  if (!query) return { score: 0, positions: [] }
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  const positions: number[] = []
  let score = 0
  let ti = 0
  let prevMatch = -2
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    let found = -1
    // 优先找与上一个命中连续的位置（连续命中加分）
    if (prevMatch >= 0 && prevMatch + 1 < t.length && t[prevMatch + 1] === ch) {
      found = prevMatch + 1
    } else {
      for (let i = ti; i < t.length; i++) {
        if (t[i] === ch) {
          found = i
          break
        }
      }
    }
    if (found < 0) return null
    positions.push(found)
    score += 1
    if (found === prevMatch + 1) score += 3
    const before = found > 0 ? t[found - 1] : '/'
    if (found === 0 || '/\\-_ . '.includes(before)) score += 5
    prevMatch = found
    ti = found + 1
  }
  // 短文件名优先（同分时）
  score += Math.max(0, 20 - Math.floor(t.length / 4))
  return { score, positions }
}
