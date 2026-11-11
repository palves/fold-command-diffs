// Draws one summary line per file in place of the diff of files changed by a Bash command that
// runs one of the listed commands (the `commands` option, stg and quilt by default).  Claude
// Code already does this for git commands that move the working tree (git checkout, git
// switch): it hides their diff in the compact view and shows it under ctrl+o.  It recognizes them from the command text,
// which a ToolResult hook does not get, so the ToolUse hook records the matching calls, keyed by
// tool_use_id.  The ToolUse row holds its ToolResult, so the record is in place before the
// result is drawn, in a resumed session too.

// The names in the manifest's `commands` default, for a load that passes no options
const DEFAULT_COMMANDS = ['stg', 'quilt']

// The command names to match, from the `commands` option: one string of names separated by
// spaces or commas.  It is a plain string and not a `multiple` one because /config draws no row
// for a multiple field.  A value that is not a string, or names nothing, gives the default.
function commandNames(value) {
  const names = typeof value === 'string' ? value.split(/[\s,]+/).filter(Boolean) : []
  return names.length ? names : DEFAULT_COMMANDS
}

// Which of `names` a shell line runs, or null.  The line is split at && || ; | & ( and line
// breaks.  A part runs a name when, after any VAR=value assignments, its first word is that
// name, or a path whose last component is (~/bin/stg-wrap matches stg-wrap).  A name inside a
// word (stg-msg for stg) or a later word (git stg) does not count.
const SEPARATORS = /&&|\|\||[;|&(\n]/
const ASSIGNMENTS = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/
function matchCommand(command, names) {
  if (typeof command !== 'string') return null
  for (const part of command.split(SEPARATORS)) {
    const word = part.trim().replace(ASSIGNMENTS, '').split(/\s/, 1)[0]
    if (!word) continue
    const base = word.slice(word.lastIndexOf('/') + 1)
    if (names.includes(base)) return base
  }
  return null
}

// Count added and removed lines in structuredPatch hunks; broken parts are skipped
function countLines(patch) {
  let add = 0, del = 0
  if (!Array.isArray(patch)) return { add, del }
  for (const hunk of patch) {
    const lines = hunk?.lines
    if (!Array.isArray(lines)) continue
    for (const line of lines) {
      if (typeof line !== 'string') continue
      if (line[0] === '+') add++
      else if (line[0] === '-') del++
    }
  }
  return { add, del }
}

// Characters that move the cursor, break the line or hide and reorder text:
// C0, DEL, C1, zero-width, line and paragraph separators, bidi controls, BOM, lone surrogates
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g
const ESCAPES = { '\n': '\\n', '\r': '\\r', '\t': '\\t' }
const MAX = 1000

function escape(c) {
  const code = c.charCodeAt(0)
  return ESCAPES[c] ?? (code < 0x100 ? '\\x' + code.toString(16).padStart(2, '0') : '\\u' + code.toString(16).padStart(4, '0'))
}

// Move a cut out of the middle of a surrogate pair, toward the cut-out part
const high = code => code >= 0xd800 && code <= 0xdbff
const headEnd = (text, i) => high(text.charCodeAt(i - 1)) ? i - 1 : i
const tailStart = (text, i) => high(text.charCodeAt(i - 1)) ? i + 1 : i

// Show unsafe characters as visible escapes and cut the middle out of a long value,
// so one line stays one line and shows what it really holds
function safe(value) {
  if (typeof value !== 'string') return ''
  const text = value.replace(UNSAFE, escape)
  if (text.length <= MAX) return text
  const half = (MAX - 1) / 2
  return text.slice(0, headEnd(text, Math.ceil(half))) + '…' + text.slice(tailStart(text, text.length - Math.floor(half)))
}

// One line per file a Bash command changed, from the bashEditDiff the engine keeps
// for drawing (an internal field: when it is missing or empty, Bash keeps the stock drawing)
// The wording is the stock drawing's ("Updated a.txt (+1 -1)"), and a path is shown relative to
// `cwd`, the directory the command started in, as the stock drawing shows it.
function bashSummaries(diff, cwd) {
  const files = Array.isArray(diff?.files) ? diff.files.filter(f => f && typeof f === 'object') : []
  const rows = files.map(f => {
    const path = safe(relative(f.filePath, cwd))
    const { add, del } = countLines(f.hunks)
    if (f.created === true) return `Created ${path} (+${add} -0)`
    if (f.deleted === true) return `Deleted ${path} (+0 -${del})`
    return `Updated ${path} (+${add} -${del})`
  })
  // Files changed with no diff to show (too large, binary, mode only): named from changedFiles
  let more = Number.isInteger(diff?.moreFiles) && diff.moreFiles > 0 ? diff.moreFiles : 0
  const shown = new Set(files.map(f => f.filePath))
  const named = Array.isArray(diff?.changedFiles) ? diff.changedFiles : []
  for (const path of new Set(named)) {
    if (more === 0) break
    if (typeof path !== 'string' || shown.has(path)) continue
    rows.push(`Changed ${safe(relative(path, cwd))}`)
    more--
  }
  if (more) rows.push(`… ${more} more files`)
  return rows
}

// `path` relative to the directory `cwd`, or `path` itself when it is not under it.  Claude Code
// diffs only the files under the directory a command starts in, so the fallback is for a
// redrawn row whose session has since moved (a resumed session started elsewhere).
function relative(path, cwd) {
  if (typeof path !== 'string' || typeof cwd !== 'string' || cwd === '') return path
  const dir = cwd.endsWith('/') ? cwd : cwd + '/'
  return path.startsWith(dir) ? path.slice(dir.length) : path
}

const GUTTER = '  ⎿  '
// File lines shown before the rest collapse into one "… N more" line
const MAX_ROWS = 10

// On or off for new rows; read from the store once per session, saved across sessions
const KEY = 'enabled'
let enabled = true
let loaded

// Read the saved state; a resumed session draws its rows before session.start, so drawing waits for this too
function load($, again) {
  if (again || !loaded) {
    loaded = Promise.resolve()
      .then(() => $.store.get(KEY))
      .then(v => { enabled = v !== false }, () => { enabled = true })
  }
  return loaded
}
// What each row showed when first drawn, so a switch changes only rows drawn after it
const shown = new Map()
// tool_use_id of each Bash call that runs a matched command, to `{ name, cwd }`: the command's
// name and the session's directory when the call started
const matched = new Map()

const NAME = 'fold-command-diffs'
const HELP = 'Shows one summary line per file instead of the diff of files changed by a Bash command that runs one of the listed commands. ctrl+o still shows the diff.'
const USAGE = `/${NAME} on|off switches without the dialog.`
const state = () => (enabled ? 'on' : 'off')

// Switch for new rows and save; a failed save keeps the switch for this session
async function turn($, on) {
  await load($)
  enabled = on
  try {
    await $.store.set(KEY, on)
    return state()
  } catch {
    return `${state()} (not saved, this session only)`
  }
}

async function menu($) {
  const was = enabled
  let answer
  try {
    answer = await $.ui.ask(`${NAME} is ${was ? 'on' : 'off'}. Turn it on or off?`, { options: ['On', 'Off'], header: NAME })
  } catch {
    answer = undefined
  }
  let line
  if (answer === 'On' || answer === 'Off') line = await turn($, answer === 'On')
  else if (answer === undefined) line = `${state()} (unchanged)`
  else line = `${state()} (unchanged: '${safe(answer)}' is not On or Off)`
  const what = enabled ? 'New matching results show one line per file.' : 'New matching results show the full diff.'
  return [line, what, HELP, `Matched commands: ${names.join(' ')}.`, USAGE].join('\n')
}

// Set by register from the `commands` option
let names = DEFAULT_COMMANDS

export function register(on, options) {
  names = commandNames(options?.commands)

  on('session.start', async ($, e, next) => {
    await load($, true)
    await $.command.register({ name: NAME, description: `Show or switch ${NAME}: one line per file instead of the diff the listed commands make`, argumentHint: '[on|off]' })
    return next(e)
  })

  on('command.run', { command: NAME }, async ($, e) => {
    await load($)
    const arg = typeof e.args === 'string' ? e.args.trim().toLowerCase() : ''
    if (arg === '') return { text: await menu($) }
    if (arg === 'on' || arg === 'off') return { text: await turn($, arg === 'on') }
    return { text: `unknown '${safe(e.args.trim())}', use /${NAME} on|off` }
  })

  // Record the Bash calls that run a matched command, with the session's directory at the row's
  // first drawing, which for a live call is when it starts; the row itself draws as stock
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { tool_use_id: id, tool, input } = e.props ?? {}
    if (tool === 'Bash' && typeof id === 'string' && !matched.has(id)) {
      const name = matchCommand(input?.command, names)
      if (name) {
        let cwd
        try { cwd = await $.session.cwd() } catch { cwd = undefined }
        matched.set(id, { name, cwd })
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const { tool_use_id: id, tool, output, isErrored, isExpanded } = e.props ?? {}
    // Errors, ctrl+o, and every call not recorded as matched keep the stock drawing
    if (isErrored || isExpanded || tool !== 'Bash' || !matched.has(id)) return next(e)
    if (!output || typeof output !== 'object') return next(e)
    const call = matched.get(id)
    const bash = bashSummaries(output.bashEditDiff, call.cwd)
    if (!bash.length) return next(e)
    let muted = shown.get(id)
    if (muted === undefined) {
      await load($)
      muted = enabled
      shown.set(id, muted)
    }
    if (!muted) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // In the terminal a result block opens with the same gutter as the stock one, then the
    // matched command's name
    const lead = (e.surface === 'terminal' ? GUTTER : '') + safe(call.name) + ': '
    const line = text => Text({ dimColor: true, wrap: 'truncate-middle', children: [lead + text] })
    // The stock drawing of the command's output without the diff, then one line per file
    const { bashEditDiff, ...rest } = output
    const stock = await next({ ...e, props: { ...e.props, output: rest } })
    // Every row of bash is one file but a final "… N more files", so count from the diff itself
    const total = (Array.isArray(bashEditDiff.files) ? bashEditDiff.files.length : 0) + (Number.isInteger(bashEditDiff.moreFiles) ? bashEditDiff.moreFiles : 0)
    const rows = bash.length > MAX_ROWS ? [...bash.slice(0, MAX_ROWS), `… ${total - MAX_ROWS} more files`] : bash
    rows.push('ctrl+o shows the diff')
    return Box({ flexDirection: 'column', children: [stock, ...rows.map(line)] })
  })
}
