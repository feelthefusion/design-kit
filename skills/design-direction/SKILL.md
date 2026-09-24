---
name: design-direction
description: "Use when a repo needs or changes its visual direction: brand → docs/DESIGN.md (Google design-md): colour, type, spacing, radius, motion, icon set, voice. Seeds from Marketing Kit brand context."
---

# Design direction → `docs/DESIGN.md`

DESIGN.md is the single source of design truth. Taste builds from it, the gate enforces it, and impeccable critiques against it. The file uses Google's design-md format: YAML front-matter tokens are normative and the markdown prose explains them. Use the **design-md** skill for the spec, linting and export. On Hermes it is built in; on Claude Code the Design Kit fetches it live.

## Where it lives

`docs/DESIGN.md`. If the repo already has a root `DESIGN.md`, keep that file and don't create a second one. The gate reads `.agents/design-kit.json → design` first, then `docs/DESIGN.md`, then `DESIGN.md`.

## Inputs, in order

1. **Marketing Kit context, if present:** `.agents/brand-context.md` (voice, audience, promise, words to avoid) and `.agents/product-marketing.md`. Read them; don't re-interview the user for what's already there. Voice and banned words come from here.
2. **Tokens the code already defines:** run `design-tokens` (Design Kit). It prints a front-matter draft from `:root` / `.dark` custom properties, `@font-face` families and `--radius*`. Rename the tokens to the brand's words and prune the ones that aren't real.
3. **Structure references (live, not copied):** [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) holds DESIGN.md files for 70+ real products. Fetch one or two whose feel is close (`curl -fsSL https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/<site>/DESIGN.md`) and use them for section depth, not content. On Hermes, `popular-web-designs` covers the same ground.

## What it must define

| section | front matter | prose must say |
|---|---|---|
| Colour | `colors:` every ink, surface, line, accent, state; dark theme as `*-dark` | roles, contrast pairs (≥4.5:1 text), where the accent is allowed |
| Type | `typography:` per role: `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing` | the ladder, weights in use, rendering rules (see **type-rendering**) |
| Spacing | `spacing:` the scale | section rhythm, container widths, the symmetric-padding rule, the largest allowed gap per breakpoint (no voids: the gate's `space.*` limit), how grids fill their last row, and how short pages are filled |
| Radius | `rounded:` | which element gets which radius |
| Motion | `motion:` durations, easings/springs (e.g. `fast: 150ms`, `ease: "cubic-bezier(.2,.8,.2,1)"`) | what animates, what never does, the reduced-motion fallback (**apple-design**) |
| Icons | `icons:` set, stroke, sizes (e.g. `set: phosphor`, `stroke: 1.5`, `sizes: [14, 16, 20]`) | one set only, size per context, optical centring on text |
| Voice | none | tone, words to use and avoid (from brand-context.md), and the copy rules, e.g. "no em-dashes" |

Unknown top-level keys (`motion`, `icons`) are allowed by the spec. `npx @google/design.md lint docs/DESIGN.md` warns on them and does not fail.

## Banned values

Put anything the brand forbids in `.agents/design-banned.txt`. The gate fails when these show up in code or in the rendered page:

```
color #C9A84C        # APEX gold — not this brand
font Playfair        # APEX display face
text —               # no em-dashes in UI copy
re \bdosing\b        # regex over visible copy
```

`design-init` seeds this file from the negative rules in CLAUDE.md / AGENTS.md / DESIGN.md. Review what it wrote.

## Done when

- `npx @google/design.md lint docs/DESIGN.md` has no errors.
- `design-gate --only brand` is clean. Every colour and font the page renders, and every literal in code, maps to a token or carries a `design-ok:` comment that says why.
- The build hands off to **Taste** (`design-taste-frontend`, Skill Starter Kit) with "build from docs/DESIGN.md".
