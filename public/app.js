(() => {
  // ─── helpers ──────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c])
  }

  // Init mermaid only if available
  if (window.mermaid && typeof mermaid.initialize === 'function') {
    try { mermaid.initialize({ startOnLoad: false, theme: 'default' }) } catch (e) {}
  }

  // marked is required; if missing show a clear error
  function ensureMarked() {
    return typeof window.marked !== 'undefined' && typeof marked.parse === 'function'
  }

  function renderMarkdown(md) {
    if (!ensureMarked()) {
      return `<pre>${escapeHtml(md)}</pre>`
    }
    let html
    try {
      html = marked.parse(md, { gfm: true, breaks: false })
    } catch (e) {
      return `<pre>${escapeHtml(md)}</pre>`
    }
    if (typeof window.DOMPurify !== 'undefined' && DOMPurify.sanitize) {
      try {
        html = DOMPurify.sanitize(html, { ADD_TAGS: ['div'], ADD_ATTR: ['class'] })
      } catch (e) {}
    }
    return html
  }

  function postProcess(rootEl) {
    // 1. mermaid: convert <pre><code class="language-mermaid">...</code></pre> into <div class="mermaid">...</div>
    rootEl.querySelectorAll('pre code.language-mermaid, pre code[class*="mermaid"]').forEach((codeEl) => {
      const pre = codeEl.parentElement
      const div = document.createElement('div')
      div.className = 'mermaid'
      div.textContent = codeEl.textContent
      pre.replaceWith(div)
    })

    // 2. hljs: highlight remaining <pre><code>
    if (typeof window.hljs !== 'undefined' && hljs.highlightElement) {
      rootEl.querySelectorAll('pre code').forEach((codeEl) => {
        try { hljs.highlightElement(codeEl) } catch (e) {}
      })
    }

    // 3. task list checkboxes
    rootEl.querySelectorAll('li').forEach((li) => {
      const html = li.innerHTML
      const m = html.match(/^(\[[ xX]\])\s*/)
      if (!m) return
      const isDone = /\[[xX]\]/.test(m[1])
      const stripped = html.slice(m[0].length)
      li.innerHTML = `<span class="task-checkbox${isDone ? ' done' : ''}"></span><span class="${isDone ? 'task-done' : ''}">${stripped}</span>`
      const ul = li.parentElement
      if (ul && ul.tagName === 'UL') ul.classList.add('task-list')
    })
  }

  function runMermaidIn(rootEl) {
    if (!window.mermaid || !mermaid.run) return
    const blocks = rootEl.querySelectorAll('.mermaid:not([data-rendered])')
    if (blocks.length === 0) return
    try {
      mermaid.run({ nodes: Array.from(blocks) })
      blocks.forEach(b => b.setAttribute('data-rendered', '1'))
    } catch (e) { /* per-block errors are fine */ }
  }

  function countTasks(md) {
    const lines = md.split('\n')
    let total = 0, done = 0
    for (const line of lines) {
      const m = line.match(/^\s*-\s*\[([ xX])\]/)
      if (!m) continue
      total++
      if (m[1].toLowerCase() === 'x') done++
    }
    return { total, done }
  }

  function parseLocationHash() {
    const raw = location.hash.slice(1)
    if (!raw) return { change: null, file: null, line: null }
    const slash = raw.indexOf('/')
    const changeRaw = slash >= 0 ? raw.slice(0, slash) : raw
    let rest = slash >= 0 ? raw.slice(slash + 1) : ''
    let line = null
    const lineMatch = rest.match(/:L(\d+)$/i)
    if (lineMatch) {
      line = parseInt(lineMatch[1], 10)
      rest = rest.slice(0, -lineMatch[0].length)
    }
    return {
      change: decodeURIComponent(changeRaw),
      file: rest ? decodeURIComponent(rest) : null,
      line,
    }
  }

  function buildHash(change, file, line) {
    let hash = '#' + encodeURIComponent(change)
    if (file) {
      hash += '/' + encodeURIComponent(file)
      if (line) hash += `:L${line}`
    }
    return hash
  }

  function setHash(change, file, line, replace = false) {
    const next = buildHash(change, file, line)
    if (location.hash === next) return
    if (replace) history.replaceState(null, '', next)
    else history.pushState(null, '', next)
  }

  function splitMarkdownBlocks(md) {
    const lines = md.split('\n')
    const blocks = []
    let i = 0

    function push(start, end) {
      blocks.push({
        startLine: start + 1,
        text: lines.slice(start, end + 1).join('\n'),
      })
    }

    while (i < lines.length) {
      if (!lines[i].trim()) {
        i++
        continue
      }

      const start = i

      if (/^```/.test(lines[i])) {
        i++
        while (i < lines.length && !/^```/.test(lines[i])) i++
        if (i < lines.length) i++
        push(start, i - 1)
        continue
      }

      if (/^\|.*\|$/.test(lines[i])) {
        i++
        while (i < lines.length && /^\|.*\|$/.test(lines[i])) i++
        push(start, i - 1)
        continue
      }

      if (/^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        i++
        while (i < lines.length && (lines[i].trim() === '' || /^\s+/.test(lines[i]) || /^\s*([-*+]|\d+\.)\s+/.test(lines[i]))) i++
        push(start, i - 1)
        continue
      }

      if (/^>\s?/.test(lines[i])) {
        i++
        while (i < lines.length && /^>\s?/.test(lines[i])) i++
        push(start, i - 1)
        continue
      }

      if (/^#{1,6}\s+/.test(lines[i]) || /^---+$/.test(lines[i])) {
        push(start, start)
        i++
        continue
      }

      i++
      while (i < lines.length && lines[i].trim() && !/^#{1,6}\s+/.test(lines[i]) && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) && !/^\|.*\|$/.test(lines[i]) && !/^```/.test(lines[i]) && !/^>\s?/.test(lines[i])) i++
      push(start, i - 1)
    }

    return blocks
  }

  function lineId(fileIdx, line) {
    return `file-${fileIdx}-L${line}`
  }

  function renderLineAnchor(fileIdx, line) {
    return `<button class="line-anchor" data-file-idx="${fileIdx}" data-line="${line}" title="Link to line ${line}" aria-label="Link to line ${line}">L${line}</button>`
  }

  function renderMarkdownWithLineAnchors(md, fileIdx) {
    const blocks = splitMarkdownBlocks(md)
    if (blocks.length === 0) return ''
    return blocks.map((block) => `
      <div class="source-block" id="${lineId(fileIdx, block.startLine)}" data-line="${block.startLine}">
        ${renderLineAnchor(fileIdx, block.startLine)}
        <div class="source-body md">${renderMarkdown(block.text)}</div>
      </div>
    `).join('')
  }

  // ─── Spec parser (Requirements + Scenarios) ───────────────
  function parseSpec(md) {
    const lines = md.split('\n')
    const sections = []
    let currentSection = null
    let currentReq = null
    let currentScenario = null
    let collecting = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const m2 = line.match(/^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements/i)
      if (m2) {
        currentSection = { type: m2[1].toUpperCase(), line: i + 1, requirements: [] }
        sections.push(currentSection)
        currentReq = null
        currentScenario = null
        continue
      }
      const m3 = line.match(/^###\s+Requirement:\s*(.+)$/)
      if (m3 && currentSection) {
        currentReq = { name: m3[1].trim(), line: i + 1, description: '', scenarios: [] }
        currentSection.requirements.push(currentReq)
        currentScenario = null
        collecting = false
        continue
      }
      const m4 = line.match(/^####\s+Scenario:\s*(.+)$/)
      if (m4 && currentReq) {
        currentScenario = { name: m4[1].trim(), line: i + 1, body: [] }
        currentReq.scenarios.push(currentScenario)
        collecting = true
        continue
      }
      if (currentScenario && collecting) {
        if (line.match(/^(##|###|####)\s/)) {
          collecting = false
          i--
          continue
        }
        currentScenario.body.push({ text: line, line: i + 1 })
      } else if (currentReq && !currentScenario) {
        currentReq.description += line + '\n'
      }
    }
    return sections
  }

  // Render Gherkin-style WHEN/THEN/AND steps from scenario body lines
  function renderScenarioSteps(lines) {
    // collect bullet items: each step starts with `- **KEYWORD**`
    const steps = []
    let buf = null
    for (const item of lines) {
      const raw = typeof item === 'string' ? item : item.text
      const line = typeof item === 'string' ? null : item.line
      const m = raw.match(/^\s*-\s+\*\*(WHEN|THEN|AND|GIVEN|BUT)\*\*\s*(.*)$/i)
      if (m) {
        if (buf) steps.push(buf)
        buf = { keyword: m[1].toUpperCase(), text: m[2], line }
      } else if (buf && raw.trim()) {
        // continuation line of previous step
        buf.text += '\n' + raw.replace(/^\s+/, '')
      }
    }
    if (buf) steps.push(buf)

    if (steps.length === 0) {
      // fallback to plain markdown if not Gherkin-shaped
      return `<div class="md">${renderMarkdown(lines.join('\n').trim())}</div>`
    }

    let html = '<div class="gherkin">'
    for (const s of steps) {
      const cls = s.keyword.toLowerCase()
      // render the text as markdown so inline code / **bold** / etc still work,
      // but unwrap the surrounding <p> for inline layout
      let textHtml = renderMarkdown(s.text.trim())
      textHtml = textHtml.replace(/^<p>/, '').replace(/<\/p>\s*$/, '')
      html += `<div class="gherkin-step gherkin-${cls}">
        <span class="gherkin-keyword">${escapeHtml(s.keyword)}</span>
        <span class="gherkin-text md">${textHtml}</span>
      </div>`
    }
    html += '</div>'
    return html
  }

  function renderSpec(md, fileIdx) {
    const sections = parseSpec(md)
    if (sections.length === 0 || sections.every(s => s.requirements.length === 0)) {
      return null
    }
    let html = ''
    for (const sec of sections) {
      if (sec.requirements.length === 0) continue
      const n = sec.requirements.length
      const noun = n === 1 ? 'requirement' : 'requirements'
      html += `<h2 class="spec-section-title">${sec.type} Requirements <span class="req-count">${n} ${noun}</span></h2>`
      html += '<div class="requirements-grid">'
      for (const req of sec.requirements) {
        html += `<div class="requirement-card source-block" id="${lineId(fileIdx, req.line)}" data-line="${req.line}">`
        html += `${renderLineAnchor(fileIdx, req.line)}`
        html += `<div class="source-body">`
        html += `<h3>${escapeHtml(req.name)}</h3>`
        if (req.description.trim()) {
          html += `<div class="md">${renderMarkdown(req.description.trim())}</div>`
        }
        if (req.scenarios.length > 0) {
          html += `<ul class="scenarios-list">`
          for (const sc of req.scenarios) {
            html += `<li class="scenario-item source-block" id="${lineId(fileIdx, sc.line)}" data-line="${sc.line}">`
            html += `${renderLineAnchor(fileIdx, sc.line)}`
            html += `<div class="source-body">`
            html += `<div class="scenario-name">${escapeHtml(sc.name)}</div>`
            html += renderScenarioSteps(sc.body)
            html += `</div>`
            html += `</li>`
          }
          html += `</ul>`
        }
        html += `</div></div>`
      }
      html += '</div>'
    }
    return html
  }

  // ─── State + UI ───────────────────────────────────────────
  const state = {
    meta: null,
    currentChange: null,
    currentChangeData: null,
    currentTab: null,
  }

  async function fetchJSON(url, opts) {
    const r = await fetch(url, opts)
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
    return r.json()
  }

  function showFatal(msg) {
    document.getElementById('content').innerHTML =
      `<div class="error-box"><b>Init failed:</b> ${escapeHtml(msg)}<br><br>` +
      `Open DevTools console (F12) and reload to see full stack.</div>`
  }

  async function init() {
    try {
      state.meta = await fetchJSON('/api/meta')
    } catch (e) {
      showFatal('Cannot reach /api/meta — ' + e.message)
      return
    }

    renderChangeList()
    renderSpecList()

    const hash = parseLocationHash()
    if (hash.change) {
      const slugs = state.meta.changes.map((c) => (typeof c === 'string' ? c : c.slug))
      if (slugs.includes(hash.change)) {
        await loadChange(hash.change, hash.file, hash.line, { replaceHash: true })
      }
    }
  }

  function renderChangeList() {
    const ul = document.getElementById('changeList')
    if (!ul) return
    if (!state.meta.changes.length) {
      ul.innerHTML = '<li style="color: var(--text-dim); font-style: italic; cursor: default;">— none —</li>'
      return
    }
    // Backward compat: server may return either string[] or { slug, title, date, status }[].
    const items = state.meta.changes.map((c) =>
      typeof c === 'string' ? { slug: c, title: null, date: null, status: null } : c
    )
    ul.innerHTML = items.map((c) => {
      const headline = c.title || c.slug
      const titleAttr = c.title ? `${c.title} (${c.slug})` : c.slug
      const subParts = []
      if (c.date) subParts.push(`<span class="nav-date">${escapeHtml(c.date)}</span>`)
      if (c.status) subParts.push(`<span class="nav-status nav-status-${escapeHtml(c.status)}">${escapeHtml(c.status)}</span>`)
      const sub = subParts.length
        ? `<span class="nav-sub">${subParts.join('<span class="nav-sub-sep">·</span>')}</span>`
        : ''
      return `<li data-change="${escapeHtml(c.slug)}" title="${escapeHtml(titleAttr)}">
        <div class="nav-text">
          <span class="nav-name">${escapeHtml(headline)}</span>
          ${sub}
        </div>
      </li>`
    }).join('')
    ul.querySelectorAll('li').forEach((li) => {
      li.addEventListener('click', () => loadChange(li.dataset.change))
    })
  }

  function renderSpecList() {
    const ul = document.getElementById('specList')
    const section = document.getElementById('specsSection')
    if (!ul || !section) return
    if (state.meta.specs.length === 0) {
      section.style.display = 'none'
      return
    }
    section.style.display = ''
    ul.innerHTML = state.meta.specs.map((s) =>
      `<li title="${escapeHtml(s)}"><span class="nav-name">${escapeHtml(s)}</span></li>`
    ).join('')
  }

  async function loadChange(changeName, fileToShow, lineToShow, options = {}) {
    state.currentChange = changeName
    document.querySelectorAll('#changeList li').forEach((li) => {
      li.classList.toggle('active', li.dataset.change === changeName)
    })
    if (!fileToShow) setHash(changeName, null, null, !!options.replaceHash)

    document.getElementById('content').innerHTML = '<div class="empty"><p>Loading…</p></div>'
    try {
      const data = await fetchJSON('/api/change/' + encodeURIComponent(changeName))
      state.currentChangeData = data
      renderChange(data, fileToShow, lineToShow, options)
      updateProgressBadgeForCurrent()
    } catch (e) {
      document.getElementById('content').innerHTML =
        `<div class="error-box">Failed to load: ${escapeHtml(e.message)}</div>`
    }
  }

  function renderChange(data, fileToShow, lineToShow, options = {}) {
    const { change, files, status } = data
    const main = document.getElementById('content')

    let statusHtml = ''
    if (status && status.available && status.data && status.data.artifacts) {
      const arts = status.data.artifacts
      const overall = `${arts.filter(a => a.status === 'done').length}/${arts.length} done`
      statusHtml = `<div class="change-status">
        <span class="status-pill">${escapeHtml(overall)}</span>
        ${arts.map(a => `<span class="status-pill ${a.status}">${escapeHtml(a.id)}: ${escapeHtml(a.status)}</span>`).join('')}
      </div>`
    } else if (status && status.error) {
      statusHtml = `<div class="change-status"><span class="status-pill" title="${escapeHtml(status.error)}">openspec status unavailable</span></div>`
    }

    const specFiles = []
    const tabButtons = []
    files.forEach((f, i) => {
      if (f.relPath.startsWith('specs/')) {
        const name = f.relPath
          .replace(/^specs\//, '')
          .replace(/\/spec\.md$/, '')
          .replace(/\.md$/, '')
        specFiles.push({ idx: i, name, fullPath: f.relPath })
        return
      }
      let label = f.relPath
      if (label === 'proposal.md') label = '📋 Proposal'
      else if (label === 'design.md') label = '🏗️ Design'
      else if (label === 'tasks.md') label = '✅ Tasks'
      else label = '📄 ' + label
      tabButtons.push(`<button class="tab" data-idx="${i}" title="${escapeHtml(f.relPath)}">${escapeHtml(label)}</button>`)
    })

    // Specs entry — always a single "Specs ▾" trigger when there is at least one spec
    if (specFiles.length > 0) {
      const items = specFiles.map(s =>
        `<button class="spec-dropdown-item" data-idx="${s.idx}" title="${escapeHtml(s.fullPath)}">${escapeHtml(s.name)}</button>`
      ).join('')
      const countBadge = specFiles.length > 1
        ? `<span class="spec-count">${specFiles.length}</span>`
        : ''
      tabButtons.push(`
        <div class="spec-dropdown" id="specDropdown">
          <button class="tab spec-dropdown-trigger" id="specDropdownBtn" type="button">
            📐 Specs ${countBadge} <span class="dropdown-caret">▾</span>
          </button>
          <div class="spec-dropdown-menu spec-dropdown-menu-aligned" id="specDropdownMenu">
            ${items}
          </div>
        </div>
      `)
    }

    const tabsHtml = tabButtons.join('')

    // store specFiles for later use in activateTab
    state.currentSpecFiles = specFiles
    state.currentFiles = files

    main.innerHTML = `
      <div class="change-header">
        <h1>${escapeHtml(change)}</h1>
        ${statusHtml}
      </div>
      <div class="tabs">${tabsHtml}</div>
      <div class="selected-spec-bar" id="selectedSpecBar"></div>
      <div id="filePanels"></div>
    `

    const panelsEl = document.getElementById('filePanels')
    files.forEach((f, i) => {
      const panel = document.createElement('div')
      panel.className = 'file-content'
      panel.dataset.idx = i

      let inner = ''

      if (f.relPath === 'tasks.md') {
        const { total, done } = countTasks(f.content)
        const pct = total === 0 ? 0 : Math.round((done / total) * 100)
        inner += `<div class="tasks-progress">
          <div class="tasks-progress-bar"><div class="tasks-progress-fill" style="width: ${pct}%"></div></div>
          <div class="tasks-progress-text"><strong>${done}</strong> / ${total} · ${pct}%</div>
        </div>`
        inner += renderMarkdownWithLineAnchors(f.content, i)
      } else if (f.relPath.startsWith('specs/')) {
        const structured = renderSpec(f.content, i)
        if (structured) {
          inner += structured
        } else {
          inner += renderMarkdownWithLineAnchors(f.content, i)
        }
      } else {
        inner += renderMarkdownWithLineAnchors(f.content, i)
      }

      panel.innerHTML = inner
      panelsEl.appendChild(panel)
      panel.querySelectorAll('.md').forEach((md) => postProcess(md))
    })

    main.querySelectorAll('.line-anchor').forEach((anchor) => {
      anchor.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const idx = parseInt(anchor.dataset.fileIdx, 10)
        const line = parseInt(anchor.dataset.line, 10)
        activateTab(idx, { line, scroll: false })
      })
    })

    main.querySelectorAll('.tab[data-idx]').forEach((tab) => {
      tab.addEventListener('click', () => activateTab(parseInt(tab.dataset.idx, 10)))
    })

    // Specs dropdown behavior
    const ddBtn = main.querySelector('#specDropdownBtn')
    const ddMenu = main.querySelector('#specDropdownMenu')
    if (ddBtn && ddMenu) {
      ddBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        ddMenu.classList.toggle('open')
      })
      ddMenu.querySelectorAll('.spec-dropdown-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          e.stopPropagation()
          activateTab(parseInt(item.dataset.idx, 10))
          ddMenu.classList.remove('open')
        })
      })
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#specDropdown')) {
          ddMenu.classList.remove('open')
        }
      })
    }

    let initialIdx = 0
    if (fileToShow) {
      const found = files.findIndex(f => f.relPath === fileToShow)
      if (found >= 0) initialIdx = found
    }
    activateTab(initialIdx, { line: lineToShow, replaceHash: !!options.replaceHash })
  }

  function activateTab(idx, options = {}) {
    // panels: index by data-idx (matches files index)
    document.querySelectorAll('.file-content').forEach((p) => {
      p.classList.toggle('active', parseInt(p.dataset.idx, 10) === idx)
    })

    // direct tabs (proposal/design/tasks/extra files)
    document.querySelectorAll('.tab[data-idx]').forEach((t) => {
      t.classList.toggle('active', parseInt(t.dataset.idx, 10) === idx)
    })

    // dropdown handling — Specs trigger stays as "Specs", selected spec name shows on a second line
    const trigger = document.getElementById('specDropdownBtn')
    const menu = document.getElementById('specDropdownMenu')
    const selectedBar = document.getElementById('selectedSpecBar')
    const specFiles = state.currentSpecFiles || []

    let activeSpec = null
    if (trigger && menu) {
      const items = Array.from(menu.querySelectorAll('.spec-dropdown-item'))
      activeSpec = specFiles.find((s) => s.idx === idx) || null
      items.forEach((it) => it.classList.toggle('active', parseInt(it.dataset.idx, 10) === idx))
      trigger.classList.toggle('active', !!activeSpec)
    }

    if (selectedBar) {
      if (activeSpec) {
        selectedBar.innerHTML = `<span class="selected-spec-pill" title="${escapeHtml(activeSpec.fullPath)}">📐 ${escapeHtml(activeSpec.name)}</span>`
        selectedBar.classList.add('show')
      } else {
        selectedBar.innerHTML = ''
        selectedBar.classList.remove('show')
      }
    }

    state.currentTab = idx
    const activeFile = state.currentFiles && state.currentFiles[idx]
    if (activeFile && state.currentChange) {
      setHash(state.currentChange, activeFile.relPath, options.line || null, !!options.replaceHash)
    }
    if (options.line) {
      highlightLine(idx, options.line)
    } else {
      clearLineHighlight()
    }
    setTimeout(() => {
      const active = document.querySelector('.file-content.active')
      if (active) runMermaidIn(active)
      if (options.line && options.scroll !== false) {
        scrollToLine(idx, options.line)
      }
    }, 0)
  }

  function clearLineHighlight() {
    document.querySelectorAll('.source-block.line-highlight').forEach((el) => {
      el.classList.remove('line-highlight')
    })
  }

  function getClosestLineBlock(fileIdx, line) {
    const panel = document.querySelector(`.file-content[data-idx="${fileIdx}"]`)
    if (!panel) return null
    const blocks = Array.from(panel.querySelectorAll('.source-block[data-line]'))
    if (blocks.length === 0) return null
    let best = blocks[0]
    let bestLine = parseInt(best.dataset.line, 10)
    for (const block of blocks) {
      const blockLine = parseInt(block.dataset.line, 10)
      if (blockLine <= line && blockLine >= bestLine) {
        best = block
        bestLine = blockLine
      }
    }
    return best
  }

  function highlightLine(fileIdx, line) {
    clearLineHighlight()
    const block = getClosestLineBlock(fileIdx, line)
    if (block) block.classList.add('line-highlight')
  }

  function scrollToLine(fileIdx, line) {
    const block = getClosestLineBlock(fileIdx, line)
    if (!block) return
    block.scrollIntoView({ behavior: 'smooth', block: 'center' })
    highlightLine(fileIdx, line)
  }

  function updateProgressBadgeForCurrent() {
    const data = state.currentChangeData
    if (!data) return
    const tasks = data.files.find(f => f.relPath === 'tasks.md')
    if (!tasks) return
    const { total, done } = countTasks(tasks.content)
    if (total === 0) return
    const li = document.querySelector(`#changeList li[data-change="${data.change}"]`)
    if (li && !li.querySelector('.progress')) {
      const pct = Math.round((done / total) * 100)
      const span = document.createElement('span')
      span.className = 'progress'
      span.textContent = `${done}/${total}`
      span.title = `${done}/${total} tasks (${pct}%)`
      li.appendChild(span)
    }
  }

  // ─── Theme toggle ─────────────────────────────────────────
  const THEME_KEY = 'openspec-viewer-theme'

  function getInitialTheme() {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') return saved
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark'
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme)
    const btn = document.getElementById('themeToggle')
    if (btn) {
      const icon = btn.querySelector('.theme-icon')
      if (icon) icon.textContent = theme === 'light' ? '☀️' : '🌙'
      btn.title = theme === 'light' ? 'Switch to dark' : 'Switch to light'
    }
    // Swap highlight.js theme stylesheet
    const dark = document.getElementById('hljs-theme-dark')
    const light = document.getElementById('hljs-theme-light')
    if (dark && light) {
      if (theme === 'light') {
        dark.disabled = true; dark.media = 'none'
        light.disabled = false; light.media = 'all'
      } else {
        dark.disabled = false; dark.media = 'all'
        light.disabled = true; light.media = 'none'
      }
    }
  }

  function setupThemeToggle() {
    const btn = document.getElementById('themeToggle')
    if (!btn) return
    applyTheme(getInitialTheme())
    btn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'dark'
      const next = cur === 'dark' ? 'light' : 'dark'
      localStorage.setItem(THEME_KEY, next)
      applyTheme(next)
    })
  }

  // apply theme as early as possible (before fetching) to avoid flash
  setupThemeToggle()

  // ─── Line anchor toggle ───────────────────────────────────
  const LINE_ANCHORS_KEY = 'openspec-viewer-line-anchors'

  function applyLineAnchors(visible) {
    document.body.classList.toggle('show-line-anchors', !!visible)
    const btn = document.getElementById('lineToggle')
    if (btn) {
      btn.classList.toggle('active', !!visible)
      btn.title = visible ? 'Hide line links' : 'Show line links'
      btn.setAttribute('aria-label', visible ? 'Hide line links' : 'Show line links')
      btn.setAttribute('aria-pressed', visible ? 'true' : 'false')
    }
  }

  function setupLineAnchorsToggle() {
    const btn = document.getElementById('lineToggle')
    if (!btn) return
    applyLineAnchors(localStorage.getItem(LINE_ANCHORS_KEY) === 'visible')
    btn.addEventListener('click', () => {
      const next = !document.body.classList.contains('show-line-anchors')
      localStorage.setItem(LINE_ANCHORS_KEY, next ? 'visible' : 'hidden')
      applyLineAnchors(next)
    })
  }

  setupLineAnchorsToggle()

  // ─── Sidebar collapse ─────────────────────────────────────
  const SIDEBAR_KEY = 'openspec-viewer-sidebar'

  function applySidebar(collapsed) {
    document.body.classList.toggle('sidebar-collapsed', !!collapsed)
  }

  // Keep this in sync with the @media breakpoint in styles.css.
  const MOBILE_QUERY = '(max-width: 1279px)'

  function isMobile() {
    return window.matchMedia && window.matchMedia(MOBILE_QUERY).matches
  }

  function setupSidebarToggle() {
    // Mobile defaults to collapsed regardless of saved state — overlay drawers
    // should stay out of the way until the user asks for them.
    const saved = localStorage.getItem(SIDEBAR_KEY)
    const initial = isMobile() ? true : saved === 'collapsed'
    applySidebar(initial)

    const hide = document.getElementById('sidebarHide')
    const show = document.getElementById('sidebarShow')
    const backdrop = document.getElementById('sidebarBackdrop')
    function setCollapsed(collapsed) {
      // Only persist the explicit choice on desktop. On mobile, every page-load
      // should start collapsed — the user's desktop preference is what we save.
      if (!isMobile()) {
        localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded')
      }
      applySidebar(collapsed)
    }
    if (hide) hide.addEventListener('click', () => setCollapsed(true))
    if (show) show.addEventListener('click', () => setCollapsed(false))
    if (backdrop) backdrop.addEventListener('click', () => setCollapsed(true))

    // Keyboard shortcut: Cmd/Ctrl + B
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setCollapsed(!document.body.classList.contains('sidebar-collapsed'))
      }
    })

    // Re-evaluate on viewport changes — switching from desktop→mobile should
    // collapse; mobile→desktop should restore the saved desktop preference.
    if (window.matchMedia) {
      const mql = window.matchMedia(MOBILE_QUERY)
      const onChange = () => {
        if (mql.matches) {
          applySidebar(true)
        } else {
          applySidebar(localStorage.getItem(SIDEBAR_KEY) === 'collapsed')
        }
      }
      if (mql.addEventListener) mql.addEventListener('change', onChange)
      else if (mql.addListener) mql.addListener(onChange) // Safari < 14 fallback
    }
  }

  setupSidebarToggle()

  // start
  init().catch(e => {
    showFatal(e.message || String(e))
    console.error(e)
  })
})()
