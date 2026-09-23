#!/usr/bin/env bash
# Design Kit — install for Claude Code (and Hermes, when present: same skills, same gate).
#   bash install/install.sh            # both hosts that exist
#   bash install/install.sh --claude   # Claude Code only
#   bash install/install.sh --hermes   # Hermes only
set -euo pipefail
KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib.sh
. "$KIT/install/lib.sh"

want_claude=1; want_hermes=1
case "${1:-}" in --claude) want_hermes=0 ;; --hermes) want_claude=0 ;; esac
[ -d "$HOME/.claude" ] || command -v claude >/dev/null 2>&1 || want_claude=0
command -v hermes >/dev/null 2>&1 || [ -d "$HOME/.hermes" ] || want_hermes=0

say "Design Kit — $(git -C "$KIT" rev-parse --short HEAD 2>/dev/null || echo local)"
kit_self_update "$KIT"
say "▶ upstream skills (latest HEAD, overlays re-applied)"
fetch_upstreams "$KIT"
render_upstreams "$KIT"
say "▶ gate runtime"
ensure_runtime "$KIT"
say "▶ commands"
link_bins "$KIT"

if [ "$want_claude" = 1 ]; then
    say "▶ Claude Code (~/.claude/skills)"
    mkdir -p "$HOME/.claude/skills"
    for s in $KIT_SKILLS; do link_skill "$KIT/skills/$s" "$HOME/.claude/skills/$s"; done
    link_upstream_skills "$KIT" "$HOME/.claude/skills" claude
    ok "session-start update hook: $(wire_claude_update_hook "$HOME/.claude")"
    write_kit_version "$KIT" "$HOME/.claude"
fi
say "▶ automatic updates"
ok "schedule: $(wire_schedule)"
date +%s > "$DK_CONF/last-update"
if [ "$want_hermes" = 1 ]; then
    say "▶ Hermes (~/.hermes/skills/design)"
    bash "$KIT/install/hermes.sh" --no-shared
fi
say ""
say "✓ Design Kit installed and self-updating (session start + hourly; push webhook: design-webhook enable)."
say "  In each web repo:  design-init   (wires verify.sh + DESIGN.md + config)"
