# AGENTS.md — MD 编辑器 AI 协作修改规范

本文件写给在本仓库中工作的大语言模型与人类贡献者。**任何修改前请先完整阅读本文件**，修改内容与本文件冲突时，以本文件为准或先修改本文件并说明理由。

---

## 1. 项目速览

- **产品**：「MD 编辑器」，Windows 桌面 Markdown 编辑器，Typora 式体验，完全离线可用
- **技术栈**：Tauri 2（Rust 外壳）+ Vue 3 `<script setup>` + TypeScript + Vite；编辑器内核 Vditor（Markdown）与 CodeMirror 6（纯文本）
- **形态**：一窗一工作区（主窗口），支持多窗口（一窗一文件，窗口 label 为 `editor-*`）
- **版本纪律**：版本号同时存在于 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 三处，**必须同步修改**

## 2. 目录职责表

| 路径 | 职责 |
| --- | --- |
| `src/main.ts` | 应用启动：恢复持久化外观（主题/强调色/字号/背景）、跨窗口 storage 同步监听 |
| `src/App.vue` | 主布局与业务编排：标题栏/侧栏六视图/状态栏、浮层挂载、全局快捷键、文件树右键、多窗口启动参数、mtime 轮询 |
| `src/store.ts` | **全局状态唯一入口**（reactive 单例）+ 全部 setter（DOM 副作用集中于此）+ 保存/快照/Git 状态刷新 |
| `src/tauri.ts` | **所有 Tauri API 的唯一封装层**（plugin-fs / plugin-dialog / invoke 自定义命令） |
| `src/types.ts` | 前后端共享类型（Rust 端 Serialize 结构需与此对应） |
| `src/theme.ts` | 主题行为描述符（深浅判定、hljs 高亮样式、CodeMirror 暗色判定） |
| `src/fuzzy.ts` | 子序列模糊匹配（快速打开 / 命令面板共用） |
| `src/export.ts` | 导出：单文件 HTML（内联 KaTeX）、PDF 打印、内容组装 |
| `src/multiwindow.ts` | 多窗口：`openFileInNewWindow()` |
| `src/components/*.vue` | UI 组件；面板类组件只消费 store 与 tauri.ts，不直接 invoke |
| `src-tauri/src/lib.rs` | Rust 端：10 个 command + 插件注册；**只用 Rust 标准库，无第三方 crate** |
| `src-tauri/capabilities/default.json` | Tauri 权限清单（windows 匹配 `main` 与 `editor-*`） |
| `public/vditor/` | Vditor 完整本地化资源（KaTeX、highlight.js 等）——**只读，禁止增删改** |
| `scripts/package-portable.mjs` | 便携版 zip 打包脚本 |
| `examples/` | 演示与测试用样例文档 |

## 3. 架构不变量（硬性规则）

1. **invoke 单一封装**：前端任何 Tauri 调用必须写进 `src/tauri.ts` 再被组件使用；组件内禁止直接 `import { invoke } from '@tauri-apps/api/core'`
2. **状态单一入口**：跨组件状态只放 `store.ts`；组件私有状态用本地 ref。修改 `document.documentElement`（data-theme / CSS 变量 / data-focus）只允许发生在 store 的 setter 与 `main.ts`
3. **离线铁律**：Vditor 通过 `cdn: '/vditor'` 加载本地资源；**禁止**引入任何 http(s) 外链资源（字体、脚本、样式）；导出 HTML 的外部资源必须内联为 data URL
4. **主题体系**：颜色一律用 `src/style.css` 的 CSS 变量（`--panel/--text/--border/--accent` 等）；新增主题 = style.css 增加 `[data-theme='x']` 变量组 **+** `theme.ts` 增加 `THEMES` 描述符，两处缺一不可
5. **Rust 端零依赖**：`src-tauri` 只用标准库 + tauri 官方插件；新命令必须在 `run()` 的 `generate_handler!` 注册；涉及路径的命令要考虑**便携模式**（`portable.flag` → 数据随 exe 目录）
6. **权限同步**：新增前端可调用的 Tauri API 时，检查 `capabilities/default.json` 是否需要追加权限；新窗口 label 必须匹配 `editor-*` 以继承权限
7. **全中文**：界面文案、注释中的说明性文字、文档一律中文；标识符用英文
8. **类型完整**：`vue-tsc --noEmit` 必须零错误；Rust 端新增结构体字段需同步 `src/types.ts`

## 4. 验证纪律（每次改动的收尾动作）

```bash
npm run build        # vue-tsc 类型检查 + vite 构建，必须零错误
cd src-tauri && cargo check   # Rust 类型检查，必须零错误
```

- UI/交互改动：`npm run tauri dev` 后实际走查受影响的面板/流程（不要只看编译通过）
- 涉及保存/快照/背景等磁盘写入：确认便携模式与安装模式两种路径解析都正确
- Git 相关改动：在一个临时目录 `git init` 实测，不要污染项目仓库

