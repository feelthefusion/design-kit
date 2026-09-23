// Design Kit — repo context: config, DESIGN.md tokens, banned values, allowlist, static code scan.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import os from "node:os";
const RUNTIME = path.join(process.env.DESIGN_KIT_HOME || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"), "design-kit"), "runtime");
let YAML = null;
try { YAML = createRequire(path.join(RUNTIME, "package.json"))("yaml"); } catch { /* runtime not installed yet: front matter falls back to prose */ }

export const DEFAULT_CONFIG = {
  url: "http://localhost:5173",
  start: "",
  routes: ["/"],
  viewports: [375, 768, 1440],
  src: [],
  design: "",
  clicks: 25,
  checks: { layout: true, impeccable: true, buttons: true, overlap: true, align: true, brand: true, type: true },
};

export function loadConfig(repo) {
  const p = path.join(repo, ".agents", "design-kit.json");
  const cfg = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
  return { ...DEFAULT_CONFIG, ...cfg, checks: { ...DEFAULT_CONFIG.checks, ...(cfg.checks || {}) }, _path: fs.existsSync(p) ? p : null };
}

export function findDesignMd(repo, cfg) {
  for (const c of [cfg.design, "docs/DESIGN.md", "DESIGN.md", "design/DESIGN.md"].filter(Boolean)) {
    const p = path.join(repo, c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/g;
const FUNC = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\([^)]*\d[^)]*\)/g;

function walkTokens(obj, cb, prefix = "") {
  if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj)) walkTokens(v, cb, prefix ? `${prefix}.${k}` : k);
  else cb(prefix, obj);
}

// Tokens from DESIGN.md: YAML front matter is normative (Google design-md). Prose hexes and named
// fonts count too, so a DESIGN.md written as prose still defines a palette.
export function loadTokens(designPath, repo) {
  const t = { path: designPath, frontMatter: false, colors: [], fonts: [], radii: [], fontSizes: [], spacing: [] };
  if (!designPath) return t;
  const raw = fs.readFileSync(designPath, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n/);
  const body = m ? raw.slice(m[0].length) : raw;
  if (m && YAML) {
    try {
      const fm = YAML.parse(m[1]) || {};
      t.frontMatter = true;
      walkTokens(fm.colors || {}, (_, v) => typeof v === "string" && !v.startsWith("{") && t.colors.push(v));
      walkTokens(fm.components || {}, (k, v) => typeof v === "string" && /color/i.test(k) && !v.startsWith("{") && t.colors.push(v));
      walkTokens(fm.typography || {}, (k, v) => {
        if (k.endsWith("fontFamily") && typeof v === "string") t.fonts.push(...v.split(",").map((f) => f.trim().replace(/^["']|["']$/g, "")));
        if (k.endsWith("fontSize") && typeof v === "string") t.fontSizes.push(v);
      });
      walkTokens(fm.rounded || {}, (_, v) => typeof v === "string" && t.radii.push(v));
      walkTokens(fm.spacing || {}, (_, v) => typeof v === "string" && t.spacing.push(v));
    } catch (e) { t.frontMatterError = String(e.message).split("\n")[0]; }
  }
  t.colors.push(...(body.match(HEX) || []), ...(body.match(FUNC) || []));
  // fonts named in prose: any @font-face family defined in the repo that DESIGN.md mentions, plus common faces
  const lower = raw.toLowerCase();
  for (const fam of fontFaceFamilies(repo)) if (lower.includes(fam.toLowerCase())) t.fonts.push(fam);
  for (const fam of KNOWN_FONTS) if (new RegExp(`\\b${fam.replace(/ /g, "\\s+")}\\b`, "i").test(body) && !negated(body, fam)) t.fonts.push(fam);
  t.colors = [...new Set(t.colors)];
  t.fonts = [...new Set(t.fonts)];
  return t;
}

// "HelixClub carries none of ... Playfair" must not whitelist Playfair.
function negated(text, word) {
  const re = new RegExp(`[^.\\n]*\\b${word.split(" ")[0]}\\b[^.\\n]*`, "gi");
  const hits = text.match(re) || [];
  return hits.length > 0 && hits.every((s) => NEG.test(s));
}
const NEG = /\b(no|never|none|not|don'?t|avoid|banned|without|instead of|carries none)\b/i;

export const KNOWN_FONTS = ["Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Playfair Display", "Playfair", "Merriweather",
  "Lora", "DM Sans", "DM Serif Display", "Work Sans", "Nunito", "Raleway", "Source Sans Pro", "Source Serif", "IBM Plex Sans", "IBM Plex Mono",
  "JetBrains Mono", "Fira Code", "Geist", "Geist Mono", "Space Grotesk", "Instrument Sans", "Instrument Serif", "Fraunces", "Manrope",
  "Outfit", "Sora", "Figtree", "Plus Jakarta Sans", "Libre Baskerville", "Cormorant", "EB Garamond", "Anek Telugu", "Satoshi", "General Sans",
  "Helvetica", "Arial", "Georgia", "SF Pro", "Söhne", "Rubik", "Karla", "Mulish", "Barlow", "Archivo", "Bricolage Grotesque", "Epilogue"];

let _faces = null;
export function fontFaceFamilies(repo) {
  if (_faces) return _faces;
  const fams = new Set();
  for (const f of listFiles(repo, ["."], [".css", ".scss"], 400)) {
    const txt = fs.readFileSync(f, "utf8");
    for (const m of txt.matchAll(/@font-face\s*{[^}]*font-family:\s*["']?([^;"'}]+)["']?/g)) fams.add(m[1].trim());
  }
  return (_faces = [...fams]);
}

// .agents/design-banned.txt:   color #2c1e0f   # note   |  font Playfair  |  text —  |  re \bdosing\b
export function loadBanned(repo) {
  const p = path.join(repo, ".agents", "design-banned.txt");
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => {
    const [, kind, rest] = l.match(/^(color|colour|font|text|re)\s+(.+)$/i) || [];
    if (!kind) return null;
    const [value, note] = rest.split(/\s+#\s+/);
    return { kind: kind.toLowerCase() === "colour" ? "color" : kind.toLowerCase(), value: value.trim(), note: (note || "").trim() };
  }).filter(Boolean);
}

// Intentional exceptions: .agents/design-ok.txt (`<selector>  # why`) and any source comment
// `design-ok: <selector> — why` (a comment in the code, so the reason lives next to the markup).
export function loadAllow(repo, cfg) {
  const out = [];
  const p = path.join(repo, ".agents", "design-ok.txt");
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, "utf8").split("\n")) {
    const s = l.split(/\s+#\s+/)[0].trim();
    if (s && !s.startsWith("#")) out.push(s);
  }
  for (const f of listFiles(repo, srcRoots(repo, cfg), SRC_EXT, 4000)) {
    const txt = fs.readFileSync(f, "utf8");
    for (const m of txt.matchAll(/design-ok:\s*([^\n*]+?)\s+(?:—|--|-)\s/g)) out.push(m[1].trim());
  }
  return [...new Set(out)];
}

export const SRC_EXT = [".tsx", ".jsx", ".ts", ".js", ".mjs", ".vue", ".svelte", ".astro", ".html", ".css", ".scss"];
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "coverage", ".turbo", ".vercel", ".cache", "vendor", "graphify-out", ".claude", ".agents", "public", "tests", "__tests__", "e2e", "storybook-static"]);

export function srcRoots(repo, cfg) {
  if (cfg.src && cfg.src.length) return cfg.src;
  return ["client/src", "src", "app", "pages", "components", "web/src"].filter((d) => fs.existsSync(path.join(repo, d)));
}

export function listFiles(repo, roots, exts, cap = 4000) {
  const out = [];
  const walk = (d) => {
    if (out.length >= cap) return;
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith(".") && e.name !== ".") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); }
      else if (exts.some((x) => e.name.endsWith(x)) && !/\.(test|spec|stories)\.[jt]sx?$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p);
    }
  };
  for (const r of roots) { const abs = path.join(repo, r); if (fs.existsSync(abs)) fs.statSync(abs).isDirectory() ? walk(abs) : out.push(abs); }
  return out;
}

