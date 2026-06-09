'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')

function findOpenspecRoot(start) {
  // Accept either project root containing openspec/ or the openspec/ dir itself
  let p = path.resolve(start)
  if (path.basename(p) === 'openspec' && fs.existsSync(p)) return p
  // walk up looking for openspec/
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(p, 'openspec')
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate
    const parent = path.dirname(p)
    if (parent === p) break
    p = parent
  }
  return null
}

function safeJoin(root, rel) {
  const target = path.resolve(root, rel)
  if (!target.startsWith(path.resolve(root))) {
    throw new Error('path escapes root')
  }
  return target
}

function readJSON(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (e) {
        reject(e)
      }
    })
  })
}

// Minimal YAML frontmatter parser — supports `key: value` lines only (no nesting,
// no arrays). Strips matching surrounding quotes. Returns null if the file has
// no leading `---` block.
function parseFrontmatter(filepath) {
  if (!fs.existsSync(filepath)) return null
  let raw
  try {
    raw = fs.readFileSync(filepath, 'utf8')
  } catch (e) {
    return null
  }
  // Allow a leading BOM and blank lines but require the very first non-empty
  // line to be `---`. Otherwise treat as no frontmatter (don't scan the body).
  const stripped = raw.replace(/^﻿/, '')
  const firstNonEmpty = stripped.search(/\S/)
  if (firstNonEmpty < 0) return null
  if (stripped.slice(firstNonEmpty, firstNonEmpty + 3) !== '---') return null
  const afterFirst = stripped.slice(firstNonEmpty + 3)
  const endRel = afterFirst.search(/\n---\s*(\n|$)/)
  if (endRel < 0) return null
  const block = afterFirst.slice(0, endRel)
  const out = {}
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    // strip matching quotes
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    out[m[1]] = v
  }
  return out
}

// Read change-level meta. Looks at proposal.md first, then design.md, tasks.md.
// Returns { title, date, status } — any may be undefined.
function readChangeMeta(changeDir) {
  for (const name of ['proposal.md', 'design.md', 'tasks.md']) {
    const fm = parseFrontmatter(path.join(changeDir, name))
    if (fm && (fm.title || fm.date || fm.status)) return fm
  }
  return {}
}

// Replace a leading `---\n...\n---\n` frontmatter block with the same number of
// blank lines so downstream line numbers stay stable for the `:Lnnn` anchors.
function stripFrontmatter(content) {
  const stripped = content.replace(/^﻿/, '')
  const firstNonEmpty = stripped.search(/\S/)
  if (firstNonEmpty < 0) return content
  if (stripped.slice(firstNonEmpty, firstNonEmpty + 3) !== '---') return content
  const afterFirst = stripped.slice(firstNonEmpty + 3)
  // need a closing `---` line followed by EOL or EOF
  const closeMatch = afterFirst.match(/\n---[ \t]*(\n|$)/)
  if (!closeMatch) return content
  const endIdx = firstNonEmpty + 3 + closeMatch.index + closeMatch[0].length
  const head = stripped.slice(0, endIdx)
  const lineCount = (head.match(/\n/g) || []).length
  return '\n'.repeat(lineCount) + stripped.slice(endIdx)
}

// Tally `- [ ]` / `- [x]` checkboxes in tasks.md. Returns { total, done }.
function countTasks(filepath) {
  if (!fs.existsSync(filepath)) return { total: 0, done: 0 }
  const text = fs.readFileSync(filepath, 'utf8')
  let total = 0
  let done = 0
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*-\s*\[([ xX])\]/)
    if (!m) continue
    total++
    if (m[1].toLowerCase() === 'x') done++
  }
  return { total, done }
}

// Status precedence: derived from tasks.md when tasks exist → frontmatter
// override → null. Tasks-derived wins so the sidebar reflects actual progress.
// Returns one of: 'done' | 'in-progress' | 'draft' | null.
function deriveStatus(changeDir, fmStatus) {
  const { total, done } = countTasks(path.join(changeDir, 'tasks.md'))
  if (total > 0) {
    if (done >= total) return 'done'
    if (done === 0) return 'draft'
    return 'in-progress'
  }
  return fmStatus || null
}

function listChanges(openspecRoot) {
  const changesDir = path.join(openspecRoot, 'changes')
  if (!fs.existsSync(changesDir)) return []
  const slugs = fs
    .readdirSync(changesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    // `archive/` is a sibling holding archived changes, not a change itself.
    .filter((d) => d.name !== 'archive')
    .map((d) => d.name)
  const out = slugs.map((slug) => {
    const dir = path.join(changesDir, slug)
    const meta = readChangeMeta(dir)
    return {
      slug,
      title: meta.title || null,
      date: meta.date || null,
      status: deriveStatus(dir, meta.status),
    }
  })
  // Sort: changes with a date come first, newest first; then alphabetical.
  out.sort((a, b) => {
    if (a.date && b.date) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1
      return a.slug.localeCompare(b.slug)
    }
    if (a.date) return -1
    if (b.date) return 1
    return a.slug.localeCompare(b.slug)
  })
  return out
}

