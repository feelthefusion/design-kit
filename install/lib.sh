#!/usr/bin/env bash
# =============================================================================
# Design Kit — shared installer library (sourced by install.sh / hermes.sh / design-update)
#
# LIVE BY DESIGN — nothing third-party is committed to this repo:
#   * kit skills       → SYMLINKED from this checkout
#   * upstream skills  → install/upstreams.tsv: shallow clone of THEIR repo (latest HEAD) into
#                        $DK_HOME/upstream, kit overlays re-applied, rendered into $DK_HOME/skills,
#                        then SYMLINKED into ~/.claude/skills and ~/.hermes/skills/design
#   * gate runtime     → playwright + impeccable + yaml, newest release older than 7 days
#                        (the Starter Kit's cooldown), in $DK_HOME/runtime
# =============================================================================

DK_BIN="$HOME/.local/bin"
DK_HOME="${DESIGN_KIT_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/design-kit}"
DK_CONF="${XDG_CONFIG_HOME:-$HOME/.config}/design-kit"
KIT_SKILLS="design-kit design-direction type-rendering design-gate"
DK_COOLDOWN_DAYS="${DK_COOLDOWN_DAYS:-7}"

say()  { printf '%s\n' "$*"; }
ok()   { printf '  · %s ✓\n' "$*"; }
warn() { printf '  ⚠ %s\n' "$*"; }

kit_self_update() {  # $1 = kit root
    local root="$1" before after
    [ "${KIT_NO_PULL:-0}" = 1 ] && { say "▶ self-update skipped (KIT_NO_PULL=1)"; return 0; }
    git -C "$root" rev-parse --git-dir >/dev/null 2>&1 || { say "▶ self-update skipped — not a git clone"; return 0; }
    say "▶ self-update: pulling latest Design Kit"
    if [ -n "$(git -C "$root" status --porcelain)" ]; then warn "local changes — not pulling (commit/stash to get updates)"; return 0; fi
    before="$(git -C "$root" rev-parse --short HEAD)"
    git -C "$root" pull --ff-only --quiet 2>/dev/null || { warn "pull failed (offline/diverged) — using local copy"; return 0; }
    after="$(git -C "$root" rev-parse --short HEAD)"
    if [ "$before" = "$after" ]; then ok "already at latest ($after)"; else ok "updated $before → $after"; fi
}

# ---- upstream skills ----------------------------------------------------------------------
upstream_rows() { grep -v '^#' "$1/install/upstreams.tsv" | awk -F'\t' 'NF>=5'; }   # name repo ref path hosts
repo_dir()      { printf '%s/upstream/%s\n' "$DK_HOME" "$(printf '%s' "$1" | tr '/' '_')"; }

# Clone or fast-forward each upstream repo (shallow, sparse: only the skill paths the kit uses).
fetch_upstreams() {  # $1 = kit root
    local root="$1" base="${DK_GIT_BASE:-https://github.com}" repo d paths
    [ "${KIT_NO_UPSTREAM:-0}" = 1 ] && { say "  · upstream fetch skipped (KIT_NO_UPSTREAM=1) — using last fetched copies"; return 0; }
    mkdir -p "$DK_HOME/upstream"
    for repo in $(upstream_rows "$root" | cut -f2 | sort -u); do
        d="$(repo_dir "$repo")"
        paths="$(upstream_rows "$root" | awk -F'\t' -v r="$repo" '$2==r {print $4}' | sort -u | tr '\n' ' ')"
        if [ ! -d "$d/.git" ]; then
            rm -rf "$d"
            if ! git clone --quiet --depth 1 --filter=blob:none --sparse "$base/$repo.git" "$d" 2>/dev/null; then
                warn "$repo: clone failed (offline?) — skills from it are unavailable until the next online run"; rm -rf "$d"; continue
            fi
        elif ! { git -C "$d" fetch --quiet --depth 1 origin HEAD 2>/dev/null && git -C "$d" reset --quiet --hard FETCH_HEAD; }; then
            warn "$repo: fetch failed — keeping $(git -C "$d" rev-parse --short HEAD 2>/dev/null)"
        fi
        # shellcheck disable=SC2086
        git -C "$d" sparse-checkout set --no-cone $paths >/dev/null 2>&1
        ok "$repo @ $(git -C "$d" rev-parse --short HEAD)"
    done
}

