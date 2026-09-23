# Design Kit

Design direction, rendered review and a **design gate that blocks "done"**, for every UI you ship: storefronts, checkout, admin panels, dashboards and mobile web. It plugs into the [Skill Starter Kit](https://github.com/feelthefusion/skill-starter-kit)'s `verify.sh` and Stop hook, the same way the Security Kit does. It reads the [Marketing Kit](https://github.com/feelthefusion/marketing-kit)'s `.agents/brand-context.md` when present. It depends on neither kit and duplicates neither kit's skills.

```bash
curl -fsSL https://raw.githubusercontent.com/feelthefusion/design-kit/main/install/bootstrap.sh | bash
cd your-web-app && design-init
```

It works with Claude Code and Hermes: both get the same skills, the same gate and the same session-start refresh.

## What's in it

| stage | skill | source (fetched live at HEAD, overlays re-applied, nothing vendored) |
|---|---|---|
| Direction | `design-direction` → `docs/DESIGN.md` in Google's design-md format: colours, type, spacing, radius, motion, icons, voice | kit + `design-md` (NousResearch/hermes-agent; built into Hermes) |
| Build | Taste builds from DESIGN.md (pointed to, not copied) | Skill Starter Kit |
| Code review | `web-design-guidelines`: Vercel's rules, fetched fresh on every run | vercel-labs/agent-skills |
| Rendered review | `frontend-visual-qa`, with an overlay that fixes and re-runs instead of only auditing | daymade/claude-code-skills |
| Polish / critique | `impeccable` (critique, audit, polish, typeset, layout…) | pbakaus/impeccable |
| Motion + materials | `apple-design` | emilkowalski/skills |
| Type rendering | `type-rendering`: crisp, smooth, antialiased text (the helix recipe) | kit |
| Mobile speed | `core-web-vitals` only | addyosmani/web-quality-skills |
| Gate | `design-gate` (in `verify.sh`) | kit |

## The gate

`design-gate` runs at 375, 768 and 1440px. The 375 run emulates a phone (touch, coarse pointer). It is on automatically for web apps, and its failures block "done".

- **Layout:** frontend-visual-qa sweep with `--fail-on-warning`.
- **Behaviour:** dead buttons (click → no navigation, DOM change, request, dialog or focus), buttons that throw, fixed/sticky bars covering content at page top or bottom.
- **Alignment:** icon vs label optical centre (>1.5px), row lines, equal heights, grid rows, shared edges, symmetric padding, icon sizes within a group.
- **Brand:** code literals that aren't DESIGN.md tokens, rendered colours and fonts off the palette, banned values from `.agents/design-banned.txt`.
- **Type:** font smoothing, text-size-adjust, faux bold/italic, failed loads, missing metric-matched fallbacks, preload count, interpolated weights, pure-black ink, display tracking, tabular figures, iOS input zoom.
- **Quality:** impeccable's deterministic detectors (contrast, cramped padding, heading order…). Its taste opinions are shown as notes and don't block.

Every finding comes with a selector and a px offset. A clean run is stamped, so the next run is skipped until a UI file changes. It is safe on a live dev server: the browser aborts every POST/PUT/PATCH/DELETE and logout request. If it can't run (no server, no browser), it prints the reason visibly and doesn't fail.

## Always latest

Every install and every update pulls the newest of everything. That covers the kit itself, each upstream skill at its repo's HEAD (with overlays re-applied), the gate runtime, and the links in `~/.claude/skills` and `~/.hermes/skills/design`. If you already have an older copy of a kit skill, whether installed by hand, from a hub, or inside a repo's `.claude/skills`, the kit moves it to `~/.config/design-kit/replaced/` and links the live one in its place. It never deletes a copy. Copies committed inside a repo are only reported, because they're your files.

Updates run on their own, the same way the Skill Starter Kit's do:

| trigger | what runs |
|---|---|
| session start (Claude Code `SessionStart`, Hermes `on_session_start`) | `design-update --if-stale 1 --background` |
| every hour (launchd `com.design-kit.update`; a systemd timer or cron on Linux) | `design-update --if-stale 1` |
| push to this repo (`design-webhook enable`: Hermes webhook route, shares the Starter Kit tunnel) | `design-update --force` |

Each run also refreshes the kit-owned blocks (the `verify.sh` step and the AGENTS/CLAUDE block) in every repo you ran `design-init` in. It never touches anything else in those repos. The log is at `~/.config/design-kit/update.log`.

## Commands

| command | does |
|---|---|
| `design-init` | wire this repo: config, DESIGN.md draft (only if none), banned values, `verify.sh` step, AGENTS/CLAUDE block |
| `design-gate [--only type,align] [--routes /,/shop] [--force]` | run the gate |
| `design-tokens` | print DESIGN.md front matter drafted from the tokens the code already defines |
| `design-update [--if-stale H] [--background] [--force]` | update everything now (see Always latest) |
| `design-webhook enable\|status\|disable` | push-triggered updates through the Hermes gateway |
| `design-doctor` | check install + repo wiring |

The gate runtime (Playwright, impeccable, yaml) lives in `~/.local/share/design-kit/runtime`. Package versions are picked at least 7 days after release (`DK_COOLDOWN_DAYS`).

Tests: `bash tests/run.sh` checks that the gate catches every seeded defect, passes a clean page, and that design-init is idempotent and never overwrites your files.

Unlicense. Upstream skills keep their own licenses and are fetched, never redistributed.
