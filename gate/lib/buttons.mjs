// Design Kit — dead-button check. Clicks every visible button / script link and proves it does
// SOMETHING: navigation, a DOM change, a network request, a popup/dialog/download, a focus move
// or a scroll. Safe on a real dev server: every mutating request (POST/PUT/PATCH/DELETE) and every
// logout/sign-out request is ABORTED before it leaves the browser — it still counts as "the button
// works", but nothing is written. Logout-style controls are never clicked.
const DANGER = /\b(log ?out|sign ?out|delete account|close account)\b/i;

export function candidatesInPage(opts) {
  const LANDMARK = new Set(["nav", "header", "main", "footer", "aside", "form", "section", "dialog", "article"]);
  function sel(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 6) {
      const tag = cur.tagName.toLowerCase();
      if (cur.id && /^[A-Za-z][\w-]*$/.test(cur.id)) { parts.unshift(`${tag}#${cur.id}`); break; }
      let s = tag;
      const p = cur.parentElement;
      if (p && p.children.length > 1) s += `:nth-child(${[...p.children].indexOf(cur) + 1})`;
      parts.unshift(s);
      if (tag === "body") break;
      cur = p;
    }
    return parts.join(" > ");
  }
  const allow = (opts.allow || []).filter((s) => { try { document.querySelector(s); return true; } catch { return false; } });
  const ok = (el) => el.closest("[data-design-ok]") || allow.some((s) => { try { return el.matches(s); } catch { return false; } });
  const q = 'button:not([disabled]), [role="button"]:not([aria-disabled="true"]), input[type="button"], input[type="submit"], summary, a[href="#"], a[href=""], a[href^="javascript:"], a:not([href])[onclick], [onclick]:not(a):not(button)';
  const out = [];
  for (const el of document.querySelectorAll(q)) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.pointerEvents === "none" || Number(s.opacity) === 0) continue;
    if (el.closest('[aria-hidden="true"], [inert]')) continue;
    if (ok(el)) continue;
    // a button inside a link to the page you're on (a "Home" tab on /) is correctly a no-op
    const link = el.closest("a[href]");
    if (link) { try { const u = new URL(link.href, location.href); if (u.origin === location.origin && u.pathname === location.pathname && u.search === location.search) continue; } catch {} }
    const text = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || el.value || "").replace(/\s+/g, " ").trim().slice(0, 50);
    out.push({ sel: sel(el), text, tag: el.tagName.toLowerCase(), hash: el.getAttribute("href") === "#" });
  }
  return out;
}

async function scrollRestore(page) {
  await page.evaluate(() => { for (const s of [document.scrollingElement, document.body]) if (s) s.scrollTop = 0; });
}

