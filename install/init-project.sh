#!/usr/bin/env bash
# design-init — wire the Design Kit into THIS repo (idempotent; never overwrites your files):
#   .agents/design-kit.json   gate config: url, start, routes, viewports, src (created if missing)
#   docs/DESIGN.md            drafted from the repo's own tokens ONLY if no DESIGN.md exists
#   .agents/design-banned.txt seeded from the negative rules in CLAUDE.md / AGENTS.md / DESIGN.md
#   verify.sh                 "design gate" step (Skill Starter Kit verify.sh → Stop hook blocks done)
#   AGENTS.md / CLAUDE.md     a short marked block pointing at the design-kit skill map
set -euo pipefail
KIT="$(cd "$(dirname "$(python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "${BASH_SOURCE[0]}")")/.." && pwd)"
# shellcheck source=lib.sh
. "$KIT/install/lib.sh"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "design-init: run inside a git repo"; exit 1; }
cd "$ROOT"
say "Design Kit → $(basename "$ROOT")"

# ---- web app? --------------------------------------------------------------------------------
web=0
if [ -f package.json ] && python3 -c '
import json,sys
p=json.load(open("package.json")); d={**p.get("dependencies",{}),**p.get("devDependencies",{})}
sys.exit(0 if any(k in d for k in ["react","vue","svelte","next","vite","astro","solid-js","@angular/core","preact","nuxt","@remix-run/react","@sveltejs/kit","lit"]) else 1)'; then web=1; fi
[ -f index.html ] || [ -f public/index.html ] || [ -f client/index.html ] && web=1
if [ "$web" = 0 ]; then say "  · not a web app (no frontend framework / index.html) — the design gate stays off here"; exit 0; fi
mkdir -p .agents

# ---- gate config -------------------------------------------------------------------------------
if [ ! -f .agents/design-kit.json ]; then
    python3 - <<'PY'
import json, os, re, glob
p = json.load(open("package.json")) if os.path.exists("package.json") else {}
scripts = p.get("scripts", {}); deps = {**p.get("dependencies", {}), **p.get("devDependencies", {})}
port = 3000 if "next" in deps else 4321 if "astro" in deps else 5173
for f in glob.glob("vite.config.*") + glob.glob("client/vite.config.*"):
    m = re.search(r"port\s*:\s*(\d{2,5})", open(f).read())
    if m: port = int(m.group(1)); break
start = next((f"npm run {s}" for s in ["dev:client", "dev:web", "dev:frontend", "dev"] if s in scripts), "")
src = [d for d in ["client/src", "src", "app", "pages", "components", "web/src"] if os.path.isdir(d)]
routes, prio = set(), ["products", "shop", "store", "cart", "checkout", "pricing", "dashboard", "account", "about", "login", "admin"]
for root in src or ["."]:
    for f in glob.glob(f"{root}/**/*.[jt]sx", recursive=True)[:800]:
        for m in re.finditer(r"""path\s*[=:]\s*\{?["'`](/[a-z0-9/_-]*)["'`]""", open(f, errors="ignore").read()):
            if ":" not in m.group(1) and "*" not in m.group(1): routes.add(m.group(1).rstrip("/") or "/")
pick = ["/"] + sorted([r for r in routes if r != "/"], key=lambda r: (next((i for i, k in enumerate(prio) if r.strip("/").split("/")[0] == k), 99), r.count("/"), r))[:4]
cfg = {"url": f"http://localhost:{port}", "start": start, "routes": pick, "viewports": [375, 768, 1440], "src": src, "clicks": 25}
json.dump(cfg, open(".agents/design-kit.json", "w"), indent=2); open(".agents/design-kit.json", "a").write("\n")
print(f"  · .agents/design-kit.json ✓  url {cfg['url']} · start '{start}' · routes {', '.join(pick)}")
PY
else ok ".agents/design-kit.json kept (yours)"; fi

# ---- DESIGN.md -------------------------------------------------------------------------------
if [ -f docs/DESIGN.md ] || [ -f DESIGN.md ]; then
    dm="$( [ -f docs/DESIGN.md ] && echo docs/DESIGN.md || echo DESIGN.md )"
    if head -1 "$dm" | grep -q '^---$'; then ok "$dm kept (has design-md front matter)"
    else warn "$dm has no design-md front matter: brand checks use the colours/fonts named in its prose. \`design-tokens\` drafts exact tokens (design-direction skill)"; fi
else
    mkdir -p docs
    {
        node "$KIT/gate/design-tokens.mjs" --repo . 2>/dev/null
        printf '\n## Overview\n\n'
        if [ -f .agents/brand-context.md ]; then printf 'Seeded from `.agents/brand-context.md` (Marketing Kit). Run the design-direction skill to finish this file.\n\n'; sed -n '1,40p' .agents/brand-context.md | sed 's/^#/###/'
        else printf 'Drafted by design-init from the tokens this repo already defines. Run the design-direction skill to name, prune and describe them.\n'; fi
        printf '\n## Colors\n\n## Typography\n\nRendering: see the type-rendering skill (grayscale antialiasing, real weights, metric-matched fallbacks).\n\n## Layout\n\n## Shapes\n\n## Motion\n\n## Icons\n\n## Voice\n\n## Do'"'"'s and Don'"'"'ts\n'
    } > docs/DESIGN.md
    ok "docs/DESIGN.md drafted from the repo's tokens (finish it with design-direction)"
fi

# ---- banned values ---------------------------------------------------------------------------
if [ ! -f .agents/design-banned.txt ]; then
    python3 - <<'PY'
