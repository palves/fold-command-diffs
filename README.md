# fold-command-diffs

A Claude Code mod that folds the file diff Claude Code draws under a Bash
command running one of the commands you list, as Claude Code already does for
`git checkout`.  The default list, `stg quilt`, is the patch-stack tools whose
push and pop move the working tree.  What it shows, how to pick the commands and
how to switch it off are in [plugin/README.md](plugin/README.md), the file
installed with the mod.

## Install

```
/plugin install fold-command-diffs --marketplace palves/fold-command-diffs
```

## How it works

Claude Code recognizes git's tree-moving commands from the command text while
drawing the result.  The stored result it hands a mod carries no mark of that (a
`git checkout` and a `stg push` have the same fields), so the mod matches
commands itself.  A `ToolResult` hook doesn't get the command, but a `ToolUse`
hook, which draws the row holding that result, does.  The `ToolUse` hook records
the `tool_use_id` of each matching call, and the `ToolResult` hook folds only
those.  The row is drawn before its result, so the record is always in place
first, in a resumed session too.

The per-file diff the mod reads, `bashEditDiff`, is an internal field of Claude
Code.  When it is missing or empty, the mod draws the stock result.

## Develop

```
plugin/          what is installed: manifest, hooks module, readme, license
tests/check.sh   validate + unit tests (tests/check.sh --help)
tests/unit/      unit tests
```

Run Claude Code with the mod loaded from a checkout:

```
claude --plugin-dir /path/to/fold-command-diffs/plugin
```

or, in a session that hot-reloads mods, symlink `plugin/` into the session's
`~/.claude/dev-mods/<session id>/` folder, and it loads when the turn ends.

What Claude Code draws is checked by hand: in a scratch git repo with an stg
stack, which the session must see as a working directory (`/add-dir` it), pop
and push a patch and look at the rows, in the normal view and under ctrl+o.  Do
this after a Claude Code update too, since `bashEditDiff` can change without
notice.

## Credits

This mod started as a fork of
[mutedit](https://github.com/egrn/claude-code-mutedit) by egrn, MIT-licensed,
which folds the diffs of Edit, Write and every Bash call.  Little of it is left:
the command matching, the hooks that use it and the tests are new, and what
remains is mutedit's escaping of unsafe characters, its per-file summary lines
and its on/off switch.
