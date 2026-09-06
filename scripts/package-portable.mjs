// 打包便携版 zip：MD-Editor.exe + portable.flag + 使用说明
// 前置：先运行 npm run tauri build -- --bundles nsis（产出 release exe）
import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const exeSrc = join(root, 'src-tauri', 'target', 'release', 'mdtex.exe')
const outDir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'portable')

if (!existsSync(exeSrc)) {
  console.error('未找到 release exe，请先运行: npm run tauri build -- --bundles nsis')
  process.exit(1)
}

const stage = join(outDir, 'MD-Editor-portable')
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })

copyFileSync(exeSrc, join(stage, 'MD-Editor.exe'))
writeFileSync(join(stage, 'portable.flag'), '')
writeFileSync(
  join(stage, '使用说明.txt'),
  [
    'MD 编辑器 便携版',
    '',
    '- MD-Editor.exe：双击直接运行，免安装（依赖系统自带的 WebView2 运行时）',
    '- 运行后在本目录生成 mdtex-data/，背景图与本地历史快照保存在里面，随目录整体移动',
    '- portable.flag 是便携模式标记，删除它后应用恢复把数据存到系统用户目录（LOCALAPPDATA）',
    '',
  ].join('\r\n'),
)

const zip = join(outDir, 'MD-Editor-portable.zip')
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}' -Force"`,
  { stdio: 'inherit' },
)
console.log('✔ 便携包已生成：' + zip)
