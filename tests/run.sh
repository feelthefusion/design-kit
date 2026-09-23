#!/usr/bin/env bash
# Design Kit tests: the gate catches every seeded defect, passes a clean page, design-init is
# idempotent and never overwrites, overlays land, no swallowed failures in kit code.
#   bash tests/run.sh           (needs node + the gate runtime: bash install/install.sh first)
set -uo pipefail
KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pass=0; fail=0
t() { if eval "$2"; then printf '  ✓ %s\n' "$1"; pass=$((pass+1)); else printf '  ✗ %s\n' "$1"; fail=$((fail+1)); fi; }
TMP="$(mktemp -d)"; trap 'kill "${SRV:-0}" 2>/dev/null; rm -rf "$TMP"' EXIT

echo "▶ gate on fixtures"
PORT=8779
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$KIT/tests/fixtures/site/public" >/dev/null 2>&1 & SRV=$!
for _ in $(seq 1 50); do curl -fsS "http://127.0.0.1:$PORT/clean.html" >/dev/null 2>&1 && break; sleep 0.1; done
cp -R "$KIT/tests/fixtures/site" "$TMP/site"
( cd "$TMP/site" && git init -q . )
rc=0; node "$KIT/gate/design-gate.mjs" --repo "$TMP/site" --force --routes /defects.html > "$TMP/defects.txt" 2>&1 || rc=$?
t "defects page fails (exit 1)" '[ "$rc" = 1 ]'
R="$TMP/site/.design-kit/report.json"
has() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1]))["findings"]; sys.exit(0 if any(f["check"]==sys.argv[2] and (len(sys.argv)<4 or sys.argv[3] in f["selector"]+f["msg"]) for f in d) else 1)' "$R" "$@"; }
t "icon 4px below its label"               'has align.icon-label "Download"'
t "row sibling offset"                     'has align.row'
t "side-by-side buttons of unequal height" 'has align.equal-height'
t "grid card not level"                    'has align.grid-row'
t "block off the shared edge"              'has align.edge'
t "asymmetric padding"                     'has spacing.padding'
t "odd icon size in a group"               'has align.icon-size'
t "fixed bar covers the last button"       'has overlap.fixed "Last button"'
t "dead button"                            'has buttons.dead "Does nothing"'
t "button that throws"                     'has buttons.error'
t "off-palette rendered colour"            'has brand.colour "#FF00AA"'
t "off-token rendered font"                'has brand.font "Comic Sans"'
t "banned text on screen"                  'has brand.banned'
t "code literal not a token"               'has brand.token'
t "no font smoothing"                      'has type.smoothing'
t "text-size-adjust unset"                 'has type.size-adjust'
t "sub-16px field on a phone"              'has type.input-zoom'
t "positive display tracking"              'has type.tracking'
t "proportional figures in a table"        'has type.tabular'
t "layout sweep ran (frontend-visual-qa)"  'python3 -c "import json,sys; d=json.load(open(sys.argv[1]))[\"findings\"]; sys.exit(0 if any(f[\"check\"].startswith(\"layout.\") and f[\"check\"]!=\"layout.run\" for f in d) else 1)" "$R"'
t "every finding has selector + message"   'python3 -c "import json,sys; d=json.load(open(sys.argv[1]))[\"findings\"]; sys.exit(0 if d and all(f[\"selector\"] and f[\"msg\"] for f in d) else 1)" "$R"'
t "design-ok comment suppresses its selector" '! has align.icon-label "Intentional"'
cp -R "$TMP/site" "$TMP/clean"; rm -rf "$TMP/clean/public/defects.html" "$TMP/clean/.design-kit"   # a repo whose code is clean too
rc=0; node "$KIT/gate/design-gate.mjs" --repo "$TMP/clean" --force --routes /clean.html > "$TMP/clean.txt" 2>&1 || rc=$?
t "clean page passes (exit 0)" '[ "$rc" = 0 ] || { sed -n "1,40p" "$TMP/clean.txt"; false; }'
rc=0; node "$KIT/gate/design-gate.mjs" --repo "$TMP/clean" --routes /clean.html > "$TMP/stamp.txt" 2>&1 || rc=$?
t "unchanged repo re-uses the pass stamp" '[ "$rc" = 0 ] && grep -q "unchanged since the last clean run" "$TMP/stamp.txt"'
rc=0; node "$KIT/gate/design-gate.mjs" --repo "$TMP/clean" --force --url http://127.0.0.1:1 > "$TMP/down.txt" 2>&1 || rc=$?
t "server down and no start command → exit 3, printed" '[ "$rc" = 3 ] && grep -q "not reachable" "$TMP/down.txt"'

