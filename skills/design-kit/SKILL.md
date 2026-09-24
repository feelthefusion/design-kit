---
name: design-kit
description: "Use for ANY UI/design work in a repo with the Design Kit: which skill owns direction, build, code review, rendered review, speed, type; the gate that blocks done."
---

# Design Kit: map

One owner per job. Tokens flow from DESIGN.md into the build, and the gate checks the rendered result against DESIGN.md.

| stage | owner | source |
|---|---|---|
| 1. Direction | **design-direction** → `docs/DESIGN.md` (**design-md** spec) | Design Kit + Google design-md |
| 2. Build | **Taste** (`design-taste-frontend`) builds from DESIGN.md | Skill Starter Kit (not duplicated here) |
| 3. Code review | **web-design-guidelines**: Vercel's rules, fetched fresh every run | vercel-labs/agent-skills |
| 4. Rendered review | **frontend-visual-qa**, fix-and-rerun | daymade/claude-code-skills |
| 5. Polish / critique | **impeccable** (`critique`, `audit`, `polish`, `typeset`, `layout`, `animate`, …) | pbakaus/impeccable |
| 6. Motion + materials | **apple-design** | emilkowalski/skills |
| 7. Type rendering | **type-rendering**: helix-grade smooth, crisp text | Design Kit |
| 8. Mobile speed | **core-web-vitals** (LCP, INP, CLS at 375px first) | addyosmani/web-quality-skills |
| Gate | **design-gate** runs in `verify.sh` → the Stop hook blocks "done" | Design Kit |

Browser driving and screenshots belong to **browser-verify** (Skill Starter Kit). Brand voice and product context belong to Marketing Kit's `.agents/brand-context.md` and `.agents/product-marketing.md`, and this kit reads them rather than keeping its own copy.

## Always

- **No voids.** Never leave empty or over-sized space on any page at any width. Reorganise the layout, tighten it to the spacing scale, or fill it with real content that earns the space. Never use filler.
- **Centred things are centred on their ink.** That covers copy in pills, badges, chips and buttons, digits in count bubbles, and glyphs in icon buttons.

The gate enforces both (`space.*`, `align.centre`). **design-gate** has the fixes.

## Workflow

1. There's no DESIGN.md, or the brand changed: run **design-direction** (`design-tokens` drafts front matter from the code).
2. New UI: Taste, "build from docs/DESIGN.md".
3. Before calling it done, review the code with **web-design-guidelines**, then run `design-gate`. Fix every finding and re-run until clean (**design-gate** skill).
4. For a polish pass, use impeccable `polish` / `typeset`, then run the gate again.

## Freedom-first

The kit has no policy layers of its own. Its checks are about geometry, brand and rendering. Taste calls, like "is this eyebrow chip overused?", are reported as notes and never block, because DESIGN.md is the taste authority.