export async function deadButtons({ page, url, vw, allow, budget, seen, log }) {
  const findings = [];
  const errs = [];
  let reqs = 0;
  const onReq = () => { reqs++; };
  // count the app's own errors only: not dev-mode React warnings, not third-party SDK loggers, not requests the gate aborted
  const origin = new URL(url).origin;
  const onConsole = (m) => {
    if (m.type() !== "error") return;
    const t = m.text(), src = m.location()?.url || "";
    if (/Failed to load resource|ERR_FAILED|ERR_ABORTED|net::|Failed to fetch|NetworkError|Load failed|AbortError|blockedbyclient/i.test(t)) return;
    if (/^Warning: /.test(t) || /^\[[A-Z_]+\]/.test(t) || /identity provider|FedCM|One Tap/i.test(t)) return;
    if (src && !src.startsWith(origin)) return;
    errs.push(t);
  };
  const onPageErr = (e) => { if (!/Failed to fetch|NetworkError|Load failed|AbortError/i.test(String(e.message))) errs.push(String(e.message)); };
  let dialogs = 0; const onDialog = (d) => { dialogs++; d.dismiss().catch(() => {}); };
  let popups = 0; const onPopup = (p) => { popups++; p.close().catch(() => {}); };
  let downloads = 0; const onDl = (d) => { downloads++; d.cancel().catch(() => {}); };
  page.on("request", onReq); page.on("console", onConsole); page.on("pageerror", onPageErr); page.on("dialog", onDialog); page.on("popup", onPopup); page.on("download", onDl);
  try {
    const cands = await page.evaluate(candidatesInPage, { allow });
    let clicked = 0;
    for (const c of cands) {
      const key = `${c.tag}|${c.text}`;
      if (seen.has(key)) continue;                 // proven at another viewport or route
      if (DANGER.test(c.text)) { seen.add(key); continue; }
      if (clicked >= budget.left) break;
      if (page.url().split("#")[0] !== url.split("#")[0]) { await page.goto(url, { waitUntil: "load" }).catch(() => {}); await page.waitForTimeout(400); }
      const loc = page.locator(c.sel).first();
      if (!(await loc.isVisible().catch(() => false))) continue;
      await loc.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});   // scroll BEFORE the snapshot: the click's own scroll is not an effect
      await page.waitForTimeout(80);
      const before = await page.evaluate((s) => {
        window.__dkMut = 0;
        if (!window.__dkObs) { window.__dkObs = new MutationObserver((m) => { window.__dkMut += m.length; }); window.__dkObs.observe(document, { subtree: true, childList: true, attributes: true, characterData: true }); }
        const el = document.querySelector(s);
        const sc = [window.scrollY, document.body.scrollTop, document.scrollingElement?.scrollTop || 0].join(",");
        return { sc, url: location.href.split("#")[0], hash: location.hash, focus: document.activeElement === el };
      }, c.sel).catch(() => null);
      if (!before) continue;
      const r0 = reqs, d0 = dialogs, p0 = popups, dl0 = downloads, e0 = errs.length;
      clicked++; budget.left--;
      try {
        await loc.click({ timeout: 2500, noWaitAfter: true });
      } catch (e) {
        const m = String(e.message);
        const cover = m.match(/<([a-z]+)[^>]*> (?:from <[^>]+> subtree )?intercepts pointer events/);
        if (cover) findings.push({ check: "overlap.click", selector: c.sel, px: null, msg: `click on ${c.tag} "${c.text}" is blocked: a <${cover[1]}> sits on top of it` });
        continue;
      }
      await page.waitForTimeout(450);
      const after = await page.evaluate((s) => {
        const el = document.querySelector(s);
        const sc = [window.scrollY, document.body.scrollTop, document.scrollingElement?.scrollTop || 0].join(",");
        const ae = document.activeElement;
        const dlg = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog[open], [data-state="open"]')].some((d) => d.getBoundingClientRect().height > 0);
        return { mut: window.__dkMut, sc, url: location.href.split("#")[0], hash: location.hash, focusMoved: ae && ae !== el && ae !== document.body && !(el && el.contains(ae)), dlg, lock: getComputedStyle(document.body).overflow === "hidden" };
      }, c.sel).catch(() => ({ mut: 1, url: "navigated", sc: before.sc }));
      const navigated = after.url !== before.url || (!c.hash && after.hash !== before.hash);
      const effect = navigated || after.mut > 0 || reqs > r0 || dialogs > d0 || popups > p0 || downloads > dl0 || after.focusMoved || (!c.hash && after.sc !== before.sc);
      if (errs.length > e0) findings.push({ check: "buttons.error", selector: c.sel, px: null, msg: `clicking ${c.tag} "${c.text}" throws: ${errs.slice(e0).join(" | ").slice(0, 160)}` });
      if (!effect) findings.push({ check: "buttons.dead", selector: c.sel, px: null, msg: `${c.tag} "${c.text || "(no label)"}" does nothing on click: no navigation, DOM change, request, dialog or focus move` });
      else seen.add(key);
      if (navigated || popups > p0) { await page.goto(url, { waitUntil: "load" }).catch(() => {}); await page.waitForTimeout(400); }
      else if (after.dlg || after.lock) {
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(250);
        const still = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog[open]')].some((d) => d.getBoundingClientRect().height > 0) || getComputedStyle(document.body).overflow === "hidden").catch(() => true);
        if (still) { await page.goto(url, { waitUntil: "load" }).catch(() => {}); await page.waitForTimeout(400); }
      }
      await scrollRestore(page).catch(() => {});
    }
    log?.(`    buttons ${new URL(url).pathname} @${vw}: ${clicked} clicked, ${findings.length} finding(s)`);
  } finally {
    page.off("request", onReq); page.off("console", onConsole); page.off("pageerror", onPageErr); page.off("dialog", onDialog); page.off("popup", onPopup); page.off("download", onDl);
  }
  return findings;
}