# Render: fresh upstream copy + kit overlays → $DK_HOME/skills/<name>. Atomic swap, so a
# session reading the skill never sees a half-written dir; a failed render keeps the old one.
render_upstreams() {  # $1 = kit root
    local root="$1" name repo ref path hosts src dst tmp
    mkdir -p "$DK_HOME/skills"
    while IFS=$'\t' read -r name repo ref path hosts _; do
        src="$(repo_dir "$repo")/$path"; dst="$DK_HOME/skills/$name"
        if [ ! -f "$src/SKILL.md" ]; then warn "$name: $repo/$path has no SKILL.md upstream — kept $( [ -d "$dst" ] && echo 'the last render' || echo 'nothing')"; continue; fi
        tmp="$dst.new.$$"; rm -rf "$tmp"; cp -R "$src" "$tmp"; rm -rf "$tmp/.git"
        apply_overlays "$root" "$name" "$tmp"
        printf 'upstream: %s\npath: %s\ncommit: %s\nrendered: %s\n' "$repo" "$path" \
            "$(git -C "$(repo_dir "$repo")" rev-parse --short HEAD)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$tmp/.upstream"
        rm -rf "$dst.old"; [ -d "$dst" ] && mv "$dst" "$dst.old"; mv "$tmp" "$dst"; rm -rf "$dst.old"
        ok "$name  ← $repo@$(sed -n 's/^commit: //p' "$dst/.upstream")"
    done < <(upstream_rows "$root")
}

# install/overlays/<skill>/: description · PREPEND.md · APPEND.md · replace/<n>.old|.new · files/
apply_overlays() {  # $1 = kit root  $2 = skill  $3 = dir
    local ov="$1/install/overlays/$2"
    [ -d "$ov" ] || return 0
    [ -d "$ov/files" ] && cp -R "$ov/files/." "$3/"
    [ -f "$3/SKILL.md" ] || return 0
    python3 - "$3/SKILL.md" "$ov" <<'PY'
import os, re, sys
skill, ov = sys.argv[1], sys.argv[2]
text = open(skill, encoding="utf-8").read()
m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
if not m: sys.exit(0)
fm, body = m.group(1), text[m.end():]
dp = os.path.join(ov, "description")
if os.path.exists(dp):
    desc = open(dp, encoding="utf-8").read().strip()
    out, skipping = [], False
    for ln in fm.split("\n"):
        if ln.startswith("description:"): skipping = True; continue
        if skipping and (ln.startswith(" ") or ln.startswith("\t")): continue
        skipping = False; out.append(ln)
    out.insert(1 if out and out[0].startswith("name:") else 0, 'description: "' + desc.replace('"', '\\"').replace("\n", " ") + '"')
    fm = "\n".join(out)
rd = os.path.join(ov, "replace")
if os.path.isdir(rd):
    for f in sorted(os.listdir(rd)):
        if not f.endswith(".old"): continue
        old = open(os.path.join(rd, f), encoding="utf-8").read().strip("\n")
        np_ = os.path.join(rd, f[:-4] + ".new")
        new = open(np_, encoding="utf-8").read().strip("\n") if os.path.exists(np_) else ""
        if old in body: body = body.replace(old, new)
        else: print(f"    WARN overlay {os.path.basename(ov)}/replace/{f}: text not found upstream — the PREPEND scope still applies; review the overlay", file=sys.stderr)
pp = os.path.join(ov, "PREPEND.md")
if os.path.exists(pp): body = open(pp, encoding="utf-8").read().rstrip() + "\n\n" + body.lstrip("\n")
ap = os.path.join(ov, "APPEND.md")
if os.path.exists(ap): body = body.rstrip() + "\n\n" + open(ap, encoding="utf-8").read().strip() + "\n"
open(skill, "w", encoding="utf-8").write("---\n" + fm + "\n---\n\n" + body.lstrip("\n"))
PY
}

