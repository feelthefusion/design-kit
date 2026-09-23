#!/usr/bin/env bash
# Design Kit — Hermes. Same skills as Claude Code (design-md is built into Hermes, so it is not
# linked), same gate, same session-start refresh.
set -euo pipefail
KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib.sh
. "$KIT/install/lib.sh"
if [ "${1:-}" != "--no-shared" ]; then
    kit_self_update "$KIT"; fetch_upstreams "$KIT"; render_upstreams "$KIT"; ensure_runtime "$KIT"; link_bins "$KIT"
fi
dst="$HOME/.hermes/skills/design"
mkdir -p "$dst"
[ -f "$dst/DESCRIPTION.md" ] || printf -- '---\ndescription: Design Kit — direction (DESIGN.md), rendered review, polish, type rendering, mobile speed and the design gate.\n---\n' > "$dst/DESCRIPTION.md"
for s in $KIT_SKILLS; do link_skill "$KIT/skills/$s" "$dst/$s"; done
link_upstream_skills "$KIT" "$dst" hermes
if command -v hermes >/dev/null 2>&1; then ok "session-start update hook: $(wire_hermes_update_hook)"; else warn "hermes CLI not on PATH — session-start refresh not wired"; fi
write_kit_version "$KIT" "$HOME/.hermes"
