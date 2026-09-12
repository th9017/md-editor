use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::UNIX_EPOCH;
// Manager：get_webview_window；Emitter：向窗口 emit 事件（Tauri 2 中二者均为 trait）
use tauri::{Emitter, Manager};

// ---------- 数据结构 ----------

#[derive(Serialize)]
pub struct SearchHit {
    pub path: String,
    pub line_no: usize,
    pub line_text: String,
}

#[derive(Serialize)]
pub struct ReplaceOut {
    pub files: Vec<String>,
    pub count: u64,
}

#[derive(Serialize)]
pub struct GitOut {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Serialize)]
pub struct GitFileChange {
    pub path: String,
    pub code: String,
}

#[derive(Serialize)]
pub struct GitStatus {
    pub repo: bool,
    pub branch: String,
    pub changes: Vec<GitFileChange>,
}

#[derive(Serialize)]
pub struct Snapshot {
    pub file: String,
    pub time: String,
    pub size: u64,
}

// ---------- 工具 ----------

const TEXT_EXTS: &[&str] = &[
    "md", "markdown", "txt", "log", "json", "toml", "yaml", "yml", "html", "css", "js", "ts",
    "csv", "cfg",
];

fn is_text_ext(name: &str) -> bool {
    Path::new(name)
        .extension()
        .map(|e| {
            let e = e.to_string_lossy().to_lowercase();
            TEXT_EXTS.iter().any(|t| *t == e)
        })
        .unwrap_or(false)
}

fn skip_dir_name(name: &str) -> bool {
    name.starts_with('.') || name.starts_with('$') || name == "node_modules"
}

fn app_data_dir() -> Option<PathBuf> {
    // 便携模式：exe 同目录存在 portable.flag 时，数据随程序目录走
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if dir.join("portable.flag").exists() {
                return Some(dir.join("mdtex-data"));
            }
        }
    }
    let la = std::env::var("LOCALAPPDATA").ok()?;
    Some(PathBuf::from(la).join("mdtex-editor"))
}

/// 简单稳定的 FNV-1a 风格哈希，用于把文件路径映射为快照目录名
fn path_hash(s: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn now_stamp() -> String {
    let d = time::now_components();
    format!(
        "{:04}{:02}{:02}_{:02}{:02}{:02}_{:03}",
        d.0, d.1, d.2, d.3, d.4, d.5, d.6
    )
}

mod time {
    use std::time::{SystemTime, UNIX_EPOCH};

    /// (年, 月, 日, 时, 分, 秒, 毫秒) 本地时间按 UTC 近似——快照命名仅用于排序与展示，可接受
    pub fn now_components() -> (i32, u32, u32, u32, u32, u32, u32) {
        let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        let secs = d.as_secs();
        let ms = d.subsec_millis();
        let days = (secs / 86400) as i64;
        let rem = secs % 86400;
        let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
        // civil_from_days（Howard Hinnant 算法）
        let z = days + 719468;
        let era = if z >= 0 { z } else { z - 146096 } / 146097;
        let doe = (z - era * 146097) as u64;
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        let y = yoe as i64 + era * 400;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let dd = (doy - (153 * mp + 2) / 5 + 1) as u32;
        let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
        let y = if m <= 2 { y + 1 } else { y } as i32;
        (y, m, dd, h as u32, mi as u32, s as u32, ms)
    }
}

// ---------- 全文搜索 / 文件清单 ----------

fn walk_text_files(root: &Path, max: usize, mut f: impl FnMut(&Path)) {
    let mut stack = vec![root.to_path_buf()];
    let mut count = 0usize;
    while let Some(dir) = stack.pop() {
        if count >= max {
            return;
        }
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for e in entries.flatten() {
            if count >= max {
                return;
            }
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                if !skip_dir_name(&name) {
                    stack.push(p);
                }
            } else if ft.is_file() && is_text_ext(&name) {
                f(&p);
                count += 1;
            }
        }
    }
}

#[tauri::command]
async fn search_workspace(root: String, query: String) -> Result<Vec<SearchHit>, String> {
    let query_lc = query.to_lowercase();
    if query_lc.trim().is_empty() {
        return Ok(vec![]);
    }
    let dir = PathBuf::from(&root);
    if !dir.is_dir() {
        return Err(format!("目录不存在：{root}"));
    }
    let mut hits: Vec<SearchHit> = Vec::new();
    walk_text_files(&dir, 4000, |p| {
        if hits.len() >= 200 {
            return;
        }
        let Ok(meta) = fs::metadata(p) else { return };
        if meta.len() > 1024 * 1024 {
            return;
        }
        let Ok(content) = fs::read_to_string(p) else { return };
        if content[..content.len().min(1024)].contains('\0') {
            return;
        }
        let path_str = p.to_string_lossy().to_string();
        for (i, line) in content.lines().enumerate() {
            if hits.len() >= 200 {
                return;
            }
            if line.to_lowercase().contains(&query_lc) {
                hits.push(SearchHit {
                    path: path_str.clone(),
                    line_no: i + 1,
                    line_text: line.chars().take(300).collect(),
                });
            }
        }
    });
    Ok(hits)
}

