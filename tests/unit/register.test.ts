// Behavior of fold-command-diffs's ToolUse and ToolResult hooks, its `commands` option and its
// /fold-command-diffs switch
import { test, describe, expect, mock } from 'claude-code/testing'
import { register } from '../../plugin/hooks/register.js'

const SURFACES = ['terminal', 'desktop'] as const
const STOCK = 'STOCK DRAWING'
const HINT = 'ctrl+o shows the diff'

type Props = { tool: string; output: unknown; isErrored?: boolean; isExpanded?: boolean }

// Stand in for the stock drawing beneath the mod, and for the session's directory (`cwd`, or a
// failing call when null); record the ToolResult props that reach the drawing
function stand(on: any, cwd: string | null = '/w') {
  const seen: any[] = []
  on('session.cwd', async () => {
    if (cwd === null) throw new Error('no cwd')
    return { value: cwd }
  })
  on('ui.render', { component: 'ToolUse' }, async ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return Text({ children: ['ROW'] })
  })
  on('ui.render', { component: 'ToolResult' }, async ($$: any, e: any) => {
    seen.push(e.props)
    const { Text } = $$.ui.resolve(e)
    return Text({ children: [STOCK] })
  })
  return seen
}

// Draw a call's row (which records whether it runs a matched command), then its result block
let rowId = 0
async function draw($: any, surface: (typeof SURFACES)[number], command: string | undefined, p: Props, id = `toolu_${++rowId}`) {
  const row = await $.ui.mount({
    plugin: 'fold-command-diffs',surface, component: 'ToolUse', requestId: id,
    props: { tool_use_id: id, tool: p.tool, input: command === undefined ? {} : { command }, isRunning: false, isErrored: false, isInterrupted: false },
  })
  await row.drawn()
  await row.unmount()
  const props = { tool_use_id: id, isErrored: false, ...p }
  const ui = await $.ui.mount({ plugin: 'fold-command-diffs',surface, component: 'ToolResult', requestId: id, props })
  const tree = await ui.drawn()
  await ui.unmount()
  return { tree, props }
}

// What opens every mod line: the stock gutter in the terminal, then the matched command's name
const lead = (surface: string, name = 'stg') => (surface === 'terminal' ? '  ⎿  ' : '') + name + ': '
const hunk = (...lines: string[]) => ({ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines })
const bash = (diff: unknown) => ({ tool: 'Bash', output: { stdout: 'out', stderr: '', interrupted: false, isImage: false, noOutputExpected: false, bashEditDiff: diff } })
const ONE = bash({ files: [{ filePath: '/w/a.txt', hunks: [hunk(' one', '-two', '+TWO')] }], moreFiles: 0, changedFiles: ['/w/a.txt'] })

// The text of each row under the stock drawing, or null when the stock drawing came back alone
function rows(surface: string, tree: any, name = 'stg'): string[] | null {
  if (tree.type !== 'Box') return null
  const [stock, ...rest] = tree.children as any[]
  expect(stock.children.join('')).toBe(STOCK)
  return rest.map(r => {
    expect(r.props).toMatchObject({ dimColor: true, wrap: 'truncate-middle' })
    const text = r.children.join('')
    expect(text.startsWith(lead(surface, name))).toBe(true)
    return text.slice(lead(surface, name).length)
  })
}

