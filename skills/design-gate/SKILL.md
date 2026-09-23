---
name: design-gate
description: "Use when design-gate / verify.sh reports design findings, or before calling UI work done: read findings, fix at source, re-run until clean; how to mark intentional exceptions."
---

# Design gate: read, fix, re-run

`design-gate` runs inside the Skill Starter Kit's `verify.sh`, so its failures block "done" through the Stop hook. Each finding is `[check] selector — what, by how many px (route @ viewports)`.

## Loop

1. Run `design-gate` (or read the Stop-hook output). The full report is in `.design-kit/report.json`.
2. Fix at the source: the component, the token, the stylesheet. Never evade the check by renaming selectors, hiding elements, shrinking all type or deleting the feature.
3. Re-run `design-gate --only <group>` for a fast loop, then plain `design-gate` once everything is clean. A clean run is stamped, so later runs skip until a UI file changes.

## Checks

| group | what fails |
|---|---|
| `layout.*` | frontend-visual-qa sweep with `--fail-on-warning`: overflow, clipping, overlap, broken media, focus rings, blank first viewport |
| `buttons.dead` / `buttons.error` | a visible button or script link that, when clicked, does nothing (no navigation, DOM change, request, dialog or focus move), or throws |
| `overlap.fixed` / `overlap.click` | a fixed/sticky bar covering content at page top or bottom; a click intercepted by an overlay |
| `align.icon-label` | icon centre >1.5px from the label's cap-height centre (side by side) or from its centre line (stacked) |
| `align.row` / `align.equal-height` / `align.grid-row` | a sibling off the row's top/centre/bottom line; side-by-side buttons of different heights; grid cards not level |
| `align.edge` | a block 2–10px out of line with its siblings' shared left edge (or right edge, on boxed blocks) |
| `spacing.padding` | left ≠ right padding on a visible box (top ≠ bottom on buttons, chips, badges) |
| `align.icon-size` | one icon in a group of like items at a different size |
| `brand.colour` / `brand.font` | a rendered colour or font that is not a DESIGN.md token |
| `brand.token` | a literal colour/font (or radius/size, when DESIGN.md defines them) in code that is not a token |
| `brand.banned` | a value or phrase from `.agents/design-banned.txt`, in code or on screen |
| `type.*` | smoothing, text-size-adjust, faux bold/italic, failed font loads, missing metric fallback, too many preloads, interpolated weights, pure-black ink, display tracking, proportional figures in tables, <16px fields on phones (see **type-rendering**) |
| `impeccable.*` | impeccable's deterministic quality detectors (contrast, cramped padding, heading order, line length, …). Its taste opinions in the "slop" category are printed as notes and don't block. DESIGN.md decides taste. |

## Intentional exceptions

State the reason in the code, next to the markup:

```tsx
{/* design-ok: .hero-badge — sits on the baseline, not the centre, by design */}
<span className="hero-badge" data-design-ok="baseline badge">…</span>
```

- `design-ok: <css selector> — reason` in any comment in the source skips that selector in the rendered checks.
- `data-design-ok="reason"` on an element (or one of its 3 nearest ancestors) does the same.
- `design-ok` on a code line, or in a comment on the line above it, skips that line in the code checks.
- `design-ok-file: reason` in a file's first lines skips the whole file in the code checks, for things like product art, illustrations and generated charts.
- `.agents/design-ok.txt`: one `selector  # reason` per line, for third-party markup you can't comment.
- impeccable's own inline ignores (`impeccable-disable-next-line <rule>: reason`) and `.impeccable/config.json` work too.

## Config: `.agents/design-kit.json`

```json
{ "url": "http://localhost:5173", "start": "npm run dev", "routes": ["/", "/products", "/cart"],
  "viewports": [375, 768, 1440], "src": ["client/src"], "clicks": 25,
  "storage": { "localStorage": { "age-verified": "1" } } }
```

- `start` runs only when `url` isn't already up, and the gate stops it afterwards. Point it at the client-only dev script when the full server has side effects.
- `storage` pre-seeds localStorage, sessionStorage or cookies so age gates and consent walls don't hide every route.
- It's safe on a real dev server. The gate's browser, and the proxy impeccable scans through, abort every POST/PUT/PATCH/DELETE and every logout request, and logout controls are never clicked.
- Exit codes: 0 clean, 1 findings (fails verify), 3 couldn't run here (no server or browser: printed visibly, doesn't fail).