# Symlink one skill dir into a host skills dir. Never replaces a real skill the user installed
# under the same name (that one keeps loading; the kit says so instead of clobbering it).
link_skill() {  # link_skill <src-dir> <dst-dir>
    local src="$1" dst="$2"
    [ -d "$src" ] || { warn "$(basename "$dst"): not rendered yet (offline first run) — re-run online"; return 0; }
    if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then ok "$(basename "$dst") linked"; return 0; fi
    if [ -e "$dst" ] && [ ! -L "$dst" ]; then warn "$(basename "$dst"): a skill you installed yourself is at $dst — left as is (it wins over the kit's copy)"; return 0; fi
    ln -sfn "$src" "$dst" && ok "$(basename "$dst") → $src"
}

# Upstream skills for one host (hosts column: both | claude | hermes)
link_upstream_skills() {  # $1 = kit root  $2 = skills dir  $3 = host
    local name repo ref path hosts
    mkdir -p "$2"
    while IFS=$'\t' read -r name repo ref path hosts _; do
        case "$hosts" in both|"$3") link_skill "$DK_HOME/skills/$name" "$2/$name" ;; esac
    done < <(upstream_rows "$1")
    # prune links to skills the kit dropped
    local l
    for l in "$2"/*; do
        [ -L "$l" ] || continue
        case "$(readlink "$l")" in "$DK_HOME"/skills/*) ;; *) continue ;; esac
        upstream_rows "$1" | cut -f1 | grep -qx "$(basename "$l")" || { rm -f "$l"; say "  · $(basename "$l") unlinked (no longer in the kit)"; }
    done
}

link_bins() {  # $1 = kit root
    mkdir -p "$DK_BIN"
    local b
    for b in design-gate design-tokens design-update design-doctor; do chmod +x "$1/bin/$b"; ln -sfn "$1/bin/$b" "$DK_BIN/$b"; done
    chmod +x "$1/install/init-project.sh"; ln -sfn "$1/install/init-project.sh" "$DK_BIN/design-init"
    ok "design-init design-gate design-tokens design-update design-doctor → $DK_BIN"
    case ":$PATH:" in *":$DK_BIN:"*) ;; *) warn "$DK_BIN is not on PATH — add: export PATH=\"\$HOME/.local/bin:\$PATH\"" ;; esac
}

# ---- gate runtime -------------------------------------------------------------------------
# Newest version of a package published at least DK_COOLDOWN_DAYS ago (supply-chain cooldown:
# a hijacked release is usually caught within days; "latest" still moves every week).
pick_version() {  # pick_version <pkg>
    npm view "$1" time --json 2>/dev/null | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const t=JSON.parse(s);const cut=Date.now()-Number(process.argv[1])*864e5;
const v=Object.entries(t).filter(([k,d])=>/^\d+\.\d+\.\d+$/.test(k)&&Date.parse(d)<=cut).sort((a,b)=>Date.parse(b[1])-Date.parse(a[1]));
process.stdout.write(v.length?v[0][0]:"")}catch{}})' "$DK_COOLDOWN_DAYS"
}

ensure_runtime() {  # $1 = kit root
    local rt="$DK_HOME/runtime" pw imp ym want have
    command -v node >/dev/null 2>&1 || { warn "node not found — the design gate needs Node 18+"; return 0; }
    command -v npm  >/dev/null 2>&1 || { warn "npm not found — the design gate runtime cannot be installed"; return 0; }
    mkdir -p "$rt"
    pw="$(pick_version playwright)"; imp="$(pick_version impeccable)"; ym="$(pick_version yaml)"
    if [ -z "$pw" ] || [ -z "$imp" ] || [ -z "$ym" ]; then warn "npm registry unreachable — keeping the current gate runtime"; return 0; fi
    want="playwright@$pw impeccable@$imp yaml@$ym"
    have=""; [ -f "$rt/.versions" ] && have="$(cat "$rt/.versions")"
    if [ "$want" != "$have" ] || [ ! -d "$rt/node_modules/playwright" ]; then
        [ -f "$rt/package.json" ] || printf '{ "name": "design-kit-runtime", "private": true, "type": "module" }\n' > "$rt/package.json"
        # shellcheck disable=SC2086
        if (cd "$rt" && npm install --no-audit --no-fund --ignore-scripts --save-exact $want >/dev/null 2>&1); then
            printf '%s\n' "$want" > "$rt/.versions"; ok "gate runtime: $want (newest ≥${DK_COOLDOWN_DAYS} days old)"
        else warn "npm install failed in $rt — keeping the previous runtime"; fi
    else ok "gate runtime current: $want"; fi
    if (cd "$rt" && ./node_modules/.bin/playwright install chromium >/dev/null 2>&1); then ok "Chromium for playwright@$pw"
    else warn "playwright could not download Chromium (offline?) — rendered checks skip until it can"; fi
    ln -sfn "$1/gate" "$DK_HOME/gate"
}

write_marked_block() {  # write_marked_block <file> <marker> <content-file>
    local f="$1" mk="$2" body="$3" tmp
    mkdir -p "$(dirname "$f")"; touch "$f"; tmp="$(mktemp)"
    awk -v s="<!-- $mk:start -->" -v e="<!-- $mk:end -->" '$0==s{skip=1} !skip{print} $0==e{skip=0}' "$f" > "$tmp"
    { printf '<!-- %s:start -->\n' "$mk"; cat "$body"; printf '<!-- %s:end -->\n' "$mk"; } >> "$tmp"
    mv "$tmp" "$f"
}

wire_claude_update_hook() {  # $1 = claude dir
    python3 - "$1/settings.json" "$DK_BIN/design-update --hook" <<'PY'
import json, os, sys
p, cmd = sys.argv[1:3]
s = json.load(open(p)) if os.path.exists(p) else {}
ss = s.setdefault("hooks", {}).setdefault("SessionStart", [])
if not any("design-update" in h.get("command", "") for g in ss for h in g.get("hooks", [])):
    ss.append({"hooks": [{"type": "command", "command": cmd, "timeout": 10}]})
    json.dump(s, open(p, "w"), indent=2); open(p, "a").write("\n"); print("added")
else: print("present")
PY
}

wire_hermes_update_hook() {
    local cur merged
    cur="$(hermes config get --json hooks.on_session_start 2>/dev/null || echo null)"
    case "$cur" in *design-update*) echo present; return ;; esac
    merged="$(python3 -c '
import json, sys
try: cur = json.loads(sys.argv[1]) or []
except Exception: cur = []
if not isinstance(cur, list): cur = []
cur.append({"command": sys.argv[2] + " --hook", "timeout": 10})
print(json.dumps(cur))' "$cur" "$DK_BIN/design-update")"
    if hermes config set hooks.on_session_start "$merged" >/dev/null 2>&1; then echo added; else echo failed; fi
}

write_kit_version() {  # $1 = kit root  $2 = dir
    mkdir -p "$2"
    printf 'revision: %s\ninstalled: %s\nsource: %s\n' \
        "$(git -C "$1" rev-parse --short HEAD 2>/dev/null || echo unknown)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        "$(git -C "$1" remote get-url origin 2>/dev/null || echo "$1")" > "$2/.design-kit-version"
}
