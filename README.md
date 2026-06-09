OpenSpec Viewer
===============

> 本機 OpenSpec 文件瀏覽器 — 一個指令啟動，瀏覽器體驗遠勝 IDE 的 markdown preview。

把 `openspec/changes/*` 變成可導覽的網頁版需求清單：左側 sidebar 列出所有變更（中文標題 + 日期 + 進度），點進去右側看 proposal / design / tasks / specs，自帶 mermaid、表格、tasks 進度條、結構化 spec 卡片。

## 為什麼想用它

- **比 IDE 直觀** — 表格不會跑版、mermaid 圖直接渲染、tasks.md 自動算進度條
- **比 GitHub 預覽快** — 純本機 + 改完即時可看，無需 push
- **聚合所有 change** — 一頁掌握全部需求，不用一個個切檔
- **零安裝依賴** — server 只用 Node 內建模組，前端走 CDN

## 一行裝好

```bash
cd ~/Tools/openspec-viewer
npm link            # 全域註冊 `openspec-viewer` 指令；不安裝任何 npm 包
```

> 沒 npm 也行：`node ~/Tools/openspec-viewer/bin/openspec-viewer.js` 一樣可跑。

## 在 Terminal 直接打開（推薦用法）

只要 `cd` 到任何含 `openspec/` 的專案根，敲一個指令就好：

```bash
cd ~/Works/my-project
openspec-viewer
# → 在 http://localhost:4444 啟動，瀏覽器自動可開
```

支援的選項：

| 用法 | 說明 |
|---|---|
| `openspec-viewer` | 在 cwd 找 `openspec/`，預設 port 4444 |
| `openspec-viewer ~/Works/foo` | 指定專案路徑 |
| `openspec-viewer --port 5000` | 換 port |
| `openspec-viewer -h` | 看 help |

> 想在背景常駐？`nohup openspec-viewer > /tmp/openspec.log 2>&1 & disown`，之後關 terminal 也不會被殺。

## 功能一覽

### Sidebar（左側）

- **中文標題 + 日期 + 狀態** 一目了然，按日期降序排列
- **狀態自動推導**：根據 `tasks.md` 勾選比例算 `done` / `in-progress` / `draft`
- **進度 badge**：`12/30` 直接顯示在 item 右側
- **響應式 drawer**：視窗 < 1280px 時 sidebar 變浮動 drawer，配 backdrop 點擊關閉
- **快捷鍵**：⌘B 開合 sidebar

### 主畫面（右側）

- **Tabs**：proposal / design / tasks / specs 一鍵切換
- **tasks.md**：頂部進度條 + checkbox 視覺化
- **specs**：解析 `### Requirement:` / `#### Scenario:` 為卡片式呈現（含 Gherkin WHEN/THEN/AND）
- **mermaid 圖**：```mermaid 區塊自動渲染
- **代碼高亮**：highlight.js
- **行號錨點**：URL 帶 `:L42` 直接跳到對應段落，可貼給同事

### 元資料 — Frontmatter（選用，但建議）

在每個 `proposal.md`（沒有就用 `design.md`）開頭加一段 YAML frontmatter，sidebar 就會顯示標題與日期：

```markdown
---
title: My change title
date: 2026-06-09
status: in-progress   # 選填；通常自動推導比較準
---

## Why
...
```

| 欄位 | 用途 | 何時用 |
|---|---|---|
| `title` | sidebar 顯示的中文名 | 想要好看的 sidebar 就加 |
| `date` | 用來排序（降序） | 想要最新需求排最上面就加 |
| `status` | 覆寫狀態 | **沒有 `tasks.md` 時** fallback；有 tasks 時自動算優先 |

沒寫 frontmatter 的 change 也能瀏覽，sidebar 會 fallback 顯示 slug（資料夾名）。

## URL / 分享連結

```
http://localhost:4444/                        ← 首頁
http://localhost:4444/#my-change              ← 直開某個 change
http://localhost:4444/#my-change/proposal.md  ← 直開某 tab
http://localhost:4444/#my-change/proposal.md:L42 ← 直跳到第 42 行
```

## 主題切換

右上角 🌙/☀️ 按鈕，深淺模式切換並記到 localStorage。

## 不要手動 install 任何 npm 包

- **Server**：純 Node 內建（`http`、`fs`、`child_process`）
- **前端**：marked / DOMPurify / highlight.js / mermaid 全走 CDN
- 第一次開需要連網（之後瀏覽器 cache 跑得起來）

## 結構

```
openspec-viewer/
├── bin/openspec-viewer.js   # CLI entry
├── lib/server.js            # HTTP server + frontmatter 解析 + status 推導
├── public/
│   ├── index.html
│   ├── app.js               # 前端邏輯（sidebar、tabs、URL hash、響應式）
│   └── styles.css           # 樣式（含 mobile drawer breakpoint）
└── package.json
```

## License

MIT