function stripComments(line, state) {
  // returns [code, commentText]; state.block tracks /* … */ across lines
  let code = "", comment = "", i = 0;
  while (i < line.length) {
    if (state.block) { const e = line.indexOf("*/", i); if (e < 0) { comment += line.slice(i); return [code, comment]; } comment += line.slice(i, e); i = e + 2; state.block = false; continue; }
    if (line.startsWith("/*", i)) { state.block = true; i += 2; continue; }
    if (line.startsWith("{/*", i)) { state.block = true; i += 3; continue; }
    if (line.startsWith("//", i) && line[i - 1] !== ":") { comment += line.slice(i); return [code, comment]; }
    if (line.startsWith("<!--", i)) { const e = line.indexOf("-->", i); comment += line.slice(i, e < 0 ? undefined : e); if (e < 0) return [code, comment]; i = e + 3; continue; }
    code += line[i++];
  }
  return [code, comment];
}

// Code values that are not DESIGN.md tokens: raw colours (hex / rgb / hsl / CSS-var triplets),
// font families, and — when DESIGN.md front matter defines them — arbitrary radius / font-size values.
// Raw candidates are returned; colour equality is decided in the browser (it parses every CSS colour).
export function staticScan(repo, cfg, tokens, banned) {
  const files = listFiles(repo, srcRoots(repo, cfg), SRC_EXT);
  const tw = ["tailwind.config.ts", "tailwind.config.js", "tailwind.config.mjs", "tailwind.config.cjs"].map((f) => path.join(repo, f)).filter((f) => fs.existsSync(f));
  const colours = [];   // { value, file, line }
  const fonts = [];     // { value, file, line }
  const other = [];     // findings decided here
  const bannedText = banned.filter((b) => b.kind === "text" || b.kind === "re");
  const radiusTokens = new Set(tokens.radii.map(norm));
  const sizeTokens = new Set(tokens.fontSizes.map(norm));
  for (const f of [...files, ...tw]) {
    const rel = path.relative(repo, f);
    const src = fs.readFileSync(f, "utf8");
    if (/design-ok-file\b/i.test(src.slice(0, 600))) continue;   // `design-ok-file: product art, not UI` in the file's first lines
    const lines = src.split("\n");
    const state = { block: false };
    let prevComment = "";
    const isCss = /\.(s?css)$/.test(f);
    lines.forEach((line, i) => {
      const [code, comment] = stripComments(line, state);
      const ok = /design-ok/i.test(comment) || /design-ok/i.test(prevComment);
      prevComment = comment;
      if (ok || !code.trim()) return;
      if (/^\s*(import|export \* from)\b/.test(code) || /url\(\s*["']?data:/.test(code)) return;
      const def = isCss && /^\s*--[\w-]+\s*:/.test(code);   // a CSS token DEFINITION, not a use
      const name = def ? code.match(/--([\w-]+)/)[1] : undefined;
      for (const m of code.matchAll(HEX)) {
        const before = code.slice(Math.max(0, m.index - 12), m.index);
        if (/(href|to|id|path)=\{?["'`]$/.test(before) || /[\w/]$/.test(before.slice(-1))) continue;   // "#top", "a/#x"
        colours.push({ value: m[0], file: rel, line: i + 1, def, name });
      }
      for (const m of code.matchAll(FUNC)) if (!/var\(/.test(m[0]) && !/\$\{/.test(m[0])) colours.push({ value: m[0], file: rel, line: i + 1, def, name });
      if (isCss) {
        const tri = code.match(/^\s*--[\w-]+:\s*(\d{1,3}(?:\.\d+)?)\s+(\d{1,3}(?:\.\d+)?)%\s+(\d{1,3}(?:\.\d+)?)%\s*;/);
        if (tri) colours.push({ value: `hsl(${tri[1]} ${tri[2]}% ${tri[3]}%)`, file: rel, line: i + 1, def: true, name: code.match(/--([\w-]+)/)[1] });
        const ff = code.match(/font-family:\s*([^;}{]+)/);
        if (ff && !/var\(/.test(ff[1].split(",")[0]) && !/@font-face/.test(lines.slice(Math.max(0, i - 6), i + 1).join(" ")))
          fonts.push({ value: ff[1].split(",")[0].trim().replace(/^["']|["']$/g, ""), file: rel, line: i + 1 });
        const vf = code.match(/^\s*--font[\w-]*:\s*["']?([^,;"']+)/);
        if (vf && !/var\(/.test(vf[1])) fonts.push({ value: vf[1].trim(), file: rel, line: i + 1 });
      } else {
        for (const m of code.matchAll(/font-\[['"]?([A-Z][^\]'"]+)['"]?\]/g)) fonts.push({ value: m[1].replace(/_/g, " "), file: rel, line: i + 1 });
        for (const m of code.matchAll(/fontFamily:\s*['"`]([^'"`,]+)/g)) fonts.push({ value: m[1].trim(), file: rel, line: i + 1 });
        if (tw.includes(f)) for (const m of code.matchAll(/^\s*[\w-]+:\s*\[\s*['"`]([^'"`]+)['"`]/g)) if (/font/i.test(lines.slice(Math.max(0, i - 12), i).join(" "))) fonts.push({ value: m[1].trim(), file: rel, line: i + 1 });
      }
      if (radiusTokens.size) for (const m of code.matchAll(/\brounded(?:-[trbl]{1,2})?-\[([\d.]+(?:px|rem|em))\]/g))
        if (!radiusTokens.has(norm(m[1]))) other.push({ check: "brand.token", selector: `${rel}:${i + 1}`, px: null, msg: `radius ${m[1]} is not a DESIGN.md rounded token (${[...radiusTokens].join(", ")})` });
      if (sizeTokens.size) for (const m of code.matchAll(/\btext-\[([\d.]+(?:px|rem))\]/g))
        if (!sizeTokens.has(norm(m[1]))) other.push({ check: "brand.token", selector: `${rel}:${i + 1}`, px: null, msg: `font-size ${m[1]} is not a DESIGN.md typography size` });
      if (!isCss) for (const b of bannedText) {
        // only visible copy: JSX text between tags or string literals, never identifiers
        const strs = [...code.matchAll(/>([^<>{}]+)</g), ...code.matchAll(/(["'`])((?:(?!\1).)+)\1/g)].map((m) => m[2] ?? m[1]);
        const hit = strs.find((s) => (b.kind === "text" ? s.includes(b.value) : new RegExp(b.value, "i").test(s)));
        if (hit) other.push({ check: "brand.banned", selector: `${rel}:${i + 1}`, px: null, msg: `banned text "${b.value}" in copy: "${hit.trim().slice(0, 50)}"${b.note ? ` (${b.note})` : ""}` });
      }
    });
  }
  return { colours, fonts, other, files: files.length };
}
const norm = (v) => String(v).trim().replace(/^0+(\d)/, "$1").toLowerCase();
