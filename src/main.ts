import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";
import { setAccent, setBg, setFontSize, setLineHeight, setTheme, store } from "./store";
import { appDataDir, joinPath, readImageBytes } from "./tauri";
import type { ThemeId } from "./types";

// 启动时恢复持久化的外观设置（主题/强调色/字号/行距）
document.documentElement.dataset.theme = store.theme;
setTheme(store.theme);
if (store.accent) setAccent(store.accent);
setFontSize(store.fontSize);
setLineHeight(store.lineHeight);
document.documentElement.dataset.lineHeight = store.lineHeight;

// 恢复写作区背景图（从应用数据目录读取持久化的图片文件）
if (store.bgImage) {
  applyBackgroundFromDisk().catch(() => {
    /* 背景图丢失（如缓存被清理）则忽略 */
  });
}

async function applyBackgroundFromDisk(): Promise<void> {
  const dir = joinPath(await appDataDir(), "bg");
  const file = joinPath(dir, store.bgImage);
  const bytes = await readImageBytes(file);
  const type = store.bgImage.endsWith(".png")
    ? "image/png"
    : store.bgImage.endsWith(".webp")
      ? "image/webp"
      : store.bgImage.endsWith(".bmp")
        ? "image/bmp"
        : "image/jpeg";
  store.bgUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
}

// 背景相关状态变化时同步 CSS 变量（设置面板通过 setBg / bgUrl 更新，这里统一应用）
import { watch } from "vue";
watch(
  () => [store.bgImage, store.bgDim, store.bgBlur, store.bgUrl],
  () => {
    if (store.bgUrl && store.bgImage) {
      document.documentElement.style.setProperty("--bg-image", `url(${store.bgUrl})`);
      document.documentElement.style.setProperty("--bg-dim", String(store.bgDim / 100));
      document.documentElement.style.setProperty("--bg-blur", `${store.bgBlur}px`);
    } else {
      document.documentElement.style.setProperty("--bg-image", "none");
      document.documentElement.style.setProperty("--bg-dim", "0");
      document.documentElement.style.setProperty("--bg-blur", "0px");
    }
  },
  { immediate: true },
);

// 跨窗口外观同步：其他窗口修改设置时（storage 事件），本窗口重放应用
window.addEventListener('storage', (e) => {
  if (!e.key || !e.key.startsWith('mdtex.')) return
  const theme = (localStorage.getItem('mdtex.theme') as ThemeId | null) ?? 'light'
  if (theme !== store.theme) setTheme(theme)
  const accent = localStorage.getItem('mdtex.accent') || ''
  if (accent !== store.accent) setAccent(accent)
  const size = Number(localStorage.getItem('mdtex.fontSize'))
  if (Number.isFinite(size) && size > 0 && size !== store.fontSize) setFontSize(size)
  const lh = localStorage.getItem('mdtex.lineHeight')
  if (lh === 'normal' || lh === 'relaxed') {
    if (lh !== store.lineHeight) setLineHeight(lh)
  }
  const bgImage = localStorage.getItem('mdtex.bgImage') || ''
  const bgDim = Number(localStorage.getItem('mdtex.bgDim')) || 0
  const bgBlur = Number(localStorage.getItem('mdtex.bgBlur')) || 0
  if (bgImage !== store.bgImage || bgDim !== store.bgDim || bgBlur !== store.bgBlur) {
    setBg(bgImage, bgDim, bgBlur)
    if (bgImage) applyBackgroundFromDisk().catch(() => {})
    else store.bgUrl = ''
  }
})

createApp(App).mount("#app");
