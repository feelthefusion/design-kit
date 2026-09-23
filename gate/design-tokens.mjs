#!/usr/bin/env node
// design-tokens — draft Google design-md front matter from the tokens a repo ALREADY defines
// (CSS custom properties in :root / .dark, @font-face families, --radius*, tailwind fontFamily).
//   design-tokens [--repo .]            → prints YAML front matter to stdout (never writes)
// The design-direction skill merges it into docs/DESIGN.md with the brand's own names and prose.
import fs from "node:fs";
import path from "node:path";
import { listFiles, srcRoots, loadConfig, fontFaceFamilies } from "./lib/repo.mjs";

const i = process.argv.indexOf("--repo");
const REPO = path.resolve(i > 0 ? process.argv[i + 1] : process.cwd());
const cfg = loadConfig(REPO);
const css = listFiles(REPO, [...srcRoots(REPO, cfg), "."], [".css", ".scss"], 400).filter((f) => !f.includes("node_modules"));

const colors = {}, dark = {}, radii = {}, fonts = {}, spacing = {};
const hslTriplet = /^(\d{1,3}(?:\.\d+)?)\s+(\d{1,3}(?:\.\d+)?)%\s+(\d{1,3}(?:\.\d+)?)%$/;
const isColour = (v) => /^#([0-9a-f]{3,8})$/i.test(v) || /^(rgb|hsl|oklch|oklab|lab|lch)a?\(/i.test(v) || hslTriplet.test(v);
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return "#" + [f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
}
const norm = (v) => { const m = v.match(hslTriplet); return m ? hslToHex(+m[1], +m[2], +m[3]) : /^#/.test(v) ? v.toUpperCase() : v; };

for (const f of css) {
  const txt = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const block of txt.matchAll(/(:root|\.dark|\[data-theme=["']?dark["']?\]|html)\s*{([^}]*)}/g)) {
    const target = block[1] === ":root" || block[1] === "html" ? colors : dark;
    for (const d of block[2].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      const [name, raw] = [d[1], d[2].trim()];
      if (isColour(raw)) target[name] = norm(raw);
      else if (/radius/.test(name) && /^[\d.]+(px|rem)$/.test(raw)) radii[name.replace(/^radius-?/, "") || "md"] = raw;
      else if (/^font/.test(name)) fonts[name.replace(/^font-?/, "") || "sans"] = raw.split(",")[0].trim().replace(/^["']|["']$/g, "");
      else if (/^(space|spacing|gap)/.test(name) && /^[\d.]+(px|rem)$/.test(raw)) spacing[name.replace(/^(space|spacing|gap)-?/, "")] = raw;
    }
  }
}
const faces = fontFaceFamilies(REPO).filter((f) => !/fallback/i.test(f));
const q = (v) => (/^[\w.%-]+$/.test(v) && !/^[\d.]/.test(v) ? v : JSON.stringify(v));
const out = ["---", "version: alpha", `name: ${path.basename(REPO)}`, "description: Drafted by design-tokens from the tokens this repo already defines. Rename, prune and describe in design-direction.", "colors:"];
for (const [k, v] of Object.entries(colors)) out.push(`  ${k}: ${q(v)}`);
if (Object.keys(dark).length) { out.push("  # dark theme"); for (const [k, v] of Object.entries(dark)) if (colors[k] !== v) out.push(`  ${k}-dark: ${q(v)}`); }
out.push("typography:");
const famList = [...new Set([...Object.values(fonts).filter((f) => !/var\(/.test(f)), ...faces])];
famList.forEach((fam, n) => out.push(`  face-${n + 1}:`, `    fontFamily: ${q(fam)}`));
if (Object.keys(radii).length) { out.push("rounded:"); for (const [k, v] of Object.entries(radii)) out.push(`  ${k}: ${v}`); }
if (Object.keys(spacing).length) { out.push("spacing:"); for (const [k, v] of Object.entries(spacing)) out.push(`  ${k}: ${v}`); }
out.push("---");
console.log(out.join("\n"));
console.error(`design-tokens: ${Object.keys(colors).length} colours, ${Object.keys(dark).length} dark, ${famList.length} font(s), ${Object.keys(radii).length} radii from ${css.length} stylesheet(s)`);