for (const surface of SURFACES) {
  describe(`${surface}: which commands match the default, stg and quilt`, () => {
    const cases: [string, boolean][] = [
      ['stg pop', true],
      ['quilt push -a', true],
      ['cd /w && quilt pop', true],
      ['stg', true],
      ['cd /w && stg goto p3', true],
      ['ls; stg series', true],
      ['(cd /w && stg push)', true],
      ['FOO=1 BAR= stg refresh', true],
      ['git status\nstg pop', true],
      ['stg series | head', true],
      ['./stg pop', true],
      ['/usr/bin/stg pop', true],
      ['git checkout other', false],
      ['git stg pop', false],
      ['stg-msg seed p1', false],
      ['~/.agents/skills/palves-stg/scripts/stg-msg apply p1', false],
      ['/opt/stg/bin/other pop', false],
      ['echo stg', false],
      ['grep -r stg .', false],
      ['', false],
    ]
    for (const [command, muted] of cases) {
      test(`${surface}: ${JSON.stringify(command)} ${muted ? 'is' : 'is not'} folded`, async ($, on) => {
        const seen = stand(on)
        const { tree, props } = await draw($, surface, command, ONE)
        if (muted) {
          const name = command.includes('quilt') ? 'quilt' : 'stg'
          expect(rows(surface, tree, name)).toEqual(['Updated a.txt (+1 -1)', HINT])
          // the stock drawing gets the command's own output, without the diff
          const { bashEditDiff, ...rest } = (props as any).output
          expect(seen[0].output).toEqual(rest)
        } else {
          expect(rows(surface, tree)).toBeNull()
          expect(seen[0]).toEqual(props)
        }
      })
    }
  })

  describe(`${surface}: the commands option`, () => {
    const WRAP = { options: { commands: 'stg stg-wrap' } }
    test(`${surface}: a listed wrapper run by path is folded under its own name`, WRAP, async ($, on) => {
      stand(on)
      const { tree } = await draw($, surface, '~/bin/stg-wrap goto p2', ONE)
      expect(rows(surface, tree, 'stg-wrap')).toEqual(['Updated a.txt (+1 -1)', HINT])
    })
    test(`${surface}: stg still folded when listed with others`, WRAP, async ($, on) => {
      stand(on)
      const { tree } = await draw($, surface, 'stg pop', ONE)
      expect(rows(surface, tree)).toEqual(['Updated a.txt (+1 -1)', HINT])
    })
    test(`${surface}: the first matching part names the line`, WRAP, async ($, on) => {
      stand(on)
      const { tree } = await draw($, surface, 'stg-wrap pop && stg push', ONE)
      expect(rows(surface, tree, 'stg-wrap')).not.toBeNull()
    })
    test(`${surface}: a list without stg leaves stg alone`, { options: { commands: 'quilt' } }, async ($, on) => {
      stand(on)
      expect(rows(surface, (await draw($, surface, 'stg pop', ONE)).tree)).toBeNull()
      expect(rows(surface, (await draw($, surface, 'quilt push', ONE)).tree, 'quilt')).not.toBeNull()
    })
    test(`${surface}: commas and extra spaces separate names too`, { options: { commands: ' guilt, ,stg-wrap ' } }, async ($, on) => {
      stand(on)
      expect(rows(surface, (await draw($, surface, 'guilt push', ONE)).tree, 'guilt')).not.toBeNull()
      expect(rows(surface, (await draw($, surface, 'stg-wrap pop', ONE)).tree, 'stg-wrap')).not.toBeNull()
      expect(rows(surface, (await draw($, surface, 'stg pop', ONE)).tree)).toBeNull()
    })
    test(`${surface}: an empty string means the default`, { options: { commands: '  ' } }, async ($, on) => {
      stand(on)
      expect(rows(surface, (await draw($, surface, 'stg pop', ONE)).tree)).not.toBeNull()
      expect(rows(surface, (await draw($, surface, 'quilt pop', ONE)).tree, 'quilt')).not.toBeNull()
    })
  })

  describe(`${surface}: stock drawing kept`, () => {
    const cases: [string, string | undefined, Props][] = [
      ['ctrl+o (expanded)', 'stg pop', { ...ONE, isExpanded: true }],
      ['errored stg command', 'stg pop', { ...ONE, isErrored: true }],
      ['stg command that changed no file', 'stg pop', bash({ files: [], moreFiles: 0 })],
      ['stg command with no diff field', 'stg series', { tool: 'Bash', output: { stdout: 'out', stderr: '' } }],
      ['Bash call with no command', undefined, ONE],
      ['Edit', 'stg pop', { tool: 'Edit', output: { filePath: 'a.ts', structuredPatch: [hunk('+x')] } }],
    ]
    for (const [name, command, props] of cases) {
      test(`${surface}: ${name}`, async ($, on) => {
        const seen = stand(on)
        const { tree, props: sent } = await draw($, surface, command, props)
        expect(rows(surface, tree)).toBeNull()
        expect(seen).toHaveLength(1)
        expect(seen[0]).toEqual(sent)
      })
    }
  })

  describe(`${surface}: file lines`, () => {
    test(`${surface}: created, deleted and updated files, path escaped`, async ($, on) => {
      stand(on)
      const diff = {
        files: [
          { filePath: '/w/n.txt', hunks: [hunk('+x', '+y')], created: true },
          { filePath: '/w/o.txt', hunks: [hunk('-p')], deleted: true },
          { filePath: '/w/a\x1b[2Jb', hunks: [] },
        ],
        moreFiles: 0,
      }
      const { tree } = await draw($, surface, 'stg pop', bash(diff))
      expect(rows(surface, tree)).toEqual(['Created n.txt (+2 -0)', 'Deleted o.txt (+0 -1)', 'Updated a\\x1b[2Jb (+0 -0)', HINT])
    })

    test(`${surface}: more than ten files collapse into one line`, async ($, on) => {
      stand(on)
      const files = Array.from({ length: 15 }, (_, i) => ({ filePath: `/w/f${i}`, hunks: [hunk('+x')] }))
      const { tree } = await draw($, surface, 'stg goto p9', bash({ files, moreFiles: 4 }))
      const got = rows(surface, tree)!
      expect(got).toHaveLength(12)
      expect(got.slice(0, 10)).toEqual(files.slice(0, 10).map(f => `Updated ${f.filePath.slice('/w/'.length)} (+1 -0)`))
      expect(got.slice(10)).toEqual(['… 9 more files', HINT])
    })

    test(`${surface}: exactly ten files are all listed`, async ($, on) => {
      stand(on)
      const files = Array.from({ length: 10 }, (_, i) => ({ filePath: `/w/f${i}`, hunks: [] }))
      const { tree } = await draw($, surface, 'stg push', bash({ files, moreFiles: 0 }))
      expect(rows(surface, tree)).toHaveLength(11)
    })
  })

  describe(`${surface}: paths relative to the session's directory`, () => {
    const diff = {
      files: [
        { filePath: '/w/src/main.c', hunks: [hunk('+x')] },
        { filePath: '/elsewhere/b.txt', hunks: [hunk('+x')] },
        { filePath: '/wx/c.txt', hunks: [hunk('+x')] },
      ],
      moreFiles: 1,
      changedFiles: ['/w/src/main.c', '/w/big.bin'],
    }
    test(`${surface}: under it relative, outside it and a sibling sharing the prefix absolute`, async ($, on) => {
      stand(on)
      const { tree } = await draw($, surface, 'stg pop', bash(diff))
      expect(rows(surface, tree)).toEqual(['Updated src/main.c (+1 -0)', 'Updated /elsewhere/b.txt (+1 -0)', 'Updated /wx/c.txt (+1 -0)', 'Changed big.bin', HINT])
    })
    test(`${surface}: a directory given with a trailing slash`, async ($, on) => {
      stand(on, '/w/')
      const { tree } = await draw($, surface, 'stg pop', ONE)
      expect(rows(surface, tree)).toEqual(['Updated a.txt (+1 -1)', HINT])
    })
    test(`${surface}: no directory to be had, paths stay absolute`, async ($, on) => {
      stand(on, null)
      const { tree } = await draw($, surface, 'stg pop', ONE)
      expect(rows(surface, tree)).toEqual(['Updated /w/a.txt (+1 -1)', HINT])
    })
  })
}