function listSpecs(openspecRoot) {
  const specsDir = path.join(openspecRoot, 'specs')
  if (!fs.existsSync(specsDir)) return []
  return fs
    .readdirSync(specsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
}

function walkFiles(root) {
  const out = []
  function walk(dir) {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile() && e.name.endsWith('.md')) out.push(full)
    }
  }
  walk(root)
  return out
}

function getChangeDetails(openspecRoot, change) {
  const dir = safeJoin(path.join(openspecRoot, 'changes'), change)
  if (!fs.existsSync(dir)) return null
  const files = walkFiles(dir).map((full) => ({
    relPath: path.relative(dir, full),
    full,
  }))
  // Categorize
  const known = ['proposal.md', 'design.md', 'tasks.md']
  const top = []
  const specs = []
  const other = []
  for (const f of files) {
    if (known.includes(f.relPath)) top.push(f)
    else if (f.relPath.startsWith('specs' + path.sep)) specs.push(f)
    else other.push(f)
  }
  // ordered: proposal, design, tasks, then specs, then other
  const orderedTop = known
    .map((n) => top.find((f) => f.relPath === n))
    .filter(Boolean)
  return [...orderedTop, ...specs.sort((a, b) => a.relPath.localeCompare(b.relPath)), ...other]
    .map((f) => ({
      relPath: f.relPath,
      content: stripFrontmatter(fs.readFileSync(f.full, 'utf8')),
    }))
}

function execCmd(cmd, cwd) {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: 10000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '', error: err ? err.message : null })
    })
  })
}

async function getStatus(openspecRoot, change) {
  // openspec is invoked from project root (parent of openspec/)
  const projectRoot = path.dirname(openspecRoot)
  const cmd = `openspec status --change "${change}" --json`
  const r = await execCmd(cmd, projectRoot)
  if (!r.ok) return { available: false, error: r.error || r.stderr }
  try {
    // strip any non-JSON noise (e.g. PostHog errors)
    const start = r.stdout.indexOf('{')
    const end = r.stdout.lastIndexOf('}')
    if (start === -1 || end === -1) return { available: false, error: 'no JSON in output' }
    return { available: true, data: JSON.parse(r.stdout.slice(start, end + 1)) }
  } catch (e) {
    return { available: false, error: e.message }
  }
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'Content-Type': type + (type.startsWith('text/') || type === 'application/json' ? '; charset=utf-8' : ''),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

async function startServer({ cwd, port }) {
  const openspecRoot = findOpenspecRoot(cwd)
  if (!openspecRoot) {
    throw new Error(`No openspec/ directory found near ${cwd}. Pass a path containing openspec/.`)
  }
  const projectRoot = path.dirname(openspecRoot)
  const projectName = path.basename(projectRoot)

  const publicDir = path.join(__dirname, '..', 'public')

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    const p = url.pathname

    try {
      // Static assets
      if (p === '/' || p === '/index.html') {
        return send(res, 200, fs.readFileSync(path.join(publicDir, 'index.html')), 'text/html')
      }
      if (p === '/app.js') {
        return send(res, 200, fs.readFileSync(path.join(publicDir, 'app.js')), 'text/javascript')
      }
      if (p === '/styles.css') {
        return send(res, 200, fs.readFileSync(path.join(publicDir, 'styles.css')), 'text/css')
      }

      // API
      if (p === '/api/meta') {
        return send(
          res,
          200,
          JSON.stringify({
            projectName,
            projectRoot,
            openspecRoot,
            changes: listChanges(openspecRoot),
            specs: listSpecs(openspecRoot),
          })
        )
      }
      if (p.startsWith('/api/change/')) {
        const change = decodeURIComponent(p.slice('/api/change/'.length))
        const files = getChangeDetails(openspecRoot, change)
        if (!files) return send(res, 404, JSON.stringify({ error: 'change not found' }))
        const status = await getStatus(openspecRoot, change)
        return send(res, 200, JSON.stringify({ change, files, status }))
      }
      return send(res, 404, JSON.stringify({ error: 'not found' }))
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }))
    }
  })

  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(port, () => {
      const url = `http://localhost:${port}`
      console.log(`[openspec-viewer] project: ${projectName}`)
      console.log(`[openspec-viewer] openspec: ${openspecRoot}`)
      console.log(`[openspec-viewer] open ${url}`)
      resolve(server)
    })
  })
}

module.exports = { startServer }
