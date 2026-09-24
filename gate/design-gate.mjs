#!/usr/bin/env node
// Design Kit gate — the rendered + code design check that plugs into verify.sh.
//   design-gate [--repo .] [--force] [--json] [--only a,b] [--url U] [--routes /,/shop] [--no-start]
// Exit 0 clean · 1 findings (blocks "done") · 3 could not run here (no server / no browser) — the
// verify.sh block prints that VISIBLY and does not fail (same rule as the Starter Kit's audit step).
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { inpageChecks } from "./lib/inpage.js";
import { deadButtons } from "./lib/buttons.mjs";
import { loadConfig, findDesignMd, loadTokens, loadBanned, loadAllow, staticScan, srcRoots, listFiles, SRC_EXT, fontFaceFamilies } from "./lib/repo.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.DESIGN_KIT_HOME || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"), "design-kit");
const RUNTIME = path.join(HOME, "runtime");
const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(n);
const REPO = path.resolve(arg("--repo", process.cwd()));
const JSON_OUT = flag("--json");
const log = (...a) => { if (!JSON_OUT) console.log(...a); };
const HEIGHT = { 375: 812, 390: 844, 768: 1024, 1024: 768, 1280: 800, 1440: 900, 1920: 1080 };

const cfg = loadConfig(REPO);
if (arg("--url")) cfg.url = arg("--url");
if (arg("--routes")) cfg.routes = arg("--routes").split(",");
const only = arg("--only") ? new Set(arg("--only").split(",")) : null;
const on = (c) => cfg.checks[c] !== false && (!only || only.has(c));

// ---------- fingerprint: skip when nothing UI-related changed since the last green run ----------
function fingerprint() {
  const roots = srcRoots(REPO, cfg);
  const extra = [findDesignMd(REPO, cfg), path.join(REPO, ".agents/design-kit.json"), path.join(REPO, ".agents/design-banned.txt"), path.join(REPO, ".agents/design-ok.txt"),
    ...["tailwind.config.ts", "tailwind.config.js", "index.html", "client/index.html"].map((f) => path.join(REPO, f))].filter((f) => f && fs.existsSync(f));
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(path.join(HERE, "lib/inpage.js")));   // a kit update re-runs the gate
  for (const f of [...listFiles(REPO, roots, SRC_EXT, 20000), ...extra].sort()) {
    const st = fs.statSync(f);
    h.update(`${path.relative(REPO, f)}:${st.size}:${st.mtimeMs}\n`);
  }
  return h.digest("hex").slice(0, 16);
}
const STATE = path.join(REPO, ".design-kit");
const LAST = path.join(STATE, "last-pass");
const fp = fingerprint();
if (!flag("--force") && !only && fs.existsSync(LAST) && fs.readFileSync(LAST, "utf8").trim() === fp) {
  log(`✓ design gate: UI unchanged since the last clean run (${fp}) — nothing to re-check`);
  process.exit(0);
}

// ---------- runtime ----------
const req = createRequire(path.join(RUNTIME, "package.json"));
let chromium;
try { ({ chromium } = req("playwright")); } catch {
  console.log(`⚠ design gate skipped: runtime missing at ${RUNTIME} (run the Design Kit installer, or design-update)`);
  process.exit(3);
}

// ---------- server ----------
async function up(u) { try { const r = await fetch(u, { signal: AbortSignal.timeout(15000) }); return r.status < 500; } catch { return false; } }
let server = null;
async function ensureServer() {
  if (await up(cfg.url)) return true;
  if (!cfg.start || flag("--no-start")) return false;
  log(`▶ starting the app: ${cfg.start}`);
  fs.mkdirSync(STATE, { recursive: true });
  const out = fs.openSync(path.join(STATE, "server.log"), "w");
  server = spawn("bash", ["-c", cfg.start], { cwd: REPO, detached: true, stdio: ["ignore", out, out], env: { ...process.env, BROWSER: "none" } });
  for (let i = 0; i < 90; i++) { if (await up(cfg.url)) return true; await new Promise((r) => setTimeout(r, 1000)); if (server.exitCode != null) break; }
  return false;
}
function stopServer() { if (server && server.exitCode == null) { try { process.kill(-server.pid, "SIGTERM"); } catch {} } }
process.on("exit", stopServer);
process.on("SIGINT", () => process.exit(130));

