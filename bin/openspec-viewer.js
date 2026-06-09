#!/usr/bin/env node
'use strict'

const path = require('path')
const { startServer } = require('../lib/server')

const args = process.argv.slice(2)
let cwd = process.cwd()
let port = 4444

for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--help' || a === '-h') {
    console.log(`openspec-viewer — local web viewer for OpenSpec changes

USAGE
  openspec-viewer [path] [--port <n>]

ARGS
  path           Path to project root or openspec/ dir (default: cwd)

OPTIONS
  --port, -p     Port (default: 4444)
  --help, -h     Show this help

EXAMPLES
  cd ~/Works/my-project && openspec-viewer
  openspec-viewer ~/Works/my-project --port 5000
`)
    process.exit(0)
  } else if (a === '--port' || a === '-p') {
    port = parseInt(args[++i], 10) || port
  } else if (!a.startsWith('-')) {
    cwd = path.resolve(a)
  }
}

startServer({ cwd, port }).catch((err) => {
  console.error('[openspec-viewer] failed:', err.message)
  process.exit(1)
})