/// 在一行内做大小写不敏感的字面量替换，返回 (新行, 命中数)。
/// 逐字符比较小写形式（不用整串 to_lowercase：部分字符小写后会变长，会打乱位置对齐）。
fn replace_line_ci(line: &str, needle_lc: &[char], replacement: &str) -> (String, u32) {
    if needle_lc.is_empty() {
        return (line.to_string(), 0);
    }
    let chars: Vec<char> = line.chars().collect();
    let mut out = String::with_capacity(line.len());
    let mut i = 0usize;
    let mut hits = 0u32;
    'outer: while i < chars.len() {
        let end = i + needle_lc.len();
        if end <= chars.len() {
            for (a, b) in chars[i..end].iter().zip(needle_lc.iter()) {
                let mut la = a.to_lowercase();
                let mut lb = b.to_lowercase();
                if la.next() != lb.next() || la.next().is_some() || lb.next().is_some() {
                    out.push(chars[i]);
                    i += 1;
                    continue 'outer;
                }
            }
            out.push_str(replacement);
            i = end;
            hits += 1;
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    (out, hits)
}

/// 跨文件全文替换：与 search_workspace 完全相同的文件集与匹配语义（大小写不敏感字面量）。
/// preview=true 只统计不写盘；执行时每个受影响文件先把旧内容存进本地历史快照（失败则跳过该文件）。
#[tauri::command]
async fn replace_workspace(
    root: String,
    query: String,
    replacement: String,
    preview: bool,
) -> Result<ReplaceOut, String> {
    let query_lc = query.to_lowercase();
    if query_lc.trim().is_empty() {
        return Ok(ReplaceOut { files: vec![], count: 0 });
    }
    let dir = PathBuf::from(&root);
    if !dir.is_dir() {
        return Err(format!("目录不存在：{root}"));
    }
    let needle: Vec<char> = query_lc.chars().collect();
    let mut files: Vec<String> = Vec::new();
    let mut total: u64 = 0;
    walk_text_files(&dir, 4000, |p| {
        let Ok(meta) = fs::metadata(p) else { return };
        if meta.len() > 1024 * 1024 {
            return;
        }
        let Ok(content) = fs::read_to_string(p) else { return };
        if content[..content.len().min(1024)].contains(' ') {
            return;
        }
        // split_inclusive 保留每行自己的行尾（'\r' 或 \n），替换后原样拼回，不改变换行风格
        let mut out = String::with_capacity(content.len());
        let mut hits_total = 0u32;
        for seg in content.split_inclusive('\n') {
            let (text, term) = match seg.strip_suffix('\n') {
                Some(head) => match head.strip_suffix('\r') {
                    Some(t) => (t, "\r\n"),
                    None => (head, "\n"),
                },
                None => (seg, ""),
            };
            let (newline, hits) = replace_line_ci(text, &needle, &replacement);
            hits_total += hits;
            out.push_str(&newline);
            out.push_str(term);
        }
        if hits_total == 0 {
            return;
        }
        if preview {
            files.push(p.to_string_lossy().to_string());
            total += hits_total as u64;
            return;
        }

        if save_snapshot_inner(p, &content).is_err() {
            return; // 备份失败就不动这个文件
        }
        if fs::write(p, &out).is_ok() {
            files.push(p.to_string_lossy().to_string());
            total += hits_total as u64;
        }
    });
    Ok(ReplaceOut { files, count: total })
}

#[tauri::command]
async fn list_workspace_files(root: String) -> Result<Vec<String>, String> {
    let dir = PathBuf::from(&root);
    if !dir.is_dir() {
        return Err(format!("目录不存在：{root}"));
    }
    let mut files: Vec<String> = Vec::new();
    walk_text_files(&dir, 2000, |p| {
        files.push(p.to_string_lossy().to_string());
    });
    files.sort();
    Ok(files)
}

// ---------- Git ----------

const GIT_ALLOW: &[&str] = &[
    "status", "add", "commit", "log", "branch", "rev-parse", "push", "pull", "fetch", "remote",
    "diff",
];

/// 派生 git 子进程。Windows 下 GUI 子系统派生控制台程序会弹出终端窗口，
/// 必须显式加 CREATE_NO_WINDOW；开发模式（debug，控制台子系统）不受影响。
#[cfg(target_os = "windows")]
fn spawn_git(repo: &str, args: &[String]) -> std::io::Result<std::process::Output> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    Command::new("git")
        .args(args)
        .current_dir(repo)
        .env("GIT_TERMINAL_PROMPT", "0")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
}