// ---------- findings ----------
const findings = [];
const push = (f, route, vw) => findings.push({ ...f, route, vw });

const tokens = loadTokens(findDesignMd(REPO, cfg), REPO);
const banned = loadBanned(REPO);
const allow = loadAllow(REPO, cfg);
const needsBrowser = ["layout", "buttons", "overlap", "align", "brand", "type", "impeccable"].some(on);

async function main() {
  const t0 = Date.now();
  log(`── design gate · ${path.basename(REPO)} · ${cfg.routes.length} route(s) × ${cfg.viewports.join("/")}px`);
  if (!tokens.path) log("  ⚠ no DESIGN.md (docs/DESIGN.md or DESIGN.md): brand checks have no palette — the design-direction skill writes one");
  else log(`  · tokens: ${path.relative(REPO, tokens.path)} (${tokens.frontMatter ? "front matter" : "prose only"}) — ${tokens.colors.length} colours, ${tokens.fonts.length} font(s)${tokens.frontMatterError ? ` ⚠ front matter unreadable: ${tokens.frontMatterError}` : ""}`);

  let browser;
  try { browser = await chromium.launch(); } catch (e) {
    console.log(`⚠ design gate skipped: cannot launch Chromium here (${String(e.message).split("\n")[0]}). Run design-update to install it.`);
    process.exit(3);
  }

  // colour equality is decided by the browser, which parses every CSS colour syntax
  const scratch = await browser.newPage();
  const normalise = (list) => scratch.evaluate((vals) => { const p = document.createElement("i"); document.body.appendChild(p); return vals.map((v) => { p.style.color = ""; p.style.color = v; return p.style.color ? getComputedStyle(p).color : null; }); }, list);
  const paletteRgb = new Set((await normalise(tokens.colors)).filter(Boolean).map(rgbKey));
  const bannedColours = banned.filter((b) => b.kind === "color");
  const bannedRgb = (await normalise(bannedColours.map((b) => b.value))).map(rgbKey);

  // ---- code: values that are not tokens ------------------------------------------------------
  if (on("brand")) {
    const scan = staticScan(REPO, cfg, tokens, banned);
    const rgb = await normalise(scan.colours.map((c) => c.value));
    const off = new Map(), undocumented = [];
    scan.colours.forEach((c, i) => {
      if (!rgb[i]) return;
      const k = rgbKey(rgb[i]);
      const bi = bannedRgb.findIndex((b) => b && nearKey(b, k));
      if (bi >= 0) push({ check: "brand.banned", selector: `${c.file}:${c.line}`, px: null, msg: `banned colour ${c.value}${bannedColours[bi].note ? ` (${bannedColours[bi].note})` : ""}` }, "code", null);
      if (tokens.path && ![...paletteRgb].some((p) => nearKey(p, k))) {
        if (c.def) { undocumented.push(c); return; }
        if (!off.has(c.value.toLowerCase())) off.set(c.value.toLowerCase(), []);
        off.get(c.value.toLowerCase()).push(c);
      }
    });
    // stylesheet token definitions that DESIGN.md doesn't list: one finding — DESIGN.md is behind the code
    if (undocumented.length) push({ check: "brand.token", selector: `${undocumented[0].file}:${undocumented[0].line}`, px: null, msg: `${undocumented.length} CSS colour token definition(s) are not in DESIGN.md (e.g. ${undocumented.slice(0, 3).map((c) => `${c.name ? `--${c.name} ` : ""}${c.value}`).join(", ")}): add them to DESIGN.md's front matter (\`design-tokens\` drafts it) or retire them` }, "code", null);
    for (const [v, list] of off) push({ check: "brand.token", selector: `${list[0].file}:${list[0].line}`, px: null, msg: `colour ${v} is not a DESIGN.md token (${list.length} use${list.length > 1 ? "s" : ""}${list.length > 1 ? `, also ${list.slice(1, 3).map((l) => `${l.file}:${l.line}`).join(", ")}` : ""})` }, "code", null);
    const allowedFonts = tokens.fonts.map((f) => f.toLowerCase());
    const GENERIC = /^(serif|sans-serif|monospace|system-ui|ui-[a-z-]+|inherit|initial|-apple-system|blinkmacsystemfont|cursive|fantasy|arial|helvetica|georgia|segoe ui|roboto|menlo|monaco|consolas|courier new)$/i;
    const offFonts = new Map();
    for (const f of scan.fonts) {
      const k = f.value.toLowerCase();
      if (banned.some((b) => b.kind === "font" && k.includes(b.value.toLowerCase()))) push({ check: "brand.banned", selector: `${f.file}:${f.line}`, px: null, msg: `banned font "${f.value}"` }, "code", null);
      if (tokens.path && !GENERIC.test(k) && !/fallback$/i.test(k) && !allowedFonts.some((a) => k === a || k.startsWith(a + " ") || a.startsWith(k))) {
        if (!offFonts.has(k)) offFonts.set(k, []);
        offFonts.get(k).push(f);
      }
    }
    for (const [, list] of offFonts) push({ check: "brand.token", selector: `${list[0].file}:${list[0].line}`, px: null, msg: `font "${list[0].value}" is not in DESIGN.md's typography (${list.length} use${list.length > 1 ? "s" : ""})` }, "code", null);
    for (const o of scan.other) push(o, "code", null);
    log(`  · code: ${scan.files} files scanned`);
  }
  await scratch.close();

  if (!needsBrowser) return finish(browser, t0);
  if (!(await ensureServer())) {
    await browser.close();
    const tail = fs.existsSync(path.join(STATE, "server.log")) ? fs.readFileSync(path.join(STATE, "server.log"), "utf8").trim().split("\n").slice(-3).join(" | ") : "";
    console.log(`⚠ design gate: rendered checks skipped — ${cfg.url} is not reachable${cfg.start ? ` and \`${cfg.start}\` did not bring it up${tail ? ` (${tail.slice(0, 200)})` : ""}` : " (start the dev server, or set \"start\" in .agents/design-kit.json)"}`);
    if (findings.length) return report(t0);
    process.exit(3);
  }

  // phones are emulated as phones (touch, coarse pointer, mobile viewport rules), the rest as desktop
  const contexts = {};
  async function contextFor(vw) {
    const kind = vw < 768 ? "phone" : "desktop";
    if (contexts[kind]) return contexts[kind];
    const c = await browser.newContext({ deviceScaleFactor: 2, reducedMotion: "reduce", serviceWorkers: "block", isMobile: kind === "phone", hasTouch: kind === "phone" });
    // "storage": pre-seed localStorage / sessionStorage / cookies (age gates, consent banners, feature flags)
    const st = cfg.storage || {};
    if (st.localStorage || st.sessionStorage) await c.addInitScript((x) => {
      try { for (const [k, v] of Object.entries(x.l || {})) localStorage.setItem(k, v); for (const [k, v] of Object.entries(x.s || {})) sessionStorage.setItem(k, v); } catch {}
    }, { l: st.localStorage, s: st.sessionStorage });
    if (st.cookies) await c.addCookies(st.cookies.map((ck) => ({ url: cfg.url, ...ck })));
    // nothing the gate clicks may write: mutating and sign-out requests are aborted in the browser
    await c.route("**/*", (route) => {
      const r = route.request();
      if (!["GET", "HEAD", "OPTIONS"].includes(r.method()) || /log-?out|sign-?out/i.test(r.url())) return route.abort("blockedbyclient");
      return route.continue();
    });
    return (contexts[kind] = c);
  }
  const seen = new Set();
  const budget = { left: cfg.clicks * cfg.routes.length };
  const external = [];
  for (const route of cfg.routes) {
    const url = new URL(route, cfg.url).href;
    if (on("layout")) external.push(sweep("layout", route, (emit) => layoutSweep(url, route, emit)));
    if (on("impeccable")) external.push(sweep("impeccable", route, (emit) => impeccable(url, route, emit)));
  }
  const sweeps = pool(external, 3).then(() => (on("impeccable") && Date.now() < deadline() ? impeccableSource() : null));
  for (const route of cfg.routes) {
    const url = new URL(route, cfg.url).href;
    for (const vw of cfg.viewports) {
      const page = await (await contextFor(vw)).newPage();
      await page.setViewportSize({ width: vw, height: HEIGHT[vw] || Math.round(vw * 1.6) });
      const loadErrs = [];
      page.on("pageerror", (e) => { if (!/Failed to fetch|NetworkError|AbortError|Load failed/i.test(String(e.message))) loadErrs.push(String(e.message)); });
      try {
        await page.goto(url, { waitUntil: "load", timeout: 30000 });
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        await page.evaluate(() => document.fonts.ready.then(() => true));
        await page.waitForTimeout(500);
      } catch (e) { push({ check: "page.load", selector: "(page)", px: null, msg: `could not load: ${String(e.message).split("\n")[0]}` }, route, vw); await page.close(); continue; }
      for (const e of [...new Set(loadErrs)]) push({ check: "page.error", selector: "(page)", px: null, msg: `uncaught script error on load: ${e.slice(0, 160)}` }, route, vw);
      const opts = { vw, palette: tokens.path ? tokens.colors : [], fonts: tokens.path ? tokens.fonts : [], banned, allow, phase: "top", whitespace: cfg.whitespace || {} };
      const want = (f) => (f.check.startsWith("align") || f.check.startsWith("spacing") ? on("align") : f.check.startsWith("overlap") ? on("overlap") : f.check.startsWith("brand") ? on("brand") : f.check.startsWith("type") ? on("type") : f.check.startsWith("space") ? on("space") : true);
      if (["align", "overlap", "brand", "type", "space"].some(on)) {
        if (on("space")) {   // scroll through once so lazy / reveal-on-scroll sections exist before voids are measured
          await page.evaluate(async () => {
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            for (const i of document.querySelectorAll('img[loading="lazy"]')) i.loading = "eager";
            const se = document.scrollingElement;
            for (let i = 0; i < 60 && se.scrollTop + innerHeight < se.scrollHeight; i++) { se.scrollTop += innerHeight; await wait(100); }
            const pending = [...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.addEventListener("load", r, { once: true }); i.addEventListener("error", r, { once: true }); }));
            await Promise.race([Promise.all(pending), wait(5000)]);
            se.scrollTop = 0; await wait(200);
          });
        }
        for (const f of await page.evaluate(inpageChecks, opts)) if (want(f)) push(f, route, vw);
        if (on("overlap")) {
          await page.evaluate(() => { for (const s of [document.scrollingElement, document.body, ...document.querySelectorAll("main, [data-scroll-container]")]) if (s) s.scrollTop = s.scrollHeight; });
          await page.waitForTimeout(400);
          for (const f of await page.evaluate(inpageChecks, { ...opts, phase: "bottom" })) push(f, route, vw);
          await page.evaluate(() => { for (const s of [document.scrollingElement, document.body]) if (s) s.scrollTop = 0; });
        }
      }
      if (on("buttons")) for (const f of await deadButtons({ page, url, vw, allow, budget, seen, log })) push(f, route, vw);
      await page.close();
    }
  }
  await sweeps;
  if (pending.length) push({ check: "gate.incomplete", selector: "(run)", px: null, msg: `time budget (${+cfg.budget || 300}s) spent before ${pending.length} sweep(s): ${pending.join(", ")} — re-run design-gate; finished sweeps are cached, so it continues from here` }, "(all)", null);
  return finish(browser, t0);
}

// frontend-visual-qa's bundled Playwright sweep, all viewports, warnings count as failures
function layoutSweep(url, route, emit = push) {
  const script = path.join(HOME, "skills/frontend-visual-qa/scripts/visual_layout_audit.mjs");
  if (!fs.existsSync(script)) { log(`  ⚠ layout sweep skipped: ${script} missing (design-update fetches it)`); return Promise.resolve(); }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "dk-fvqa-"));
  const args = [script, "--url", url, "--fail-on-warning", "--out", out, "--page-type", "app", ...cfg.viewports.flatMap((v) => ["--viewport", `${v}x${HEIGHT[v] || Math.round(v * 1.6)}`])];
  return new Promise((resolve) => {
    const ch = spawn(process.execPath, args, { cwd: RUNTIME, env: { ...process.env, NODE_PATH: path.join(RUNTIME, "node_modules") } });
    let err = "";
    ch.stderr.on("data", (d) => (err += d)); ch.stdout.on("data", (d) => (err += d));
    const timer = setTimeout(() => ch.kill("SIGKILL"), Math.max(20000, deadline() - Date.now()));
    ch.on("close", () => {
      clearTimeout(timer);
      const rp = path.join(out, "frontend-visual-qa-report.json");
      if (!fs.existsSync(rp)) { emit({ check: "layout.run", selector: "(page)", px: null, msg: `layout sweep failed to run: ${err.trim().split("\n").slice(-2).join(" ").slice(0, 200)}` }, route, null); return resolve(); }
      const rep = JSON.parse(fs.readFileSync(rp, "utf8"));
      for (const i of rep.issues || []) {
        if (/sr-only|visually-hidden|screen-reader/.test(i.selector || "")) continue;   // skip links are hidden until focused by design
        const name = String(i.viewport || "");
        const vw = +(name.match(/(\d{3,4})x\d+/)?.[1] || cfg.viewports[+(name.match(/(\d+)$/)?.[1] || 0) - 1] || 0) || null;
        emit({ check: `layout.${i.type}`, selector: i.selector || "(page)", px: null, msg: [i.detail, i.textEvidence?.text ? `"${String(i.textEvidence.text).slice(0, 40)}"` : ""].filter(Boolean).join(" ").slice(0, 220) || i.type }, route, vw);
      }
      for (const e of rep.runErrors || []) emit({ check: "layout.run", selector: "(page)", px: null, msg: e }, route, null);
      fs.rmSync(out, { recursive: true, force: true });
      resolve();
    });
  });
}

// Sweeps that drive their own browser (frontend-visual-qa, impeccable) are the slow part. Each
// finished sweep is cached per UI fingerprint, and the run stops starting new ones once its time
// budget (cfg.budget, default 300s — inside the Stop hook's 600s) is spent. Unfinished sweeps are a
// blocking finding, never a pass: the next run replays the cache and continues where this stopped.
const T0 = Date.now();
const deadline = () => T0 + (+cfg.budget || 300) * 1000;
const SWEEPS = path.join(STATE, "sweeps", fp);
const pending = [];
if (fs.existsSync(path.dirname(SWEEPS))) for (const d of fs.readdirSync(path.dirname(SWEEPS))) if (d !== fp) fs.rmSync(path.join(path.dirname(SWEEPS), d), { recursive: true, force: true });
function sweep(kind, route, run) {
  const file = path.join(SWEEPS, `${kind}-${route.replace(/[^a-z0-9]+/gi, "_") || "root"}.json`);
  return async () => {
    if (!flag("--force") && fs.existsSync(file)) { for (const f of JSON.parse(fs.readFileSync(file, "utf8"))) push(f.f, f.route, f.vw); return; }
    if (Date.now() > deadline()) { pending.push(`${kind} ${route}`); return; }
    const got = [], t = Date.now();
    await run((f, r, vw) => { got.push({ f, route: r, vw }); push(f, r, vw); });
    if (process.env.DK_TIMING) log(`    ⏱ ${kind} ${route} ${Math.round((Date.now() - t) / 1000)}s`);
    if (!got.some((g) => /\.run$/.test(g.f.check))) { fs.mkdirSync(SWEEPS, { recursive: true }); fs.writeFileSync(file, JSON.stringify(got)); }
  };
}

// the sweeps that drive their own browser run in a small pool, alongside the gate's own browser work
function pool(tasks, n = 3) {
  let i = 0;
  const worker = async () => { while (i < tasks.length) { const t = tasks[i++]; await t(); } };
  return Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
}

// impeccable drives its own browser, which cannot take the gate's storage seed or its write guard.
// So it scans through a local proxy that injects the storage seed into every HTML page and refuses
// every mutating request — the same view and the same safety as the gate's own browser.
let proxyUrl = null;
async function startProxy() {
  if (proxyUrl) return proxyUrl;
  const target = new URL(cfg.url);
  const st = cfg.storage || {};
  const seed = `<script>try{${Object.entries(st.localStorage || {}).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join("")}${Object.entries(st.sessionStorage || {}).map(([k, v]) => `sessionStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join("")}}catch(e){}</script>`;
  const server = http.createServer((req, res) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) || /log-?out|sign-?out/i.test(req.url)) { res.writeHead(403); return res.end(); }
    const headers = { ...req.headers, host: target.host, "accept-encoding": "identity" };
    if (st.cookies) headers.cookie = [headers.cookie, ...st.cookies.map((c) => `${c.name}=${c.value}`)].filter(Boolean).join("; ");
    const up = http.request({ hostname: target.hostname, port: target.port || 80, path: req.url, method: req.method, headers }, (ur) => {
      const html = /text\/html/.test(ur.headers["content-type"] || "");
      if (!html) { res.writeHead(ur.statusCode, ur.headers); return ur.pipe(res); }
      const chunks = [];
      ur.on("data", (c) => chunks.push(c));
      ur.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8").replace(/<head([^>]*)>/i, (m) => m + seed);
        const h = { ...ur.headers }; delete h["content-length"]; delete h["content-encoding"];
        res.writeHead(ur.statusCode, h); res.end(body);
      });
    });
    up.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  server.unref();
  return (proxyUrl = `http://127.0.0.1:${server.address().port}`);
}

function impeccableBin() { const b = path.join(RUNTIME, "node_modules/.bin/impeccable"); return fs.existsSync(b) ? b : null; }
function impeccableRun(targets, extra = []) {
  const bin = impeccableBin();
  if (!bin) { log("  ⚠ impeccable detector skipped: not in the runtime (design-update installs it)"); return Promise.resolve(null); }
  return new Promise((resolve) => {
    const ch = spawn(bin, ["detect", "--json", "--no-advisory", ...extra, ...targets], { cwd: REPO });
    let out = "", err = "";
    const timer = setTimeout(() => ch.kill("SIGKILL"), Math.max(20000, deadline() - Date.now()));
    ch.stdout.on("data", (d) => (out += d)); ch.stderr.on("data", (d) => (err += d));
    ch.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && code !== 2) return resolve({ error: err.trim().split("\n").slice(-1)[0] || `exit ${code}` });
      try { resolve(JSON.parse(out || "[]")); } catch { resolve({ error: `unreadable detector output: ${out.slice(0, 120)}` }); }
    });
  });
}
// The kit's own brand check owns "font outside DESIGN.md"; a font that IS a DESIGN.md token is a
// brand decision, so impeccable's "overused font" opinion does not block it.
const IMP_OWNED = new Set(["design-system-font", "design-system-color"]);
const impSeen = new Set();
const notes = [];
function impKeep(f) {
  if (f.severity !== "error" && f.severity !== "warning") return false;
  if (f.category === "slop") { const k = `${f.antipattern}|${f.snippet}`; if (!notes.some((n) => n.k === k)) notes.push({ k, msg: `${f.name}: ${String(f.snippet || "").slice(0, 100)}` }); return false; }
  if (IMP_OWNED.has(f.antipattern)) return false;
  if (f.antipattern === "overused-font") {
    const fam = String(f.snippet || "").match(/font:\s*([^()]+?)\s*(\(|$)/i)?.[1]?.toLowerCase();
    if (fam && tokens.fonts.some((t) => t.toLowerCase() === fam)) return false;
  }
  return true;
}
const impSel = (f) => (f.snippet ? `"${String(f.snippet).slice(0, 90)}"` : "(page)");
async function impeccable(url, route, emit = push) {
  if (target_is_http(cfg.url)) url = new URL(route, await startProxy()).href;
  // impeccable's detectors are page-level (contrast, headings, padding, line length), so one
  // phone-width pass covers them; the gate's own checks do the per-viewport geometry
  for (const vw of cfg.impeccableViewports || [Math.min(...cfg.viewports)]) {
    const args = ["--viewport", `${vw}x${HEIGHT[vw] || Math.round(vw * 1.6)}`];
    let res = await impeccableRun([url], args);
    if (res?.error && /WS endpoint|Target closed|ECONNRESET|timed? ?out/i.test(res.error)) res = await impeccableRun([url], args);   // a busy machine: one relaunch
    if (!res) return;
    if (res.error) { emit({ check: "impeccable.run", selector: "(page)", px: null, msg: res.error }, route, vw); continue; }
    for (const f of res) if (impKeep(f)) { impSeen.add(`${f.antipattern}|${f.snippet}`); emit({ check: `impeccable.${f.antipattern}`, selector: impSel(f), px: null, msg: f.name }, route, vw); }
  }
}
async function impeccableSource() {
  const roots = srcRoots(REPO, cfg);
  if (!roots.length) return;
  const res = await impeccableRun(roots);
  if (!res || res.error) return;
  for (const f of res) if (impKeep(f) && !impSeen.has(`${f.antipattern}|${f.snippet}`) && !/Primary font/.test(f.snippet || ""))
    push({ check: `impeccable.${f.antipattern}`, selector: `${path.relative(fs.realpathSync(REPO), fs.existsSync(f.file) ? fs.realpathSync(f.file) : f.file)}${f.line ? `:${f.line}` : ""}`, px: null, msg: `${f.name}${f.snippet ? `: ${String(f.snippet).slice(0, 120)}` : ""}` }, "code", null);
}

const target_is_http = (u) => /^http:/.test(u);
function rgbKey(v) { const m = String(v).match(/[\d.]+/g); return m ? m.slice(0, 3).map((n) => Math.round(+n)).join(",") : v; }
function nearKey(a, b) { const x = a.split(",").map(Number), y = b.split(",").map(Number); return x.every((n, i) => Math.abs(n - y[i]) <= 2); }

async function finish(browser, t0) { await browser?.close().catch(() => {}); return report(t0); }

const m_routes = (f) => (f.routes.length > 3 ? `${f.routes.slice(0, 3).join(", ")} +${f.routes.length - 3}` : f.routes.join(", "));
function report(t0) {
  // merge the same finding across viewports
  const merged = new Map();
  for (const f of findings) {
    // same element, same problem on several routes (shared header, footer) = one finding
    const byValue = /^(brand\.colour|brand\.font|brand\.banned|type\.(fallback|synthesis|smoothing|size-adjust|ink|preload|load))$/.test(f.check) && f.route !== "code";
    const k = byValue ? `${f.check}|${f.msg.replace(/\(\d+ elements?\)|on \d+ (element|node)\(s\)/g, "")}` : `${f.check}|${f.selector}|${f.msg.replace(/[\d.]+px/g, "Npx")}|${f.route === "code" ? "code" : "page"}`;
    if (!merged.has(k)) merged.set(k, { ...f, vws: [], routes: [] });
    const m = merged.get(k);
    if (f.route && !m.routes.includes(f.route)) m.routes.push(f.route);
    if (f.vw && !m.vws.includes(f.vw)) m.vws.push(f.vw);
    if (f.px != null && (m.px == null || f.px > m.px)) m.px = f.px, m.msg = f.msg;
  }
  const list = [...merged.values()].sort((a, b) => a.check.localeCompare(b.check));
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(path.join(STATE, "report.json"), JSON.stringify({ repo: REPO, at: new Date().toISOString(), fingerprint: fp, findings: list, notes: notes.map((n) => n.msg) }, null, 2));
  const secs = Math.round((Date.now() - t0) / 1000);
  if (JSON_OUT) console.log(JSON.stringify(list, null, 2));
  else if (!list.length) log(`✓ design gate clean — ${cfg.routes.length} route(s) × ${cfg.viewports.length} viewport(s) in ${secs}s`);
  else {
    const byCheck = {};
    for (const f of list) byCheck[f.check.split(".")[0]] = (byCheck[f.check.split(".")[0]] || 0) + 1;
    log(`✗ design gate: ${list.length} finding(s) — ${Object.entries(byCheck).map(([k, v]) => `${k} ${v}`).join(", ")} (${secs}s)`);
    for (const f of list.slice(0, 80)) log(`  ✗ [${f.check}] ${f.selector} — ${f.msg}${f.route !== "code" ? ` (${m_routes(f)}${f.vws.length ? ` @ ${f.vws.sort((a, b) => a - b).join("/")}px` : ""})` : ""}`);
    if (list.length > 80) log(`  … ${list.length - 80} more in .design-kit/report.json`);
    if (notes.length) log(`  · ${notes.length} taste note(s) from impeccable (not blocking — DESIGN.md decides taste): ${notes.slice(0, 4).map((n) => n.msg).join(" · ")}${notes.length > 4 ? " …" : ""}`);
    log("  Fix each at its source and re-run design-gate. Intentional? Say why in a comment: `design-ok: <selector> — reason` (or data-design-ok).");
  }
  if (!list.length && !only) fs.writeFileSync(LAST, fp + "\n");
  process.exit(list.length ? 1 : 0);
}

main().catch((e) => { console.error(`design gate crashed: ${e.stack || e}`); process.exit(2); });