## 5. 已知陷阱清单（踩过的坑，勿重蹈）

1. **Vditor 不支持运行时改 mode/主题**：切换必须销毁重建实例（MarkdownEditor 的 build()）；实例内容刷新用 `setValue`
2. **暗色主题文字消失**：Vditor 的 `theme: 'dark'` 只改外壳，内容主题 CSS 必须在 `after()` 里调用 `vditor.setTheme('dark', 'dark', <hljs 样式>)` 装载
3. **Vditor 资源按 `${cdn}/dist/...` 解析**：`public/vditor` 下必须保留 `dist/` 这一层目录
4. **管道吞退出码**：`cargo ... | tail` 之后的 `$?` 是 tail 的；用 `PIPESTATUS[0]` 判断
5. **本机 npm 缓存目录无权限**：npm 命令需带 `--cache="$HOME/.npm-cache"`（见记忆/README）
6. **plugin-fs 权限按命令细分**：`readTextFile` 要 `fs:allow-read-text-file`，与二进制 `read-file` 是两个权限
7. **Vue watch 默认 pre-flush**：依赖「刚被 v-if 挂出来的 DOM」时必须 `flush: 'post'`
8. **中文路径**：文件名含中文是常态，Rust 端 `to_string_lossy`、前端 `encodeURIComponent` 都要留意
9. **flex 容器中的编辑器高度**：根元素用 `flex: 1; min-height: 0`，不要用 `height: 100%`
10. **多窗口同文件**：编辑冲突不做实时协同，依赖 mtime 轮询 + 「重新加载 / 保留我的版本」横幅，不要引入文件锁
11. **GUI 派生控制台子进程必须加 CREATE_NO_WINDOW**（`std::os::windows::process::CommandExt::creation_flags(0x0800_0000)`）：release 构建是 GUI 子系统，git 等控制台程序每次被调用都会弹终端窗口并抢焦点，进而触发 focus 刷新形成无限弹窗循环；debug 构建有控制台不会暴露此问题
12. **工作区相对路径的图片在 WebView 里默认 404**：`<img src="assets/x.png">` 相对的是应用自身地址而非磁盘。渲染层用 `convertFileSrc`（需 tauri.conf 的 assetProtocol）映射为绝对路径，且只改渲染 DOM——编辑器序列化会把 DOM src 写回源码，必须在 input 回调里把 asset 地址反解回相对路径（见 MarkdownEditor 的 `fixupImgs` / `deCorruptAssetUrls`）；导出用 `getHtmlPortable` + `inlineWorkspaceImages` 保证可移植
13. **打字机模式有三个坑，都别踩**：① 滚动触发不能挂在 vditor 的 `options.input` 上——它被 `undoDelay=800ms` 防抖，连续打字期间永不触发；必须监听编辑元素的原生 `input`/`selectionchange`（sv 的 textarea 用元素级 selectionchange，contenteditable 用 document 级并守卫选区锚点在编辑元素内）。② 光标几何测量按编辑形态分流：sv 分屏源码侧是 textarea，光标不进入 `window.getSelection()`（vditor 源码在 sv 下直接 throw），须用镜像 div 复制计算样式测量光标纵坐标；contenteditable 用折叠到光标端的选区矩形，空行/块尾全零矩形时回退邻字符与父块，再向上找最近可滚动祖先改 `scrollTop`。③ **vditor 把三种编辑形态的元素（sv 的 textarea、ir/wysiwyg 的 pre、还有预览 div）同时放进 DOM，仅靠显隐切换**——定位编辑元素必须按 `store.mdMode` 限定选择器（如 `.vditor-ir .vditor-reset`），按类名粗放 `querySelector` 会命中隐藏形态的元素，监听全挂空

## 6. 版本与发布流程

1. `CHANGELOG.md` 补条目（Keep a Changelog 格式）
2. 版本三件套同步改（见 1 节）
3. `npm run build` + `cargo check` 全绿 → `npm run tauri dev` 走查
4. `npm run tauri build -- --bundles nsis` → `npm run build:portable`
5. `git commit` + `git tag vX.Y.Z` + `git push` + 推 tag
6. GitHub Release 上传两个资产：NSIS 安装包 + 便携 zip

## 7. 禁止事项

- **禁止**新增 npm 或 Rust 依赖，除非在方案讨论中明确说明理由并获得同意
- **禁止**改动 `public/vditor/` 的任何内容（它是原样部署的第三方资源）
- **禁止**把用户数据写到代码内硬编码路径（一律经 `app_data_dir()`，尊重便携模式）
- **禁止**在组件里直接操作 `localStorage` 的 `mdtex.*` 键（走 store 的 setter）
- **禁止**为单点小问题引入抽象层/状态管理库——本项目刻意保持朴素

## 8. 文档同步义务

- 新增用户可感知功能 → 更新 `README.md` 功能列表与 `CHANGELOG.md`
- 改变目录结构/架构约定 → 同步更新本文件第 2、3 节
- 发版 → CHANGELOG 日期落定
