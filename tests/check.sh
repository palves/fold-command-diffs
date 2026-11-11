#!/usr/bin/env bash
# check.sh -- validate fold-command-diffs and run its unit tests.  See --help.
set -u

usage() {
  cat <<'USAGE'
usage: tests/check.sh [--help]

Runs `claude plugin validate` on plugin/, then the unit tests in
tests/unit/*.test.ts.  `claude plugin test` only finds tests inside the
plugin folder, so plugin/ and the tests are copied to a temporary
directory and run there.  The full outputs go to tests/results/
(validate.txt, unit.txt).

There is no live check: what Claude Code draws is checked by hand, as
README.md describes.

Exits 0 when both pass, 1 when either fails or claude is missing, 2 for
a bad argument.
USAGE
}
case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  "")        ;;
  *) echo "unrecognized argument: $1" >&2; usage >&2; exit 2 ;;
esac

HERE=$(cd "$(dirname "$0")" && pwd)
MOD=$(dirname "$HERE")/plugin
OUT=$HERE/results
command -v claude >/dev/null || { echo "error: claude not found" >&2; exit 1; }
mkdir -p "$OUT"

status=0

if claude plugin validate "$MOD" > "$OUT/validate.txt" 2>&1; then
  echo "validate: pass"
else
  echo "validate: FAIL, see $OUT/validate.txt"; status=1
fi

u=$(mktemp -d "${TMPDIR:-/tmp}/fold-command-diffs-unit.XXXXXX")
trap 'rm -rf "$u"' EXIT
cp -r "$MOD/." "$u/"
# Types the engine wrote for the live copy would shadow the test's own
rm -rf "$u/.claude-plugin/types" "$u/tsconfig.json"
for t in "$HERE"/unit/*.test.ts; do
  sed "s#'../../plugin/hooks/#'./#" "$t" > "$u/hooks/${t##*/}"
done
claude plugin test "$u" > "$OUT/unit.txt" 2>&1
code=$?
counts=$(grep -E '^ *[0-9]+ (pass|fail)$' "$OUT/unit.txt" | tr -s ' \n' ' ')
grep '^(fail)' "$OUT/unit.txt"
if [ $code = 0 ]; then
  echo "unit:${counts}"
else
  echo "unit: FAIL,${counts}see $OUT/unit.txt"; status=1
fi

exit $status
