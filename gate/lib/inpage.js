// Design Kit — checks that run INSIDE the page (page.evaluate). Self-contained: no imports.
// Every finding: { check, selector, px, msg }. Thresholds are pixels, never percentages.
// opts: { vw, palette: [css colour strings], fonts: [family], banned: [{kind,value,note}],
//         allow: [css selectors], phase: "top"|"bottom" }
export function inpageChecks(opts) {
  if (opts.phase === "bottom") return inpageChecks({ ...opts, phase: "bottom-all" }).filter((f) => f.check.startsWith("overlap"));
  const out = [];
  const T = 1.5; // px
  const round = (n) => Math.round(n * 10) / 10;
  const cs = (el) => getComputedStyle(el);

  // ---------- helpers ----------
  const LANDMARK = new Set(["nav", "header", "main", "footer", "aside", "form", "section", "dialog", "article"]);
  function sel(el) {
    if (!el || el.nodeType !== 1) return "?";
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 5) {
      const tag = cur.tagName.toLowerCase();
      if (cur.id && /^[A-Za-z][\w-]*$/.test(cur.id)) { parts.unshift(`${tag}#${cur.id}`); break; }
      let s = tag;
      const cls = typeof cur.className === "string" ? cur.className.split(/\s+/).find((c) => /^[a-z][a-z0-9_-]{1,23}$/i.test(c)) : null;
      if (cls) s += `.${cls}`;
      const p = cur.parentElement;
      if (p) {
        const idx = [...p.children].indexOf(cur) + 1;
        if (p.children.length > 1) s += `:nth-child(${idx})`;
      }
      parts.unshift(s);
      if (LANDMARK.has(tag) || tag === "body") break;
      cur = p;
    }
    return parts.join(" > ");
  }
  function label(el) {
    const t = (el.getAttribute?.("aria-label") || el.textContent || el.getAttribute?.("alt") || "").replace(/\s+/g, " ").trim();
    return t ? ` "${t.slice(0, 40)}"` : "";
  }
  const allowSel = (opts.allow || []).filter((s) => { try { document.querySelector(s); return true; } catch { return false; } });
  function intentional(el) {
    for (let cur = el, i = 0; cur && cur.nodeType === 1 && i < 4; cur = cur.parentElement, i++) {   // own + 3 ancestors
      if (cur.hasAttribute("data-design-ok")) return true;
      let prev = cur.previousSibling;
      while (prev && prev.nodeType === 3 && !prev.textContent.trim()) prev = prev.previousSibling;
      if (prev && prev.nodeType === 8 && /design-ok/i.test(prev.textContent)) return true;
      for (const s of allowSel) { try { if (cur.matches(s)) return true; } catch {} }
    }
    return false;
  }
  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = cs(el);
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ps = cs(p);
      if (Number(ps.opacity) === 0 || ps.visibility === "hidden") return false;
    }
    return true;
  }
  const inViewport = (r) => r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  function add(check, el, px, msg) {
    if (el && intentional(el)) return;
    out.push({ check, selector: el ? sel(el) : "(page)", px: px == null ? null : round(px), msg });
  }
  const all = [...document.body.querySelectorAll("*")].slice(0, 6000);

  // ---------- icons ----------
  const ICON_CLASS = /(^|[\s_-])(icon|fa[srlbd]?|bi|ri|lucide|ph|material-(icons|symbols)[\w-]*|glyph)([\s_-]|$)/i;
  function isIcon(el) {
    const tag = el.tagName.toLowerCase();
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6 || r.width > 64 || r.height > 64) return false;
    if (tag === "svg") return !el.parentElement?.closest("svg");
    if (tag === "img") return r.width <= 32 && r.height <= 32;
    if ((tag === "i" || tag === "span") && (ICON_CLASS.test(el.className?.baseVal ?? el.className ?? "") || el.hasAttribute("data-icon")))
      return el.children.length === 0 && (el.textContent || "").trim().length <= 2;
    return false;
  }
  const icons = all.filter((el) => visible(el) && isIcon(el));

  // canvas metrics → optical centre of text (cap height centred on the baseline), not the line box
  const ctx = document.createElement("canvas").getContext("2d");
  const metricCache = new Map();
  function metrics(el) {
    const s = cs(el);
    const font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    if (metricCache.has(font)) return metricCache.get(font);
    ctx.font = font;
    const m = ctx.measureText("H");
    const v = { ascent: m.fontBoundingBoxAscent, cap: m.actualBoundingBoxAscent, xh: ctx.measureText("x").actualBoundingBoxAscent };
    metricCache.set(font, v);
    return v;
  }
  function firstTextLine(container, skip) {
    const w = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (!n.textContent.trim() || skip.contains(n) || n.parentElement?.closest("svg") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const pe = n.parentElement;
      if (!pe || !visible(pe)) continue;
      const txt = n.textContent;
      const a = txt.search(/\S/);
      const range = document.createRange();
      range.setStart(n, a);
      range.setEnd(n, Math.min(txt.length, a + 1));
      const rect = range.getClientRects()[0];
      if (!rect || rect.height < 1) continue;
      const m = metrics(pe);
      const baseline = rect.top + m.ascent;
      return { el: pe, rect, opticalY: baseline - m.cap / 2, text: txt.trim().slice(0, 30) };
    }
    return null;
  }

  // 1. icon vs label ------------------------------------------------------------------
  const iconOwner = new Map();
  for (const ic of icons) {
    if (["absolute", "fixed"].includes(cs(ic).position) || ["absolute", "fixed"].includes(cs(ic.parentElement).position)) continue;
    let box = ic.parentElement, line = null;
    for (let depth = 0; box && depth < 3 && !line; depth++, box = box.parentElement) line = firstTextLine(box, ic);
    if (!line) continue;
    const ir = ic.getBoundingClientRect(), lr = line.rect;
    const iconCy = ir.top + ir.height / 2, iconCx = ir.left + ir.width / 2;
    const sideBySide = (ir.right <= lr.left + 1 || ir.left >= lr.right - 1) && ir.bottom > lr.top && ir.top < lr.bottom;
    const gap = Math.min(Math.abs(lr.left - ir.right), Math.abs(ir.left - lr.right));
    if (sideBySide && gap <= 32) {
      iconOwner.set(ic, line.el);
      // an icon centred on a multi-line block (title + subtitle) follows the block, not its first line
      let blk = line.el;
      while (blk.parentElement && !blk.parentElement.contains(ic)) blk = blk.parentElement;
      const br = blk.getBoundingClientRect();
      const lh = parseFloat(cs(line.el).lineHeight) || lr.height;
      if (br.height > lh * 1.5 && Math.abs(iconCy - (br.top + br.height / 2)) <= T) continue;
      const d = iconCy - line.opticalY;
      if (Math.abs(d) > T)
        add("align.icon-label", ic, Math.abs(d), `icon is ${round(Math.abs(d))}px ${d > 0 ? "below" : "above"} the optical centre of its label "${line.text}"`);
    } else if (ir.bottom <= lr.top + 1 && lr.top - ir.bottom <= 24) {
      // stacked (icon above label): centred horizontally on the label line
      const block = line.el;
      let common = ic.parentElement;
      while (common && !common.contains(block)) common = common.parentElement;
      const ccs = common ? cs(common) : null;
      const colCentred = ccs && ccs.display.includes("flex") && ccs.flexDirection.startsWith("column") && ccs.alignItems === "center";
      if (cs(block).textAlign === "center" || colCentred) {
        const lineRange = document.createRange();
        lineRange.selectNodeContents(block);
        const lr0 = lineRange.getClientRects()[0] || lr;
        const d = iconCx - (lr0.left + lr0.width / 2);
        if (Math.abs(d) > T) add("align.icon-label", ic, Math.abs(d), `stacked icon is ${round(Math.abs(d))}px ${d > 0 ? "right" : "left"} of its label's centre "${line.text}"`);
      }
    }
  }

  // helpers for row grouping
  function visualRows(items) {
    const rows = [];
    for (const it of items.sort((a, b) => a.r.top - b.r.top)) {
      const row = rows.find((rw) => rw.some((o) => it.r.top < o.r.bottom - 2 && it.r.bottom > o.r.top + 2));
      row ? row.push(it) : rows.push([it]);
    }
    return rows;
  }
  function majority(vals) {
    // cluster values within 1px; return the biggest cluster's mean and size
    const sorted = [...vals].sort((a, b) => a - b);
    let best = { n: 0, v: 0 };
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted.filter((x) => Math.abs(x - sorted[i]) <= 1);
      if (c.length > best.n) best = { n: c.length, v: c.reduce((a, b) => a + b, 0) / c.length };
    }
    return best;
  }
  const transparentBg = (c) => !c || c === "transparent" || /rgba\([^)]*,\s*0\)$/.test(c);
  const isButtonLike = (el) => el.matches('button, [role="button"], input[type="submit"], input[type="button"], a[class*="btn"], a[class*="button"], a[class*="rounded-full"][class*="px-"], a[class*="rounded-pill"]');

  // 2. rows · 3. equal sizes -------------------------------------------------------------
  for (const c of all) {
    const s = cs(c);
    const isFlexRow = (s.display === "flex" || s.display === "inline-flex") && !s.flexDirection.startsWith("column");
    const isGrid = s.display === "grid" || s.display === "inline-grid";
    if (!isFlexRow && !isGrid) continue;
    if (!visible(c)) continue;
    const kids = [...c.children]
      .filter((k) => visible(k) && !isIcon(k) && !["absolute", "fixed"].includes(cs(k).position))
      .map((k) => ({ el: k, r: k.getBoundingClientRect(), s: cs(k) }));
    if (kids.length < 2) continue;
    for (const row of visualRows(kids)) {
      if (row.length < 2) continue;
      // equal sizes: side-by-side buttons
      const boxedBtn = (k) => !transparentBg(k.s.backgroundColor) || parseFloat(k.s.borderTopWidth) > 0 || (k.s.boxShadow && k.s.boxShadow !== "none");
      const btns = row.filter((k) => isButtonLike(k.el) && boxedBtn(k));   // a text link beside a CTA is not a button pair
      if (btns.length >= 2) {
        const m = majority(btns.map((b) => b.r.height));
        for (const b of btns) {
          const d = b.r.height - m.v;
          if (Math.abs(d) > T && (m.n >= 2 || btns.length === 2))
            add("align.equal-height", b.el, Math.abs(d), `button${label(b.el)} is ${round(b.r.height)}px tall beside ${btns.length - 1} sibling(s) at ${round(m.v)}px`);
        }
      }
      if (isGrid && row.length >= 2) {
        const ai = s.alignItems;
        const tops = majority(row.map((k) => k.r.top));
        for (const k of row) {
          const d = k.r.top - tops.v;
          if (Math.abs(d) > T && Math.abs(d) <= 24 && tops.n >= 2)
            add("align.grid-row", k.el, Math.abs(d), `grid item top is ${round(Math.abs(d))}px off its row`);
        }
        if (ai === "normal" || ai === "stretch") {
          const bots = majority(row.map((k) => k.r.bottom));
          for (const k of row) {
            const d = k.r.bottom - bots.v;
            if (Math.abs(d) > T && Math.abs(d) <= 48 && bots.n >= 2 && k.s.alignSelf === "auto")
              add("align.grid-row", k.el, Math.abs(d), `grid item bottom is ${round(Math.abs(d))}px off its row (cards should end level)`);
          }
        }
        continue;
      }
      if (!isFlexRow || row.length < 3) continue;
      const ai = s.alignItems;
      const metric = ai === "center" ? (k) => k.r.top + k.r.height / 2
        : ai === "flex-end" || ai === "end" ? (k) => k.r.bottom
        : ai === "baseline" ? null : (k) => k.r.top;
      if (!metric) continue;
      const bareText = (el) => el.children.length === 0 && transparentBg(cs(el).backgroundColor) && parseFloat(cs(el).borderTopWidth) === 0;
      const eligible = row.filter((k) => k.s.alignSelf === "auto" && k.s.marginTop !== "auto" && k.s.marginBottom !== "auto"
        && !k.el.matches('input[type="checkbox"], input[type="radio"]') && !bareText(k.el) && k.r.width < c.getBoundingClientRect().width * 0.9);
      if (eligible.length < 3) continue;
      const m = majority(eligible.map(metric));
      if (m.n < 2) continue;
      for (const k of eligible) {
        const d = metric(k) - m.v;
        if (Math.abs(d) > T && Math.abs(d) <= 16)
          add("align.row", k.el, Math.abs(d), `row item${label(k.el)} is ${round(Math.abs(d))}px ${d > 0 ? "below" : "above"} its ${ai === "center" ? "centre line" : ai.includes("end") ? "bottom line" : "top line"} (${eligible.length} siblings)`);
      }
    }
  }

  // 4. shared edges ------------------------------------------------------------------------
  for (const c of all) {
    if (!visible(c)) continue;
    const s = cs(c);
    if (!["block", "flow-root"].includes(s.display) && !(s.display === "flex" && s.flexDirection.startsWith("column")) && s.display !== "grid") continue;
    const cr = c.getBoundingClientRect();
    const inner = cr.width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
    const kids = [...c.children].filter((k) => visible(k) && !["absolute", "fixed"].includes(cs(k).position) && !["inline", "contents"].includes(cs(k).display))
      .map((k) => ({ el: k, r: k.getBoundingClientRect() }))
      .filter((k) => k.r.width >= inner * 0.5 && k.r.width < inner + 2);
    if (kids.length < 3) continue;
    // one column only (grids with several columns are rows, not edges)
    if (visualRows(kids.map((k) => ({ ...k }))).some((rw) => rw.length > 1)) continue;
    for (const side of ["left", "right"]) {
      // a right edge is only visible on a boxed block (text runs ragged); left edges always show
      const set = side === "left" ? kids : kids.filter((k) => { const ks = cs(k.el); return !transparentBg(ks.backgroundColor) || parseFloat(ks.borderRightWidth) > 0; });
      if (set.length < 3) continue;
      const m = majority(set.map((k) => k.r[side]));
      if (m.n < 2) continue;
      for (const k of set) {
        const d = k.r[side] - m.v;
        if (Math.abs(d) >= 2 && Math.abs(d) <= 10)
          add("align.edge", k.el, Math.abs(d), `${side} edge is ${round(Math.abs(d))}px out of line with ${m.n} sibling block(s)`);
      }
    }
  }

  // 5. symmetric padding --------------------------------------------------------------------
  const transparent = (c) => !c || c === "transparent" || /rgba\([^)]*,\s*0\)$/.test(c);
  for (const el of all) {
    if (!visible(el)) continue;
    const s = cs(el);
    const boxed = !transparent(s.backgroundColor) || parseFloat(s.borderLeftWidth) > 0 || parseFloat(s.borderRightWidth) > 0 || (s.boxShadow && s.boxShadow !== "none");
    if (!boxed) continue;
    if (s.backgroundImage && s.backgroundImage !== "none") continue;           // chevron / icon painted in the padding
    const tag = el.tagName.toLowerCase();
    const pl = parseFloat(s.paddingLeft), pr = parseFloat(s.paddingRight);
    if (tag === "input" || tag === "textarea" || tag === "select") {
      const hasOverlay = [...(el.parentElement?.children || [])].some((k) => k !== el && ["absolute"].includes(cs(k).position));
      if (hasOverlay) continue;                                              // leading/trailing icon or button inside the field
    }
    const hasSideIcon = [...el.children].some((k) => isIcon(k) || ["absolute"].includes(cs(k).position));
    if (Math.abs(pl - pr) > 1 && !hasSideIcon)
      add("spacing.padding", el, Math.abs(pl - pr), `padding is asymmetric: left ${round(pl)}px vs right ${round(pr)}px`);
    if (isButtonLike(el) || /badge|chip|pill|tag/i.test(el.className?.baseVal ?? el.className ?? "")) {
      const pt = parseFloat(s.paddingTop), pb = parseFloat(s.paddingBottom);
      if (Math.abs(pt - pb) > 1) add("spacing.padding", el, Math.abs(pt - pb), `vertical padding is asymmetric: top ${round(pt)}px vs bottom ${round(pb)}px`);
    }
  }


  // 5b. centred content: labels in pills / badges / buttons / chips, glyphs in icon-only controls ---
  // Measured on the INK (cap height on the baseline, or x-height for all-lowercase), not the line box,
  // so a font whose metrics sit high is caught even when the padding is symmetric.
  const boxedEl = (s) => !transparent(s.backgroundColor) || parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderLeftWidth) > 0 || (s.boxShadow && s.boxShadow !== "none");
  const PILL = /badge|chip|pill|tag|count|bubble|avatar|dot/i;
  const centreSeen = new Map();
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (["input", "select", "textarea", "svg", "img", "html", "body"].includes(tag) || el.closest("svg")) continue;
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 12 || r.height > 72 || r.width > 480) continue;
    const s = cs(el);
    if (!boxedEl(s) || (s.transform && s.transform !== "none" && !/^matrix\(1, 0, 0, 1,/.test(s.transform))) continue;
    const cls = el.className?.baseVal ?? el.className ?? "";
    const round_ = parseFloat(s.borderTopLeftRadius) >= r.height / 2 - 1;
    if (!(isButtonLike(el) || PILL.test(cls) || round_)) continue;
    // own content only: text + icons not inside a nested boxed element (a pill inside a button is its own check)
    const ownerOf = (n) => { for (let p = n.nodeType === 1 ? n : n.parentElement; p && p !== el; p = p.parentElement) if (boxedEl(cs(p))) return p; return el; };
    const lines = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const txt = n.textContent; if (!txt.trim() || n.parentElement?.closest("svg") || ownerOf(n) !== el || !visible(n.parentElement)) continue;
      const a = txt.search(/\S/), b = txt.length - txt.trimEnd().length;
      const rg = document.createRange(); rg.setStart(n, a); rg.setEnd(n, txt.length - b);
      for (const rr of rg.getClientRects()) if (rr.width > 0) lines.push({ rr, pe: n.parentElement, txt: txt.trim() });
    }
    const ics = icons.filter((i) => el.contains(i) && ownerOf(i) === el && cs(i).position !== "absolute");
    if (!lines.length && ics.length !== 1) continue;
    if (lines.length && new Set(lines.map((l) => Math.round(l.rr.top))).size > 1) continue;   // wraps: not a one-line label
    let L = Infinity, R = -Infinity, Tp = Infinity, B = -Infinity;
    for (const l of lines) {
      const m = metrics(l.pe); const base = l.rr.top + m.ascent;
      const h = /[A-Z0-9]/.test(l.txt) ? m.cap : m.xh;
      L = Math.min(L, l.rr.left); R = Math.max(R, l.rr.right); Tp = Math.min(Tp, base - h); B = Math.max(B, base);
    }
    for (const i of ics) {
      const ir = i.getBoundingClientRect();
      L = Math.min(L, ir.left); R = Math.max(R, ir.right);
      if (!lines.length) { Tp = ir.top; B = ir.bottom; }            // with text, icon-vs-label is align.icon-label's job
    }
    if (!isFinite(L) || !isFinite(Tp)) continue;
    const inL = r.left + parseFloat(s.borderLeftWidth), inR = r.right - parseFloat(s.borderRightWidth);
    const inT = r.top + parseFloat(s.borderTopWidth), inB = r.bottom - parseFloat(s.borderBottomWidth);
    if (L < inL - 1 || R > inR + 1) continue;                          // content overflows: overlap / clipping, not centring
    const what = !lines.length ? "icon" : "label";
    const kind = !lines.length ? "icon button" : PILL.test(cls) || (round_ && !isButtonLike(el)) ? "pill" : "button";
    const slack = (inR - parseFloat(s.paddingRight)) - (inL + parseFloat(s.paddingLeft)) - (R - L);   // room inside the CONTENT box
    const centredH = s.textAlign === "center" || s.justifyContent === "center" || s.placeContent?.includes("center") || s.justifyItems === "center"
      || (!lines.length) || slack <= 2;
    const dx = ((L - inL) - (inR - R)) / 2, dy = ((Tp + B) / 2) - ((inT + inB) / 2);
    const key = (k, v) => `${k}|${tag}|${cls}|${Math.round(v)}`;
    const report = (k, v, msg) => { const kk = key(k, v); if (centreSeen.has(kk)) { centreSeen.get(kk).n++; return; } const f = { n: 1 }; centreSeen.set(kk, f); add("align.centre", el, Math.abs(v), msg); f.i = out.length - 1; };
    if (!centredH && slack > 4 && lines.length)
      report("h-intent", slack, `${what} is not centred in its ${kind}: ${round(slack)}px of slack all on one side (set justify-content / text-align: center)`);
    else if (centredH && Math.abs(dx) > T)
      report("h", dx, `${what}${label(el)} sits ${round(Math.abs(dx))}px ${dx < 0 ? "left" : "right"} of centre in its ${kind}`);
    if (Math.abs(dy) > T)
      report("v", dy, `${what}${label(el)} sits ${round(Math.abs(dy))}px ${dy < 0 ? "high" : "low"} in its ${kind} (${!lines.length ? "glyph box" : "cap-height"} centre vs box centre)` +
        (lines.length ? ` — trim the line box (text-box: trim-both cap alphabetic) or fix the face's ascent/descent-override, then keep padding symmetric` : ""));
  }
  for (const f of centreSeen.values()) if (f.n > 1 && out[f.i]) out[f.i].msg += ` (+${f.n - 1} more like it)`;

  // 6. one icon size per group ---------------------------------------------------------------
  const groups = new Map();
  for (const ic of icons.filter((i) => i.tagName.toLowerCase() === "svg" && !["absolute", "fixed"].includes(cs(i).position) && !["absolute", "fixed"].includes(cs(i.parentElement).position))) {
    const item = ic.parentElement?.closest("li, a, button, [role=tab], [role=menuitem], [role=button]") || ic.parentElement;
    const group = item?.parentElement;
    if (!group) continue;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(ic);
  }
  for (const [grp, list0] of groups) {
    // like items only (nav links with nav links), and the icon in the SAME slot of each item —
    // a product card's badge icon is not compared with its cart icon
    const slot = (item, ic) => { const p = []; for (let c = ic; c && c !== item; c = c.parentElement) p.push(`${c.tagName}:${[...c.parentElement.children].indexOf(c)}`); return p.join("<"); };
    const bySlot = new Map();
    for (const ic of list0) {
      const item = [...grp.children].find((k) => k.contains(ic));
      const key = `${item?.tagName || "?"}|${item ? slot(item, ic) : ""}`;
      if (!bySlot.has(key)) bySlot.set(key, []);
      bySlot.get(key).push(ic);
    }
    const list = [...bySlot.values()].sort((a, b) => b.length - a.length)[0] || [];
    if (list.length < 3) continue;
    const W = list.map((ic) => ic.getBoundingClientRect().width), H = list.map((ic) => ic.getBoundingClientRect().height);
    const mw = majority(W), mh = majority(H);
    list.forEach((ic, i) => {
      const d = Math.max(Math.abs(W[i] - mw.v), Math.abs(H[i] - mh.v));
      if (d > 1 && mw.n >= 2 && mh.n >= 2)
        add("align.icon-size", ic, d, `icon ${round(W[i])}×${round(H[i])}px differs from its group (${round(mw.v)}×${round(mh.v)}px, ${list.length} icons)`);
    });
  }

  // 7. fixed / sticky covering content --------------------------------------------------------
  const floaters = all.filter((el) => {
    const p = cs(el).position;
    if (p !== "fixed" && p !== "sticky") return false;
    if (!visible(el)) return false;
    if (el.closest('[role="dialog"], [aria-modal="true"], dialog')) return false;   // modals cover on purpose
    const r = el.getBoundingClientRect();
    if (!inViewport(r) || r.width * r.height >= innerWidth * innerHeight * 0.6) return false;
    // page top: only bars pinned to the top can hide content for good; page bottom: only bars at the bottom
    const mid = r.top + r.height / 2;
    return String(opts.phase).startsWith("bottom") ? mid > innerHeight / 2 : mid <= innerHeight / 2;
  });
  if (floaters.length) {
    let targets = all.filter((el) => el.matches("a, button, input, select, textarea, [role=button], h1, h2, h3, p, li, img, label") && visible(el) && !floaters.some((f) => f.contains(el)));
    targets = targets.filter((el) => !targets.some((o) => o !== el && el.contains(o)));   // report the innermost
    for (const el of targets) {
      const r = el.getBoundingClientRect();
      if (!inViewport(r)) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const pts = [[cx, cy], [r.left + 4, cy], [r.right - 4, cy], [cx, r.top + 4], [cx, r.bottom - 4]];   // ≥4px of cover counts
      for (const [x, y] of pts) {
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        const f = hit && floaters.find((fl) => fl.contains(hit) && !fl.contains(el) && !el.contains(fl));
        if (f) {
          const fr = f.getBoundingClientRect();
          const overlap = Math.min(r.bottom, fr.bottom) - Math.max(r.top, fr.top);
          add("overlap.fixed", el, overlap, `${cs(f).position} ${sel(f)} covers ${el.tagName.toLowerCase()}${label(el)} by ${round(overlap)}px at page ${String(opts.phase).replace("-all", "")}`);
          break;
        }
      }
    }
  }

  // 8. brand: rendered colours + fonts, banned values ------------------------------------------
  const probe = document.createElement("span");
  document.body.appendChild(probe);
  const toRgb = (c) => { probe.style.color = ""; probe.style.color = c; const v = cs(probe).color; return v; };
  const parse = (v) => { const m = v.match(/rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?/); if (!m) return null; let a = m[4] == null ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]); return [ +m[1], +m[2], +m[3], a ]; };
  const palette = (opts.palette || []).map((c) => parse(toRgb(c))).filter(Boolean);
  const bannedColors = (opts.banned || []).filter((b) => b.kind === "color").map((b) => ({ ...b, rgb: parse(toRgb(b.value)) })).filter((b) => b.rgb);
  probe.remove();
  const near = (a, b) => Math.abs(a[0] - b[0]) <= 2 && Math.abs(a[1] - b[1]) <= 2 && Math.abs(a[2] - b[2]) <= 2;
  const hex = (c) => "#" + c.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, "0")).join("").toUpperCase();
  const offPalette = new Map();
  const bannedHits = new Map();
  if (palette.length || bannedColors.length) {
    for (const el of all) {
      if (!visible(el) || el.closest("svg image, canvas, video, iframe")) continue;
      const s = cs(el);
      const props = [["color", s.color, (el.textContent || "").trim().length > 0 && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())],
        ["background", s.backgroundColor, true],
        ["border", s.borderTopColor, parseFloat(s.borderTopWidth) > 0], ["border", s.borderBottomColor, parseFloat(s.borderBottomWidth) > 0],
        ["border", s.borderLeftColor, parseFloat(s.borderLeftWidth) > 0], ["border", s.borderRightColor, parseFloat(s.borderRightWidth) > 0]];
      if (/^(path|circle|rect|ellipse|line|polyline|polygon|text|use)$/i.test(el.tagName) && el.closest("svg")) { props.push(["fill", s.fill, s.fill !== "none"], ["stroke", s.stroke, s.stroke !== "none" && parseFloat(s.strokeWidth) > 0]); }
      if (el.tagName.toLowerCase() === "svg" || el.closest("svg")) props.splice(0, 1);   // svg "color" is only a currentColor carrier
      for (const [prop, v, used] of props) {
        if (!used || !v || v === "none") continue;
        const c = parse(v);
        if (!c || c[3] === 0) continue;
        const bn = bannedColors.find((b) => near(b.rgb, c));
        if (bn) { const k = hex(c); if (!bannedHits.has(k)) bannedHits.set(k, { el, n: 0, prop, note: bn.note }); bannedHits.get(k).n++; }
        if (palette.length && !palette.some((p) => near(p, c))) {
          const k = hex(c);
          if (intentional(el)) continue;
          if (!offPalette.has(k)) offPalette.set(k, { el, n: 0, prop });
          offPalette.get(k).n++;
        }
      }
    }
  }
  for (const [k, v] of offPalette) add("brand.colour", v.el, null, `rendered ${v.prop} ${k} is not in DESIGN.md's palette (${v.n} element${v.n > 1 ? "s" : ""})`);
  for (const [k, v] of bannedHits) add("brand.banned", v.el, null, `banned colour ${k} rendered as ${v.prop}${v.note ? ` (${v.note})` : ""} on ${v.n} element(s)`);

  const allowedFonts = (opts.fonts || []).map((f) => f.toLowerCase());
  const GENERIC = new Set(["serif", "sans-serif", "monospace", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "cursive", "fantasy", "-apple-system", "blinkmacsystemfont", "inherit"]);
  const bannedFonts = (opts.banned || []).filter((b) => b.kind === "font").map((b) => ({ ...b, v: b.value.toLowerCase() }));
  const fontSeen = new Map();
  const textEls = all.filter((el) => visible(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  for (const el of textEls) {
    const fam = cs(el).fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "");
    const key = fam.toLowerCase();
    if (!fontSeen.has(key)) fontSeen.set(key, { fam, el, n: 0 });
    fontSeen.get(key).n++;
  }
  for (const [key, v] of fontSeen) {
    const b = bannedFonts.find((bf) => key.includes(bf.v));
    if (b) add("brand.banned", v.el, null, `banned font "${v.fam}" renders on ${v.n} element(s)${b.note ? ` (${b.note})` : ""}`);
    if (allowedFonts.length && !GENERIC.has(key) && !allowedFonts.some((f) => key === f || key.startsWith(f + " ") || f.startsWith(key)))
      add("brand.font", v.el, null, `font "${v.fam}" is not in DESIGN.md's typography (${v.n} element${v.n > 1 ? "s" : ""})`);
  }
  const bannedText = (opts.banned || []).filter((b) => b.kind === "text" || b.kind === "re");
  if (bannedText.length) {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hits = new Map();
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const pe = n.parentElement;
      if (!pe || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(pe.tagName) || !visible(pe)) continue;
      for (const b of bannedText) {
        const ok = b.kind === "text" ? n.textContent.includes(b.value) : new RegExp(b.value, "i").test(n.textContent);
        if (ok && !intentional(pe)) { const k = b.value; if (!hits.has(k)) hits.set(k, { el: pe, n: 0, b, sample: n.textContent.trim().slice(0, 50) }); hits.get(k).n++; }
      }
    }
    for (const [k, v] of hits) add("brand.banned", v.el, null, `banned text "${k}" in visible copy on ${v.n} node(s), e.g. "${v.sample}"${v.b.note ? ` (${v.b.note})` : ""}`);
  }

  // 9. type rendering (crisp, clean text) -------------------------------------------------------
  const bs = cs(document.body);
  if (bs.webkitFontSmoothing && bs.webkitFontSmoothing !== "antialiased")
    add("type.smoothing", document.body, null, `body -webkit-font-smoothing is "${bs.webkitFontSmoothing}": set antialiased (+ -moz-osx-font-smoothing: grayscale) for thin, clean strokes`);
  const tsa = cs(document.documentElement).webkitTextSizeAdjust || bs.webkitTextSizeAdjust;
  if (tsa && tsa !== "100%" && tsa !== "none")
    add("type.size-adjust", document.documentElement, null, `text-size-adjust is "${tsa}": pin 100% or iOS inflates text on rotate`);
  // faux bold / italic: a web font used at a weight/style none of its faces cover
  const faces = [...document.fonts];
  const famFaces = new Map();
  for (const f of faces) {
    const k = f.family.replace(/^["']|["']$/g, "").toLowerCase();
    if (!famFaces.has(k)) famFaces.set(k, []);
    famFaces.get(k).push(f);
  }
  const synth = new Map();
  for (const el of textEls) {
    const s = cs(el);
    const fam = s.fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "").toLowerCase();
    const list = famFaces.get(fam);
    if (!list) continue;
    const w = parseInt(s.fontWeight, 10);
    const italic = s.fontStyle !== "normal";
    const covers = list.some((f) => {
      const [lo, hi] = String(f.weight).split(/\s+/).map((x) => (x === "normal" ? 400 : x === "bold" ? 700 : parseInt(x, 10)));
      const okW = w >= lo && w <= (hi || lo);
      const okS = italic ? f.style !== "normal" : f.style === "normal";
      return okW && okS;
    });
    const k = `${fam}|${w}|${italic}`;
    if (!covers && !synth.has(k) && s.fontSynthesis !== "none") synth.set(k, el);
    if (!covers && !synth.has(k + "|none") && s.fontSynthesis === "none") synth.set(k + "|none", el);
  }
  for (const [k, el] of synth) {
    const [fam, w, it, none] = k.split("|");
    add("type.synthesis", el, null, none
      ? `"${fam}" ${w}${it === "true" ? " italic" : ""} has no face, and font-synthesis is off: text falls back to the nearest weight — load that master or change the weight`
      : `"${fam}" ${w}${it === "true" ? " italic" : ""} has no face: the browser fakes it (smeared faux ${it === "true" ? "italic" : "bold"}). Load the master or set font-synthesis: none`);
  }
  for (const f of faces) if (f.status === "error") add("type.load", null, null, `font face "${f.family}" ${f.weight} failed to load: text renders in the fallback`);
  // inputs under 16px on phones → iOS zooms the page on focus
  if (opts.vw < 768) for (const el of all.filter((e) => e.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]), textarea, select') && visible(e))) {
    const fs = parseFloat(cs(el).fontSize);
    if (fs < 16) add("type.input-zoom", el, 16 - fs, `field font-size ${fs}px < 16px: iOS Safari zooms the page on focus`);
  }
  // display text must not be tracked out (Apple: tighten as it grows)
  for (const el of textEls) {
    const s = cs(el);
    const fs = parseFloat(s.fontSize), ls = parseFloat(s.letterSpacing);
    if (fs >= 32 && ls > 0.5 && s.textTransform !== "uppercase") add("type.tracking", el, ls, `display text at ${fs}px has +${round(ls)}px tracking: large type wants negative tracking`);
  }
  // text-rendering overrides on running text: kerning + ligatures are already on (auto); optimizeLegibility
  // / geometricPrecision on body copy only cost layout time and change hinting per platform
  for (const el of [document.body, ...document.querySelectorAll("main p, article p")].slice(0, 40)) {
    const tr = cs(el).textRendering;
    if (tr === "optimizeLegibility" || tr === "geometricPrecision") { add("type.text-rendering", el, null, `text-rendering: ${tr} on running text — leave it auto (kerning and ligatures are already on); reserve it for display headings if at all`); break; }
  }
  // pure black ink on a light ground: grayscale-antialiased edges read harsh; a softened ink reads cleaner
  {
    const c = parse(bs.color || ""), bg = parse(cs(document.documentElement).backgroundColor) || parse(bs.backgroundColor);
    const lightBg = bg && bg[3] > 0 && bg[0] + bg[1] + bg[2] > 600;
    if (c && c[0] === 0 && c[1] === 0 && c[2] === 0 && (lightBg || !bg || bg[3] === 0))
      add("type.ink", document.body, null, "body text is pure #000000: soften the ink (a near-black tinted toward the brand, e.g. #1F2426–#2A2F30) so antialiased edges stay soft");
  }
  // interpolated weights: a variable face used between masters renders a weight nobody drew
  const oddW = textEls.find((el) => { const w = parseInt(cs(el).fontWeight, 10); return w % 100 !== 0; });
  if (oddW) add("type.weight", oddW, null, `font-weight ${cs(oddW).fontWeight} is between masters: use 400/500/600/700 so the face renders a drawn weight`);
  // metric-matched fallback: without one, text reflows (and flashes a different width) when the web font lands
  const faceByFam = new Map(faces.map((f) => [f.family.replace(/^["']|["']$/g, "").toLowerCase(), f]));
  const noFallback = new Map();
  for (const el of textEls) {
    const stack = cs(el).fontFamily.split(",").map((x) => x.trim().replace(/^["']|["']$/g, "").toLowerCase());
    if (!famFaces.has(stack[0])) continue;                          // not a web font
    const fb = stack.slice(1).find((x) => faceByFam.has(x) && (faceByFam.get(x).sizeAdjust !== "100%" || faceByFam.get(x).ascentOverride !== "normal"));
    if (!fb && !noFallback.has(stack[0])) noFallback.set(stack[0], el);
  }
  for (const [fam, el] of noFallback) {
    const stack = cs(el).fontFamily.toLowerCase();
    const base = /monospace/.test(stack) ? "Courier New" : /(^|,)\s*serif\b/.test(stack) ? "Times New Roman" : "Arial";
    add("type.fallback", el, null, `"${fam}" has no metric-matched fallback in its stack: add an @font-face on local("${base}") with size-adjust / ascent-override / descent-override (from @capsizecss/metrics or Fontaine) so text does not reflow when the font loads`);
  }
  const preloads = document.querySelectorAll('link[rel="preload"][as="font"]').length;
  if (preloads > 3) add("type.preload", document.head, null, `${preloads} font preloads: preload only the primary text face (and the above-the-fold control face); the rest compete with the LCP image`);
  // figures in table columns align only when tabular
  for (const t of document.querySelectorAll("table")) {
    if (!visible(t)) continue;
    const cells = [...t.querySelectorAll("td")].filter((td) => /\d/.test(td.textContent) && visible(td));
    if (cells.length < 3) continue;
    const bad = cells.filter((td) => !/tabular-nums/.test(cs(td).fontVariantNumeric));
    if (bad.length) add("type.tabular", bad[0], null, `${bad.length} numeric table cell(s) use proportional figures: set font-variant-numeric: tabular-nums so columns align`);
  }

  // ---------- whitespace: no voids — fill them or reorganise ----------
  // Ink = what a reader sees: text, media, controls, background images. Empty coloured panels are
  // still empty. Layout presence only (opacity ignored) so reveal-on-scroll content still counts.
  if (opts.phase === "top") {
    const vw = innerWidth, vh = innerHeight, sy = scrollY, sx = scrollX;
    const ws = opts.whitespace || {};
    const MAXGAP = ws.maxGap ?? (vw < 600 ? 160 : vw < 1100 ? 200 : 240);
    const fixedCache = new Map();
    const pinned = (el) => {
      if (!el || el === document.body) return false;
      if (fixedCache.has(el)) return fixedCache.get(el);
      const p = cs(el).position; const v = p === "fixed" || p === "sticky" || pinned(el.parentElement);
      fixedCache.set(el, v); return v;
    };
    const laid = (el) => { const s = cs(el); return s.display !== "none" && s.visibility !== "hidden"; };
    const ink = [], blockInk = [];   // blockInk: the LAYOUT footprint (a paragraph's box, not its ragged lines)
    const toDoc = (r, el) => ({ l: r.left + sx, r: r.right + sx, t: r.top + sy, b: r.bottom + sy, el });
    const pushR = (r, el) => { if (r.width >= 2 && r.height >= 2) ink.push(toDoc(r, el)); };
    const blockSeen = new Set();
    const blockOf = (el) => { for (let p = el; p && p !== document.body; p = p.parentElement) if (!cs(p).display.startsWith("inline") && cs(p).display !== "contents") return p; return document.body; };
    const pushBlock = (el) => { if (blockSeen.has(el)) return; blockSeen.add(el); const r = el.getBoundingClientRect(); if (r.width >= 2 && r.height >= 2) blockInk.push(toDoc(r, el)); };
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let tn = 0;
    for (let n = tw.nextNode(); n && tn < 6000; n = tw.nextNode()) {
      const pe = n.parentElement;
      if (!n.textContent.trim() || !pe || pe.closest("script,style,noscript,template,[aria-hidden=true] .sr-only,.sr-only,[hidden]") || !laid(pe) || pinned(pe)) continue;
      tn++;
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const rr of rg.getClientRects()) pushR(rr, pe);
      pushBlock(blockOf(pe));
    }
    for (const el of all) {
      const tag = el.tagName.toLowerCase();
      const media = ["img", "video", "canvas", "iframe", "picture", "input", "select", "textarea", "button", "hr"].includes(tag) || (tag === "svg" && !el.parentElement?.closest("svg")) || el.getAttribute("role") === "img";
      const bi = cs(el).backgroundImage, br = el.getBoundingClientRect();
      const bgImg = !media && (/url\(/.test(bi) || (/gradient\(/.test(bi) && br.width < vw * 0.9 && br.height < vh));   // photos, and gradient ART (not full-bleed section washes)
      if (!(media || bgImg) || !laid(el) || pinned(el)) continue;
      let rr = el.getBoundingClientRect();
      if (tag === "img" && rr.width < 2 && rr.height >= 2 && el.parentElement) rr = el.parentElement.getBoundingClientRect();   // not decoded yet: it will fill its frame
      pushR(rr, el); pushBlock(el);
    }
    for (const el of all) if (laid(el) && !pinned(el) && boxedEl(cs(el))) { const r = el.getBoundingClientRect(); if (r.height < vh && r.width < vw * 0.98) pushBlock(el); }   // panels & cards occupy their space
    const docH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    // smallest laid-out element that contains a doc-space rect (names the finding)
    const holder = (x0, y0, x1, y1) => {
      let best = null, area = Infinity;
      for (const el of all) {
        const r = el.getBoundingClientRect(); const L = r.left + sx, T_ = r.top + sy;
        if (L <= x0 + 1 && T_ <= y0 + 1 && r.right + sx >= x1 - 1 && r.bottom + sy >= y1 - 1 && r.width * r.height < area && laid(el) && !pinned(el)) { best = el; area = r.width * r.height; }
      }
      return best || document.body;
    };
    if (ink.length) {
      // 1. vertical voids between content
      const iv = ink.map((k) => [k.t, k.b]).sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const [t, b] of iv) { const m = merged[merged.length - 1]; if (m && t <= m[1]) m[1] = Math.max(m[1], b); else merged.push([t, b]); }
      for (let i = 1; i < merged.length; i++) {
        const gap = merged[i][0] - merged[i - 1][1];
        if (gap > MAXGAP) add("space.gap", holder(0, merged[i - 1][1], 1, merged[i][0]), gap,
          `${round(gap)}px of empty vertical space at y=${Math.round(merged[i - 1][1])} (limit ${MAXGAP}px at ${vw}px) — tighten the section padding, or fill it with content that earns the space`);
      }
      const last = merged[merged.length - 1][1];
      if (docH > vh + 2 && docH - last > MAXGAP) add("space.tail", holder(0, last, 1, docH), docH - last, `${round(docH - last)}px of blank page after the last content — remove the trailing padding/min-height`);
      if (docH <= vh + 2 && last < vh - MAXGAP) add("space.short", document.body, vh - last,
        `the page ends at y=${Math.round(last)} and leaves ${round(vh - last)}px of the screen empty — pin the footer (min-height: 100dvh flex column, footer margin-top: auto) or give the page real content`);

      // 2. content hugging one side (tablet/desktop): the column is the page's own content width
      if (vw >= 768) {
        const lefts = blockInk.map((k) => k.l).sort((a, b) => a - b), rights = blockInk.map((k) => k.r).sort((a, b) => a - b);
        const colL = lefts[Math.floor(lefts.length * 0.05)], colR = rights[Math.floor(rights.length * 0.95)], colW = colR - colL;
        if (colW > 480) {
          const SLICE = 80, runs = [];
          let run = null;
          for (let y = merged[0][0]; y < last; y += SLICE) {
            const inS = blockInk.filter((k) => k.b > y && k.t < y + SLICE && k.r - k.l < colW * 0.98);
            const full = blockInk.some((k) => k.b > y && k.t < y + SLICE && k.r - k.l >= colW * 0.98);
            let side = null, gapPx = 0;
            if (inS.length && !full) {
              const l = Math.min(...inS.map((k) => k.l)), r = Math.max(...inS.map((k) => k.r));
              const lg = l - colL, rg = colR - r;
              if (rg >= colW * 0.35 && lg <= colW * 0.1) { side = "right"; gapPx = rg; }
              else if (lg >= colW * 0.35 && rg <= colW * 0.1) { side = "left"; gapPx = lg; }
            }
            if (side && run && run.side === side) { run.y1 = y + SLICE; run.gap = Math.min(run.gap, gapPx); }
            else { if (run) runs.push(run); run = side ? { side, y0: y, y1: y + SLICE, gap: gapPx } : null; }
          }
          if (run) runs.push(run);
          for (const rn of runs) if (rn.y1 - rn.y0 >= 240) {
            const x0 = rn.side === "right" ? colR - rn.gap : colL, x1 = rn.side === "right" ? colR : colL + rn.gap;
            add("space.side", holder(x0, rn.y0, x1, Math.min(rn.y1, last)), rn.gap,
              `content hugs the ${rn.side === "right" ? "left" : "right"}: a ${round(rn.gap)}×${Math.round(rn.y1 - rn.y0)}px block on the ${rn.side} is empty at y=${Math.round(rn.y0)} — put the related image/aside/CTA beside it, widen it into a grid, or centre the column`);
          }
        }
      }
    }

    // 3. grids / card wraps with holes in the last row
    for (const el of all) {
      const s = cs(el);
      const isGrid = s.display.includes("grid"), isWrap = s.display.includes("flex") && s.flexWrap === "wrap";
      if (!(isGrid || isWrap) || !laid(el) || pinned(el) || intentional(el)) continue;
      const kids = [...el.children].filter((k) => { const r = k.getBoundingClientRect(); return r.width > 1 && r.height > 1 && laid(k) && cs(k).position !== "absolute"; });
      if (kids.length < 3) continue;
      const rects = kids.map((k) => k.getBoundingClientRect());
      if (isWrap && Math.max(...rects.map((r) => r.height)) < 120) continue;   // chips / tags wrap raggedly by nature
      const rows = new Map();
      for (const r of rects) { const k = [...rows.keys()].find((t) => Math.abs(t - r.top) < 4) ?? r.top; rows.set(k, (rows.get(k) || []).concat([r])); }
      if (rows.size < 2) continue;
      const cols = Math.max(...[...rows.values()].map((v) => v.length));
      const lastRow = [...rows.entries()].sort((a, b) => a[0] - b[0]).pop()[1];
      if (cols < 2 || lastRow.length >= cols) continue;
      const box = el.getBoundingClientRect();
      const used = Math.max(...lastRow.map((r) => r.right)) - Math.min(...lastRow.map((r) => r.left));
      if (used >= box.width * 0.85) continue;                               // the last row stretches to fill
      add("space.orphans", el, box.width - used, `last row has ${lastRow.length} of ${cols} — ${cols - lastRow.length} empty cell(s): make the count fit the columns, let the last item(s) span, or reflow (auto-fit / a featured item)`);
    }

    // 4. boxed cards with a big empty inside (stretched to a taller neighbour, or fixed heights)
    for (const el of all) {
      if (!laid(el) || pinned(el)) continue;
      const s = cs(el); const r = el.getBoundingClientRect();
      if (r.height < 200 || r.width > vw * 0.9 || r.width < 120 || !boxedEl(s)) continue;
      const pt = parseFloat(s.paddingTop), pb = parseFloat(s.paddingBottom);
      const T0 = r.top + sy + pt, B0 = r.bottom + sy - pb;
      const own = ink.filter((k) => el.contains(k.el) && k.t >= T0 - 2 && k.b <= B0 + 2).map((k) => [k.t, k.b]).sort((a, b) => a[0] - b[0]);
      if (!own.length) continue;
      let gap = own[0][0] - T0, at = T0, end = own[0][1];
      for (const [t, b] of own) { if (t - end > gap) { gap = t - end; at = end; } end = Math.max(end, b); }
      if (B0 - end > gap) { gap = B0 - end; at = end; }
      if (gap >= Math.max(120, (B0 - T0) * 0.4)) add("space.card", el, gap, `${round(gap)}px of empty space inside this card at y=${Math.round(at)} — balance the content across cards, clamp the long one, or stop stretching it`);
    }
  }
  return out;
}