import os, re
NEG = re.compile(r"\b(no|never|none|not|don'?t|avoid|banned|without|forbidden)\b", re.I)
STRONG = re.compile(r"\b(never|none of|don'?t|do not|avoid|banned|forbidden|no longer)\b", re.I)
WEAK = re.compile(r"\b(no|not|without)\b", re.I)
FONTS = ["Playfair Display", "Playfair", "Inter", "Roboto", "Poppins", "Montserrat", "Lora", "DM Sans", "Fraunces", "Geist", "Space Grotesk", "Instrument Sans", "Comic Sans", "Papyrus", "Arial", "Helvetica", "Times New Roman"]
out, seen = [], set()
for f in ["CLAUDE.md", "AGENTS.md", "DESIGN.md", "docs/DESIGN.md", ".agents/brand-context.md"]:
    if not os.path.exists(f): continue
    for sent in re.split(r"(?<=[.!?])\s+|\n", open(f, errors="ignore").read()):
        sent = re.sub(r"[*_`]", "", sent)
        if not NEG.search(sent): continue
        def near(i):   # the negation must govern THIS value: close before it, same clause
            for pat, span in ((STRONG, 60), (WEAK, 18)):
                w = sent[max(0, i - span):i]; m = list(pat.finditer(w))
                if m and not re.search(r"[)(|;:]", w[m[-1].end():]): return True
            return False
        for mm in re.finditer(r"#[0-9a-fA-F]{6}\b", sent):
            hx = mm.group(0)
            if near(mm.start()) and ("color", hx.upper()) not in seen: seen.add(("color", hx.upper())); out.append(f"color {hx.upper()}  # {f}: {sent.strip()[:70]}")
        for fam in FONTS:
            mf = re.search(rf"\b{fam}\b", sent)
            if mf and near(mf.start()) and not any(fam in s[1] for s in seen if s[0] == "font"):
                seen.add(("font", fam)); out.append(f"font {fam}  # {f}: {sent.strip()[:70]}")
        me = re.search(r"em[- ]?dash", sent, re.I)
        if me and near(me.start()) and ("text", "—") not in seen:
            seen.add(("text", "—")); out.append(f"text —  # {f}: {sent.strip()[:70]}")
hdr = "# Design Kit banned values: the gate fails when these appear in code or on screen.\n# kind value  # why        (kinds: color, font, text, re)\n"
open(".agents/design-banned.txt", "w").write(hdr + "\n".join(out) + ("\n" if out else ""))
print(f"  · .agents/design-banned.txt ✓  {len(out)} rule(s) seeded from repo rules — review them")
PY
else ok ".agents/design-banned.txt kept (yours)"; fi

# ---- verify.sh ---------------------------------------------------------------------------------
if [ -f verify.sh ]; then
    python3 - verify.sh <<'PY'
import re, sys
p = sys.argv[1]; txt = open(p).read()
s, e = "# >>> design-kit", "# <<< design-kit"
txt = re.sub(re.escape(s) + r".*?" + re.escape(e) + r"\n*", "", txt, flags=re.S)
block = f'''{s}
if [ -f .agents/design-kit.json ]; then
  step "design gate"   # Design Kit: layout sweep, dead buttons, overlap, alignment, brand, type @ 375/768/1440
  dk_rc=0; "${{DESIGN_GATE:-$HOME/.local/bin/design-gate}}" || dk_rc=$?
  case "$dk_rc" in
    0) ;;
    3) echo "⚠ design gate could not run here (reason above) — it runs whenever the dev server is reachable" ;;
    *) echo "✗ design gate failed — fix each finding at its source and re-run design-gate (skill: design-gate)"; exit 1 ;;
  esac
fi
{e}
'''
m = re.search(r"^printf '\\n✓ verify passed.*$", txt, flags=re.M)
txt = txt[:m.start()] + block + "\n" + txt[m.start():] if m else txt.rstrip() + "\n\n" + block
open(p, "w").write(txt)
print("  · verify.sh += design gate step ✓ (the Stop hook now blocks done on design findings)")
PY
else
    warn "no verify.sh (Skill Starter Kit gate) here — run kit-init to get the Stop hook; until then run design-gate yourself"
fi

# ---- gitignore + agent docs --------------------------------------------------------------------
touch .gitignore
grep -qxF '.design-kit/' .gitignore || { printf '\n# Design Kit (gate reports, server log, last-pass stamp)\n.design-kit/\n' >> .gitignore; ok ".gitignore += .design-kit/"; }
blk="$(mktemp)"
cat > "$blk" <<'MD'
## Design Kit
- Map: skill `design-kit`. Direction → `docs/DESIGN.md` (design-direction, Google design-md) · build → Taste from DESIGN.md · review → web-design-guidelines, frontend-visual-qa (fix-and-rerun), impeccable · type → type-rendering · speed → core-web-vitals.
- `verify.sh` runs `design-gate` (375/768/1440): layout, dead buttons, fixed/sticky overlap, alignment (icon vs text >1.5px, rows, heights, edges, padding, icon sizes), brand tokens + banned values, type rendering. Findings block done: fix at source, re-run. Intentional exceptions: `design-ok: <selector> — reason` in a comment.
MD
for f in AGENTS.md CLAUDE.md; do
    if [ -f "$f" ] || [ "$f" = AGENTS.md ]; then write_marked_block "$f" "design-kit" "$blk"; ok "$f design-kit block"; fi
done
rm -f "$blk"
if v="$(git -C "$KIT" rev-parse --short=12 HEAD 2>/dev/null)"; then echo "$v" > .agents/.design-kit-version; fi
say "✓ wired. Next: start the dev server and run  design-gate  (first run records the baseline)."