#[cfg(not(target_os = "windows"))]
fn spawn_git(repo: &str, args: &[String]) -> std::io::Result<std::process::Output> {
    Command::new("git")
        .args(args)
        .current_dir(repo)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
}

fn run_git(repo: &str, args: &[String]) -> GitOut {
    let out = spawn_git(repo, args);
    match out {
        Ok(o) => GitOut {
            code: o.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&o.stdout).to_string(),
            stderr: String::from_utf8_lossy(&o.stderr).to_string(),
        },
        Err(e) => GitOut {
            code: -1,
            stdout: String::new(),
            stderr: format!("无法启动 git：{e}（请确认已安装 Git 并加入 PATH）"),
        },
    }
}

#[tauri::command]
async fn git_run(repo: String, args: Vec<String>) -> Result<GitOut, String> {
    let Some(first) = args.first() else {
        return Err("缺少 git 子命令".to_string());
    };
    if !GIT_ALLOW.iter().any(|a| a == first) {
        return Err(format!("不允许的 git 子命令：{first}"));
    }
    if !Path::new(&repo).is_dir() {
        return Err(format!("目录不存在：{repo}"));
    }
    Ok(run_git(&repo, &args))
}

#[tauri::command]
async fn git_status(repo: String) -> Result<GitStatus, String> {
    if !Path::new(&repo).is_dir() {
        return Err(format!("目录不存在：{repo}"));
    }
    let inside = run_git(&repo, &["rev-parse".to_string(), "--is-inside-work-tree".to_string()]);
    if inside.code != 0 {
        return Ok(GitStatus { repo: false, branch: String::new(), changes: vec![] });
    }
    let out = run_git(&repo, &["status".to_string(), "--porcelain=v1".to_string(), "-b".to_string()]);
    let mut branch = String::new();
    let mut changes: Vec<GitFileChange> = Vec::new();
    for line in out.stdout.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            branch = rest
                .split("...")
                .next()
                .unwrap_or(rest)
                .trim()
                .trim_end_matches(']')
                .to_string();
        } else if line.len() > 3 {
            let xy = &line[..2];
            let mut file_part = line[3..].to_string();
            if let Some(idx) = file_part.find(" -> ") {
                file_part = file_part[idx + 4..].to_string();
            }
            let code: &str = if xy.starts_with('?') { "?" } else { &xy[0..1] };
            changes.push(GitFileChange { path: file_part, code: code.to_string() });
        }
    }
    Ok(GitStatus { repo: true, branch, changes })
}

// ---------- 文件元数据（外部修改检测） ----------

#[tauri::command]
async fn read_file_meta(paths: Vec<String>) -> Result<HashMap<String, Option<u64>>, String> {
    let mut map = HashMap::new();
    for p in paths {
        let mtime = fs::metadata(&p)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64);
        map.insert(p, mtime);
    }
    Ok(map)
}

// ---------- 背景图 ----------

#[tauri::command]
async fn save_bg_image(src: String) -> Result<String, String> {
    let src_path = PathBuf::from(&src);
    if !src_path.is_file() {
        return Err(format!("图片不存在：{src}"));
    }
    let ext = src_path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| "png".into());
    let ext = match ext.as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "bmp" => ext,
        _ => "png".to_string(),
    };
    let dir = app_data_dir().ok_or("无法定位应用数据目录")?.join("bg");
    fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败：{e}"))?;
    let dest = dir.join(format!("bg.{ext}"));
    fs::copy(&src_path, &dest).map_err(|e| format!("复制图片失败：{e}"))?;
    Ok(dest.to_string_lossy().to_string())
}

// ---------- 本地历史快照 ----------

fn history_root() -> Result<PathBuf, String> {
    let dir = app_data_dir().ok_or("无法定位应用数据目录")?.join("history");
    fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败：{e}"))?;
    Ok(dir)
}

