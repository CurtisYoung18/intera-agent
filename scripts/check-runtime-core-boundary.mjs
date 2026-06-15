#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const RUNTIME_CORE_DIR = join(ROOT, 'packages/runtime-core')
const FORBIDDEN = [
  /\bfrom\s+['"]next(?:\/[^'"]*)?['"]/,
  /\bimport\s+['"]next(?:\/[^'"]*)?['"]/,
  /\brequire\(['"]next(?:\/[^'"]*)?['"]\)/,
  /\bfrom\s+['"]react['"]/,
  /\bimport\s+['"]react['"]/,
  /\brequire\(['"]react['"]\)/,
  /\bfrom\s+['"]react-dom(?:\/[^'"]*)?['"]/,
  /\bimport\s+['"]react-dom(?:\/[^'"]*)?['"]/,
  /\brequire\(['"]react-dom(?:\/[^'"]*)?['"]\)/,
]

function walk(dir) {
  const entries = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) entries.push(...walk(path))
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) entries.push(path)
  }
  return entries
}

const violations = []
for (const file of walk(RUNTIME_CORE_DIR)) {
  const text = readFileSync(file, 'utf8')
  for (const pattern of FORBIDDEN) {
    if (pattern.test(text)) {
      violations.push(relative(ROOT, file))
      break
    }
  }
}

if (violations.length > 0) {
  console.error('Runtime core boundary violation: Next/React imports are forbidden in packages/runtime-core.')
  for (const file of violations) console.error(`- ${file}`)
  process.exit(1)
}

console.log(`Runtime core boundary guard passed: ${walk(RUNTIME_CORE_DIR).length} files checked.`)
