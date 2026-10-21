import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const matcherRequire = createRequire(require.resolve('micromatch'))
const root = dirname(matcherRequire.resolve('braces/package.json'))
const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
assert.equal(metadata.name, 'braces', 'Expected upstream braces, not a package alias')
assert.equal(metadata.version, '3.0.3', 'Review the braces patch before upgrading')
const patch = JSON.parse(readFileSync(new URL('../patches/braces-3.0.3.json', import.meta.url)))
const sha256 = (text) => createHash('sha256').update(text).digest('hex')

// Validate every source before writing, so unexpected artifacts fail installation closed.
const updates = patch.map(({ file, before_sha256, after_sha256, replacements }) => {
  const path = join(root, file)
  let source = readFileSync(path, 'utf8')
  if (sha256(source) === after_sha256) return [path, source]
  assert.equal(sha256(source), before_sha256, `Unexpected braces source: ${file}`)
  for (const { before, after } of replacements) source = source.replace(before, after)
  assert.equal(sha256(source), after_sha256, `Invalid braces patch: ${file}`)
  return [path, source]
})
for (const [path, source] of updates) writeFileSync(path, source)
