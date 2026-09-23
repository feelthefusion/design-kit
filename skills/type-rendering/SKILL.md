---
name: type-rendering
description: "Use when setting up or fixing how text RENDERS: crisp, smooth, antialiased fonts, font loading, fallbacks, weights, tracking, icon-to-text alignment. Helix-grade type recipe + gate checks."
---

# Type rendering: crisp, smooth, clean text

Text looks "expensive" when four things line up: smooth antialiased edges, weights the designer actually drew, spacing that changes with size, and nothing moving while fonts load. None of these is a single CSS property. This is the recipe helix uses, reverse-engineered from its `globals.css`, `fonts.css` and the font files it serves, and checked in a real browser. Treat it as the reference implementation.

The gate enforces the mechanical parts (`type.*` findings). The rest is taste: apply it when building (Taste) and when polishing (impeccable `typeset`).

## 1. Smoothing: grayscale antialiasing on the whole document

```css
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body {
  -webkit-font-smoothing: antialiased;     /* macOS Chrome/Safari: grayscale AA, not subpixel */
  -moz-osx-font-smoothing: grayscale;      /* macOS Firefox */
  font-feature-settings: normal;           /* let the font's defaults (kern, liga, calt) run */
  font-variation-settings: normal;
  /* no text-rendering override: kerning + ligatures are already on at `auto` */
}
```

- `antialiased` renders thinner, softer strokes with no colour fringing. It is the "smooth" look. It matters most for light text on dark and on retina screens.
- **Do not** set `text-rendering: optimizeLegibility` or `geometricPrecision` on running text. Modern engines already kern and apply ligatures at `auto`, and the override only costs layout time on long pages. Helix removed it on purpose (its audit §2). The gate flags it on body copy (`type.text-rendering`).
- Pin `text-size-adjust: 100%`, or iOS inflates text when the phone rotates (`type.size-adjust`).
- Never fake weight with `-webkit-text-stroke` or `text-shadow`. It smears the antialiasing. Load the real weight instead (§3).

## 2. Ink and ground: soften both ends

Helix renders body text as `#262B2C` (ink) on `#FBFBF9` (paper), with secondary text at `#515A5C`. It does not use `#000` on `#FFF`.

- Pure black on pure white at 21:1 gives antialiased edges a harsh halo. A near-black tinted toward the brand, on an off-white, keeps them soft and still clears AAA. The gate flags a pure-`#000000` body on a light ground (`type.ink`).
- Muted text must still pass 4.5:1 (impeccable `low-contrast` blocks it). Helix's `#798486` on paper is 3.7:1: legal for captions ≥18px, not for 10–13px labels.

## 3. Real weights only

- Serve a **variable** woff2 but expose named masters (`font-weight: 400 700` in `@font-face`) and use only 400/500/600/700 in CSS. An interpolated weight like 450 renders a weight nobody drew (`type.weight`).
- Every weight or style the UI uses needs a face. Otherwise the browser synthesises a smeared faux bold or italic. Helix loads a real Poppins 700 because a badge asked for 700 and only 400–600 were loaded (`type.synthesis`). Either load the master, or set `font-synthesis: none` and change the weight.
- Headings are semibold (600), never 700, and heavy weight is kept for small labels. Grayscale AA already thins strokes, so 600 reads as bold without clotting.

## 4. Size-specific spacing (Apple's rule)

Tighten tracking as type grows. Open it up only for tiny uppercase labels.

| role | helix value |
|---|---|
| h1 36→48→60→72px | `letter-spacing: -0.025em`, `line-height: 1.05 → 1` |
| h2 24px | `-0.025em`, `1.333` |
| h3 20 / h4 18 / h5 13 | `-0.02em` / `-0.015em` / `-0.01em` |
| body 16px | `normal`, `line-height: 1.62` |
| micro label 10–11px uppercase (mono / eyebrow) | `+0.14em` to `+0.24em` |

- Positive tracking on display text (≥32px) is a finding (`type.tracking`).
- `h1–h6 { text-wrap: balance }` and `p { text-wrap: pretty }` prevent one-word last lines.
- Figures: `font-variant-numeric: tabular-nums` on every `td`/`th` and on data spans (`.data { tabular-nums slashed-zero }`) so columns align (`type.tabular`).
- Inline mono inside prose: `0.92em`, which optically matches Plex Mono to Anek. Never apply it to sized parents.

