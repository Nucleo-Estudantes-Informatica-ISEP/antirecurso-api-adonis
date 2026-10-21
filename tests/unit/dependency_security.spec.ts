import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'

const require = createRequire(import.meta.url)
const matcherRequire = createRequire(require.resolve('micromatch'))
type Ast = { type: string; nodes?: Ast[]; value?: string; parent?: Ast }
const braces = matcherRequire('braces') as {
  (pattern: string): string[]
  parse(pattern: string): Ast
  compile(input: string | Ast): string
  expand(input: string | Ast): string[]
  stringify(input: string | Ast): string
}

test.group('Dependency security', () => {
  test('local patch is idempotent and rejects unexpected source or package versions', ({ assert }) => {
    const root = mkdtempSync(join(tmpdir(), 'braces-patch-'))
    try {
      mkdirSync(join(root, 'scripts'))
      mkdirSync(join(root, 'node_modules/micromatch'), { recursive: true })
      writeFileSync(join(root, 'node_modules/micromatch/index.js'), '')
      cpSync(new URL('../../scripts/patch_braces.mjs', import.meta.url), join(root, 'scripts/patch_braces.mjs'))
      cpSync(new URL('../../patches', import.meta.url), join(root, 'patches'), { recursive: true })
      cpSync(dirname(matcherRequire.resolve('braces/package.json')), join(root, 'node_modules/braces'), { recursive: true })
      const run = () => execFileSync(process.execPath, [join(root, 'scripts/patch_braces.mjs')], { stdio: 'pipe' })
      run()
      run()
      const source = join(root, 'node_modules/braces/lib/compile.js')
      const original = readFileSync(source, 'utf8')
      writeFileSync(source, original + '\n// unexpected source\n')
      assert.throws(run, /Unexpected braces source: lib\/compile.js/)
      writeFileSync(source, original)
      const metadata = join(root, 'node_modules/braces/package.json')
      writeFileSync(metadata, JSON.stringify({ name: 'braces', version: '3.0.4' }))
      assert.throws(run, /Review the braces patch before upgrading/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('braces rejects deeply nested strings before recursive traversal', ({ assert }) => {
    for (const [open, close] of [
      ['{', '}'],
      ['(', ')'],
    ]) {
      const pattern = open.repeat(4000) + 'x' + close.repeat(4000)
      for (const process of [braces.parse, braces.compile, braces.expand, braces.stringify]) {
        assert.throws(() => process(pattern), /AST nesting depth exceeds the maximum of 100/)
      }
    }
  })

  test('direct AST callers cannot bypass nesting guards', ({ assert }) => {
    const deepAst = () => {
      const root: Ast = { type: 'root', nodes: [] }
      let parent = root
      for (let depth = 0; depth < 200; depth++) {
        const child: Ast = { type: 'paren', nodes: [], parent }
        parent.nodes!.push(child)
        parent = child
      }
      parent.nodes!.push({ type: 'text', value: 'x', parent })
      return root
    }
    for (const process of [braces.compile, braces.expand, braces.stringify]) {
      assert.throws(() => process(deepAst()), /AST nesting depth exceeds the maximum of 100/)
    }
  })

  test('ordinary nested braces, ranges and compilation keep upstream behavior', ({ assert }) => {
    assert.deepEqual(braces.expand('a/{x,{01..03},y}/c'), [
      'a/x/c',
      'a/01/c',
      'a/02/c',
      'a/03/c',
      'a/y/c',
    ])
    assert.deepEqual(braces('{a,b}{1..2}'), ['(a|b)(1|2)'])
    assert.deepEqual(braces.expand('{a,b}{1..2}'), ['a1', 'a2', 'b1', 'b2'])
    assert.equal(braces.stringify(braces.parse('a/{b,c}/d')), 'a/{b,c}/d')
  })

  test('Adonis glob consumers resolve patched upstream braces and retain file matching', async ({
    assert,
  }) => {
    const globRequire = createRequire(require.resolve('fast-glob'))
    const globMatcherRequire = createRequire(globRequire.resolve('micromatch'))
    assert.equal(globMatcherRequire.resolve('braces'), matcherRequire.resolve('braces'))
    assert.equal(matcherRequire('braces/package.json').name, 'braces')
    assert.equal(matcherRequire('braces/package.json').version, '3.0.3')
    const micromatch = require('micromatch') as (files: string[], pattern: string) => string[]
    assert.deepEqual(
      micromatch(['app/models/question.ts', 'README.md'], 'app/{models,controllers}/*.ts'),
      ['app/models/question.ts']
    )
    const glob = require('fast-glob') as (
      patterns: string[],
      options: { cwd: string }
    ) => Promise<string[]>
    const files = await glob(
      ['app/{models,controllers}/*.ts', 'tests/{unit,functional}/*.spec.ts'],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
      }
    )
    assert.include(files, 'app/models/question.ts')
    assert.include(files, 'app/controllers/questions_controller.ts')
    assert.include(files, 'tests/unit/dependency_security.spec.ts')
    assert.include(files, 'tests/functional/question_import.spec.ts')
  })

  test('brace-expansion bounds nested input and repeated rewrite patterns', ({ assert }) => {
    const { expand } = require('brace-expansion') as { expand(pattern: string): string[] }
    for (const pattern of [
      '{'.repeat(4000) + 'a,b' + '}'.repeat(4000),
      '{a}' + '}'.repeat(2000) + ',z}',
    ]) {
      assert.deepEqual(expand(pattern), [pattern])
    }
    assert.deepEqual(expand('a{b,c}{1..2}'), ['ab1', 'ab2', 'ac1', 'ac2'])
  })

  test('fast-copy rejects extreme nesting with a bounded error and preserves normal copies', ({
    assert,
  }) => {
    const { copy } = require('fast-copy') as { copy<T>(value: T): T }
    type Nested = { child?: Nested; value?: number }
    const input: Nested = {}
    let parent = input
    for (let depth = 0; depth < 2000; depth++) {
      parent.child = {}
      parent = parent.child
    }
    assert.throws(() => copy(input), /Maximum copy depth of 1000 exceeded/)
    const normal = { child: { value: 2 } }
    const cloned = copy(normal)
    assert.deepEqual(cloned, normal)
    assert.notStrictEqual(cloned.child, normal.child)
  })
})
