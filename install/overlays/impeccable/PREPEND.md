> **Design Kit overlay: who owns what.**
> - **DESIGN.md** is owned by **design-direction** and lives at `docs/DESIGN.md` (or the repo's existing `DESIGN.md`). `document` / `extract` may *propose* token changes; merge them there, keeping Google design-md format.
> - **PRODUCT.md:** if Marketing Kit context exists (`.agents/product-marketing.md`, `.agents/brand-context.md`), `init` builds PRODUCT.md from it instead of re-interviewing, and never contradicts it.
> - **New surfaces / redesigns:** the look is built by **Taste** (`design-taste-frontend`, Skill Starter Kit) from DESIGN.md. Use impeccable's `shape` for the brief and the refinement commands (`critique`, `audit`, `polish`, `typeset`, `layout`, `colorize`, `animate`, `harden`, `adapt`, `clarify`, `distill`) afterwards.
> - **Hooks:** do not install impeccable's own hook. The kit's `design-gate` already runs `impeccable detect` at 375/768/1440 inside `verify.sh`, so a second hook would double the work.
> - A font or colour that *is* a DESIGN.md token is a brand decision; the gate does not block it as "overused".
> - Fix what you find and re-run until `design-gate` is clean.