## 5. Loading without a flash or reflow

```css
@font-face {                      /* the web font: self-hosted, subset, variable */
  font-family: "Anek Telugu";
  font-weight: 400 700;
  font-display: swap;
  src: url("/fonts/anek-latin.woff2") format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, /* … latin */;
}
@font-face {                      /* metric-matched fallback: Arial resized to the web font's box */
  font-family: "Anek Telugu Fallback";
  src: local("Arial");
  ascent-override: 94.96%; descent-override: 63.31%; line-gap-override: 0%; size-adjust: 94.77%;
}
:root { --font-sans: "Anek Telugu", "Anek Telugu Fallback", ui-sans-serif, system-ui, sans-serif; }
```

- Self-host woff2 files split by `unicode-range` (latin / latin-ext), so a page downloads only the subset it uses. Helix's latin Anek file has 280 glyphs.
- Give **every** web face a metric-matched fallback in its stack. Compute the values with `@capsizecss/metrics` or Fontaine. Without one, text reflows when the font arrives, which counts as CLS (`type.fallback`). On the live site helix does this for Anek and Poppins, but not yet for Marcellus, Fraunces or Plex Mono.
- Preload only the primary text face and the above-the-fold control face (helix preloads 2). Extra preloads compete with the LCP image (`type.preload`).
- Unhinted outlines are what Google Fonts and helix serve (hinting stripped, `gasp` = smooth). That is the right choice for high-DPI screens and grayscale AA. Don't re-add TrueType hinting.
- Faces with a high x-height (about 0.77–0.79 of cap height for Anek and Poppins) stay clear at 13–15px. Pick UI faces with a tall x-height.

## 6. Controls: text that sits dead-centre

- `input, textarea, select, button { font: inherit; letter-spacing: inherit; }`, then `line-height: normal` on single-line inputs and selects. Otherwise the body's 1.62 leading floats their text off-centre.
- Fields are ≥16px on phones, or iOS zooms on focus and never zooms back. Use `@media (pointer: coarse) { input, select, textarea { font-size: max(16px, 1em) } }`. Never fix it with `maximum-scale=1` (`type.input-zoom`).
- A face with a deep descent (Anek reserves Telugu depth) floats Latin text high in a field. Declare an "Anek Telugu UI" face that uses the **same file** with `ascent-override: 110%; descent-override: 40%; line-gap-override: 0%`. The baseline drops about 2px while the line box stays the same, so field heights don't change.

## 7. Icons on the text's optical centre

A flex row centres an icon on the LINE box, but the eye reads the centre of the capitals. The icon sits low by `(capAscent + descent - ascent) / 2`. That offset does not depend on line-height and does depend on the font. Helix lifts icons, never the words:

```css
:where(html) { --icon-lift: 0.216em; }                                /* Anek (body) */
:where(button, a, [role="button"], [role="tab"]) { --icon-lift: 0.05em; } /* Poppins (controls) */
:where(.flex[class*="gap-"]:not(.justify-center), .inline-flex[class*="gap-"]:not(.justify-center))
  > :where(svg, input[type="checkbox"], input[type="radio"]) { position: relative; top: calc(-1 * var(--icon-lift)); }
.cap-trim { display: block; text-box: trim-both cap alphabetic; }     /* a count in a circle, a lone label */
```

- Exclude icon-only controls and icons centred alone in a box, or the lift puts them off-centre.
- Where the browser can measure exactly (`text-box: trim-both cap alphabetic`), trim a **wrapping element**. Never trim runs of text inside a sentence, because that breaks the shared baseline.
- The gate measures this directly. It compares the icon centre to the text's cap-height centre (`baseline − capHeight/2`, from the font's real metrics) and reports anything more than 1.5px off, with selector and px (`align.icon-label`).

## Verify

`design-gate --only type,align` checks smoothing, size-adjust, synthesis, fallbacks, preloads, weights, ink, tracking, tabular figures, input zoom and icon centring at 375/768/1440, on a phone-emulated 375 (touch, coarse pointer). Fix, re-run, repeat until clean.