// ---- /fold-command-diffs command and the on/off switch ----

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }

// Hooks beneath the mod for one session: start, command registry, stock drawing
function session(on: any) {
  const registered: unknown[] = []
  on('session.start', async (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', async (_$: any, e: any) => {
    registered.push(e)
    return { value: { command: e.name } }
  })
  stand(on)
  return { registered }
}
const start = ($: any) => $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
const run = async ($: any, args: string) => (await $.command.run({ command: 'fold-command-diffs', args, ...RUN })).text as string
const muted = async ($: any, id: string) => rows('terminal', (await draw($, 'terminal', 'stg pop', ONE, id)).tree) !== null

describe('command', () => {
  test('registers /fold-command-diffs with a hint', async ($, on) => {
    const s = session(on)
    mock.store(on)
    await start($)
    expect(s.registered).toEqual([{ name: 'fold-command-diffs', description: expect.stringContaining('listed commands'), argumentHint: '[on|off]' }])
  })

  test('empty store: on', async ($, on) => {
    session(on); mock.store(on); await start($)
    expect(await muted($, 'r1')).toBe(true)
  })

  test('off, then on, switches new rows and is saved', async ($, on) => {
    session(on); mock.store(on); await start($)
    expect(await run($, 'off')).toBe('off')
    expect(await muted($, 'r-off')).toBe(false)
    await start($)
    expect(await muted($, 'r-off-next-session')).toBe(false)
    expect(await run($, 'on')).toBe('on')
    expect(await muted($, 'r-on')).toBe(true)
  })

  test('unknown argument refused, state kept', async ($, on) => {
    session(on); mock.store(on, { enabled: false }); await start($)
    expect(await run($, 'maybe')).toBe("unknown 'maybe', use /fold-command-diffs on|off")
    expect(await muted($, 'r')).toBe(false)
  })
})