/// 把内容写入该路径的本地历史快照（每路径保留最近 50 份）；空内容不存
fn save_snapshot_inner(path: &Path, content: &str) -> Result<(), String> {
    if content.is_empty() {
        return Ok(());
    }
    let dir = history_root()?.join(format!("{:016x}", path_hash(&path.to_string_lossy())));
    fs::create_dir_all(&dir).map_err(|e| format!("创建快照目录失败：{e}"))?;
    let file = dir.join(format!("{}.md", now_stamp()));
    fs::write(&file, content).map_err(|e| format!("写入快照失败：{e}"))?;
    // 只保留最近 50 份
    let mut snaps: Vec<PathBuf> = fs::read_dir(&dir)
        .map(|it| it.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();
    if snaps.len() > 50 {
        snaps.sort();
        let extra = snaps.len() - 50;
        for old in snaps.into_iter().take(extra) {
            let _ = fs::remove_file(old);
        }
    }
    Ok(())
}

#[tauri::command]
async fn save_snapshot(path: String, content: String) -> Result<(), String> {
    save_snapshot_inner(Path::new(&path), &content)
}

#[tauri::command]
async fn list_snapshots(path: String) -> Result<Vec<Snapshot>, String> {
    let dir = history_root()?.join(format!("{:016x}", path_hash(&path)));
    let mut snaps: Vec<Snapshot> = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for e in entries.flatten() {
            let p = e.path();
            if !p.is_file() {
                continue;
            }
            let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            // 形如 20260906_103000_123
            let time = if stem.len() >= 17 {
                format!(
                    "{}-{}-{} {}:{}:{}",
                    &stem[0..4], &stem[4..6], &stem[6..8], &stem[9..11], &stem[11..13], &stem[13..15]
                )
            } else {
                stem.clone()
            };
            let size = e.metadata().map(|m| m.len()).unwrap_or(0);
            snaps.push(Snapshot { file: p.to_string_lossy().to_string(), time, size });
        }
    }
    snaps.sort_by(|a, b| b.time.cmp(&a.time));
    Ok(snaps)
}

#[tauri::command]
async fn read_snapshot_file(file: String) -> Result<String, String> {
    let root = history_root()?;
    let p = PathBuf::from(&file);
    let canonical = p.canonicalize().map_err(|e| format!("路径无效：{e}"))?;
    if !canonical.starts_with(&root) {
        return Err("无权访问该路径".to_string());
    }
    fs::read_to_string(&canonical).map_err(|e| format!("读取快照失败：{e}"))
}

/// 应用数据目录（背景图、历史快照的存放根）
#[tauri::command]
fn data_dir() -> Result<String, String> {
    app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "无法定位应用数据目录".to_string())
}

// ---------- 会话持久化 ----------

/// 保存会话：把内容原样写入「数据目录/session.json」。
/// 数据目录与 data_dir 命令同一套解析（含便携模式）；父目录不存在则先创建。
#[tauri::command]
async fn save_session(content: String) -> Result<(), String> {
    let dir = app_data_dir().ok_or("无法定位应用数据目录")?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败：{e}"))?;
    fs::write(dir.join("session.json"), content).map_err(|e| format!("写入会话失败：{e}"))
}

/// 读取会话：文件不存在或读取失败一律返回空字符串（会话丢失不致命，不让前端报错）
#[tauri::command]
async fn load_session() -> String {
    app_data_dir()
        .and_then(|dir| fs::read_to_string(dir.join("session.json")).ok())
        .unwrap_or_default()
}

// ---------- 单实例：启动参数中的文件路径转发 ----------

/// 判断命令行参数是否是要交给主窗口打开的路径：
/// 必须真实存在；文件还要求扩展名属于可编辑文本类型（TEXT_EXTS），目录则直接放行。
/// 与单实例插件回调、首次启动 setup 共用同一套标准。
fn is_openable_arg(arg: &str) -> bool {
    let p = Path::new(arg);
    if p.is_dir() {
        return true;
    }
    p.is_file() && is_text_ext(arg)
}

/// 把启动参数里筛出的文件/目录路径转发给主窗口：
/// 事件名固定 open-paths，payload 为字符串数组。主窗口不存在时静默丢弃。
fn forward_open_paths(app: &tauri::AppHandle, args: &[String]) {
    let paths: Vec<String> = args.iter().filter(|a| is_openable_arg(a)).cloned().collect();
    if paths.is_empty() {
        return;
    }
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.emit("open-paths", &paths);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例插件必须注册在所有其他插件之前（官方要求）：
        // 二次启动时新进程把命令行参数转交给已有实例后立即退出
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            forward_open_paths(app, &args);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // 首次启动（自身即主实例）：解析自身 argv（跳过第 0 个程序路径），
            // 与单实例回调走完全相同的过滤与转发逻辑。
            // 用 args_os + to_string_lossy 而非 args()：中文/异常字符路径不 panic（见 AGENTS.md 陷阱 8）
            let args: Vec<String> = std::env::args_os()
                .skip(1)
                .map(|a| a.to_string_lossy().to_string())
                .collect();
            forward_open_paths(app.handle(), &args);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            search_workspace,
            replace_workspace,
            list_workspace_files,
            git_run,
            git_status,
            read_file_meta,
            save_bg_image,
            save_snapshot,
            list_snapshots,
            read_snapshot_file,
            data_dir,
            save_session,
            load_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
