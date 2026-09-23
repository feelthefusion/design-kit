## Design Kit notes

- On Hermes, fetch the rules with `web_extract` (or `curl -fsSL`) instead of WebFetch. Fetch them fresh every run; never cache or paste them into the repo.
- Review against the repo's `docs/DESIGN.md` too: a value that meets the guidelines but is not a DESIGN.md token is still a finding (the gate's `brand.token` check).
- Fix what you report, then re-run `design-gate` (Design Kit).
