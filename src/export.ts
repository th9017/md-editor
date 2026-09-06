/** Markdown 导出：单文件 HTML（内联样式与 KaTeX 资源）与 PDF 打印 */

const DOC_CSS = `
  body { margin: 0; background: #fff; color: #1f2328; }
  .md-doc {
    max-width: 820px; margin: 0 auto; padding: 48px 32px;
    font-family: 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif;
    font-size: 15px; line-height: 1.75;
  }
  .md-doc h1, .md-doc h2, .md-doc h3, .md-doc h4, .md-doc h5, .md-doc h6 {
    line-height: 1.35; margin: 1.4em 0 0.6em; font-weight: 650;
  }
  .md-doc h1 { font-size: 1.9em; border-bottom: 1px solid #e2e6ea; padding-bottom: 0.3em; }
  .md-doc h2 { font-size: 1.45em; border-bottom: 1px solid #eceff2; padding-bottom: 0.25em; }
  .md-doc a { color: #0969da; text-decoration: none; }
  .md-doc a:hover { text-decoration: underline; }
  .md-doc code {
    font-family: Consolas, 'Courier New', monospace; font-size: 0.88em;
    background: #f3f4f6; border-radius: 4px; padding: 0.15em 0.4em;
  }
  .md-doc pre {
    background: #f6f8fa; border: 1px solid #e2e6ea; border-radius: 8px;
    padding: 12px 14px; overflow: auto; line-height: 1.6;
  }
  .md-doc pre code { background: transparent; padding: 0; font-size: 0.9em; }
  .md-doc blockquote {
    margin: 0.8em 0; padding: 0.2em 1em; color: #57606a;
    border-left: 3px solid #d0d7de;
  }
  .md-doc table { border-collapse: collapse; margin: 1em 0; }
  .md-doc th, .md-doc td { border: 1px solid #d0d7de; padding: 6px 12px; }
  .md-doc th { background: #f6f8fa; }
  .md-doc img { max-width: 100%; }
  .md-doc hr { border: none; border-top: 2px solid #eceff2; margin: 2em 0; }
`

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function toDataUrl(absUrl: string): Promise<string> {
  const buf = await (await fetch(absUrl)).arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  const mime = absUrl.endsWith('.woff2')
    ? 'font/woff2'
    : absUrl.endsWith('.woff')
      ? 'font/woff'
      : absUrl.endsWith('.ttf')
        ? 'font/ttf'
        : 'application/octet-stream'
  return `url(data:${mime};base64,${btoa(bin)})`
}

/** 下载 CSS 并把其中引用的字体等资源内联为 data URL */
async function inlineCss(url: string): Promise<string> {
  const css = await (await fetch(url)).text()
  const refs = [...css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)]
    .map((m) => m[2])
    .filter((r) => !/^(data:|https?:)/.test(r))
  const map = new Map<string, string>()
  await Promise.all(
    [...new Set(refs)].map(async (ref) => {
      try {
        map.set(ref, await toDataUrl(new URL(ref, url).href))
      } catch {
        /* 内联失败的资源保持原样 */
      }
    }),
  )
  return css.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, _q: string, ref: string) => map.get(ref) ?? m)
}

/** 组装可离线打开的单文件 HTML */
export async function buildStandaloneHtml(title: string, bodyHtml: string): Promise<string> {
  let katexCss = ''
  let katexJs = ''
  try {
    katexCss = await inlineCss('/vditor/dist/js/katex/katex.min.css')
    katexJs = await (await fetch('/vditor/dist/js/katex/katex.min.js')).text()
  } catch {
    /* KaTeX 资源缺失时公式退级显示 */
  }
  const safeTitle = title.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c)
  // 编辑器导出的公式元素（.language-math）是原始 LaTeX 文本，这里用内联的 KaTeX 渲染
  const mathRender = katexJs
    ? `<script>document.querySelectorAll(".language-math").forEach(function(el){try{katex.render(el.textContent,el,{displayMode:el.tagName==="DIV"})}catch(e){}})</` + `script>`
    : ''
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>${katexCss}</style>
<style>${DOC_CSS}</style>
<script>${katexJs}</` + `script>
</head>
<body>
<article class="md-doc">
${bodyHtml}
${mathRender}
</article>
</body>
</html>`
}

/** 通过隐藏 iframe 调起系统打印（可另存为 PDF） */
export async function printHtml(html: string): Promise<void> {
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument
  if (!doc) {
    iframe.remove()
    throw new Error('无法创建打印容器')
  }
  doc.open()
  doc.write(html)
  doc.close()
  await new Promise<void>((resolve) => {
    if (doc.readyState === 'complete') resolve()
    else iframe.onload = () => resolve()
  })
  await new Promise((r) => setTimeout(r, 300))
  iframe.contentWindow?.focus()
  iframe.contentWindow?.print()
  setTimeout(() => iframe.remove(), 3000)
}

/** 生成「全部替换」用的正则（大小写不敏感） */
export function replaceAllInsensitive(text: string, from: string, to: string): string {
  return text.replace(new RegExp(escapeRegExp(from), 'gi'), () => to)
}
