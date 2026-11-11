# fold-command-diffs

A Claude Code mod that folds the file diff Claude Code draws under a Bash
command running one of the commands you list, by default `stg` and `quilt`,
whose `stg goto` or `quilt pop` move the working tree.

Claude Code draws, under a Bash call, the diff of every file that changed while
it ran.  For git commands that move the working tree, such as `git checkout` and
`git switch`, it already hides that diff in the normal view and shows it under
ctrl+o.  It knows nothing about other tools that do the same, so every patch an
`stg goto` or a `quilt push -a` moves shows as a giant red or green diff.

With the mod, such a call keeps its own output and lists the files it changed,
one grey line each, in Claude Code's own words and with its paths, the diff
itself still under ctrl+o:

```
● Bash(stg goto p3)
  ⎿  > p3
  ⎿  stg: Updated src/main.c (+12 -3)
  ⎿  stg: Deleted src/old.c (+0 -40)
  ⎿  stg: ctrl+o shows the diff
```

After ten files the rest collapse into one `… N more files` line.  Edit, Write
and every other Bash call look as normal.  Only the screen changes: the saved
tool result and what the model sees stay the same.

## Which commands

The `commands` option names them, separated by spaces or commas, `stg quilt` by
default.  Change it in `/config` ("Commands whose diff is folded") to add a
wrapper script, or any other command whose diff you'd rather not see, or to drop
a tool you don't use.

A Bash line matches when one of its commands is a listed name.  The line is
split at `&&`, `||`, `;`, `|`, `&`, `(` and line breaks, and in each part the
first word after any `VAR=value` assignments counts, by its last path component,
so `cd src && ~/bin/stg-wrap pop` matches `stg-wrap`.  A listed name inside a
longer word (`stg-msg` for `stg`) or as a later word (`git stg`) does not match.
The folded lines start with the name that matched.

## Install

```
/plugin install fold-command-diffs --marketplace palves/fold-command-diffs
```

## Commands

- `/fold-command-diffs` shows the state and asks On or Off.
- `/fold-command-diffs on` folds the diff of new matching results.
- `/fold-command-diffs off` shows the full diff again.

The choice is kept in new sessions.

## What it runs and sends

The mod draws tool rows and results, registers the `/fold-command-diffs` command
and keeps its on/off switch in the Claude Code mod store.  It does not run
commands, read or write files, or send data anywhere.

Originally based on [mutedit](https://github.com/egrn/claude-code-mutedit) by
egrn, which folds the diffs of Edit and Write too, though little of it is left.