echo "▶ design-init"
R2="$TMP/app"; mkdir -p "$R2/src" && cd "$R2" && git init -q .
printf '{"name":"a","scripts":{"dev":"vite"},"dependencies":{"react":"19"}}\n' > package.json
printf 'export const r = <Route path="/pricing" />;\n' > src/App.tsx
printf ':root { --ink: #1A1D1E; --paper: #FBFBF9; --radius: 8px; }\n' > src/index.css
printf '#!/usr/bin/env bash\nset -euo pipefail\nstep(){ echo "$1"; }\nstep "tests"\nprintf '"'"'\\n✓ verify passed\\n'"'"'\n' > verify.sh
printf 'Never use Playfair or #C9A84C. No em-dashes in copy.\n' > CLAUDE.md
bash "$KIT/install/init-project.sh" > "$TMP/init1.txt" 2>&1
t "config written with detected routes"   'grep -q "\"/pricing\"" .agents/design-kit.json'
t "DESIGN.md drafted from repo tokens"   'grep -q "ink: \"#1A1D1E\"" docs/DESIGN.md'
t "banned values seeded from CLAUDE.md"   'grep -q "^font Playfair" .agents/design-banned.txt && grep -q "^color #C9A84C" .agents/design-banned.txt && grep -q "^text —" .agents/design-banned.txt'
t "verify.sh step placed before the pass line" 'awk "/design-kit/{a=NR} /verify passed/{b=NR} END{exit !(a && b && a<b)}" verify.sh'
t "verify.sh still parses"                'bash -n verify.sh'
echo "# mine" >> docs/DESIGN.md; echo '{"url":"http://x"}' > .agents/design-kit.json
bash "$KIT/install/init-project.sh" > "$TMP/init2.txt" 2>&1
t "re-run keeps user files"               'tail -1 docs/DESIGN.md | grep -q "# mine" && grep -q "http://x" .agents/design-kit.json'
t "re-run doesn't duplicate the verify step" '[ "$(grep -c "# >>> design-kit" verify.sh)" = 1 ] && [ "$(grep -c "design-kit:start" AGENTS.md)" = 1 ]'
N="$TMP/lib"; mkdir -p "$N" && cd "$N" && git init -q . && printf '{"name":"lib"}\n' > package.json
bash "$KIT/install/init-project.sh" > "$TMP/init3.txt" 2>&1
t "non-web repo left untouched"           '[ ! -e .agents ] && grep -q "not a web app" "$TMP/init3.txt"'

echo "▶ upstream overlays + hygiene"
DKH="${DESIGN_KIT_HOME:-$HOME/.local/share/design-kit}"
t "frontend-visual-qa → fix-and-rerun"    'grep -q "Design Kit overlay" "$DKH/skills/frontend-visual-qa/SKILL.md" && grep -qi "fix-and-rerun" "$DKH/skills/frontend-visual-qa/SKILL.md"'
t "rendered skills record their commit"   'for d in "$DKH"/skills/*/; do grep -q "^commit: " "$d/.upstream" || exit 1; done'
t "no swallowed failures in kit code"     '! grep -rnE "\|\| *true|\.skip\(" "$KIT/install" "$KIT/bin" "$KIT/gate" | grep -v "^\s*#"'
t "every script parses"                   'for f in "$KIT"/install/*.sh "$KIT"/bin/*; do bash -n "$f" || exit 1; done && for f in "$KIT"/gate/*.mjs "$KIT"/gate/lib/*.mjs; do node --check "$f" || exit 1; done'

echo; echo "$pass passed, $fail failed"; [ "$fail" = 0 ]
