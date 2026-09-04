# Contributing

This project came out of one real migration. It becomes genuinely useful once it has
survived several — which is where you come in.

## The most valuable contribution

**Run it on your own site and tell us what broke.**

You do not need to fix anything. A precise bug report is worth as much as a patch here,
because the tools have only been exercised against a single project so far, and every
new site exposes assumptions we did not know we were making.

Use the [pitfall report](../../issues/new?template=pitfall.md) template. What helps most:

- what the original site did (framework version, animation library, CSS approach)
- what the tool produced versus what you expected
- whether a test caught it, or you found it by hand — **if the tests missed it,
  that is the more interesting half of the report**

## Good first issues

Self-contained tasks that do not require understanding the whole pipeline:

| Task | Why it is contained |
|---|---|
| **Add a Docker Compose setup for local WordPress** | Self-contained; unblocks everyone else's first run |
| **Validate `migration.config.json` on load** | Clear errors beat a stack trace 40 lines later |
| **Add a `--dry-run` flag to `wire-fields.mjs`** | Print what would change without writing |
| **Support `<ol>` and nested lists in the WYSIWYG typography** | One CSS block, plus a test page |
| **Detect unused dependencies in the source project** | Small standalone script for the audit step |
| **Generate ACF/SCF field definitions from the field map** | Larger, but the map already holds the data — see [ROADMAP](docs/ROADMAP.md) |

If one of these looks interesting, comment on the issue (or open one) before starting,
so two people don't do the same work.

## Adding a pitfall

[`docs/PITFALLS.md`](docs/PITFALLS.md) is the highest-value file in this repository.
If you hit something new, add an entry with:

1. **Symptom** — what you actually observed, including "nothing visible" if that is
   the case, because the invisible ones are the dangerous ones
2. **Cause** — the mechanism, not just the workaround
3. **Fix** — and, if relevant, how to detect it automatically

Entries are ordered roughly by how hard they are to notice.

## Development setup

```bash
cd tools && npm install
cd ../tests && npm install && npx playwright install chromium
cp migration.config.example.json migration.config.json
```

You will also need a WordPress instance. Docker is the simplest route; there is no
committed compose file yet — **adding one is itself a welcome contribution.**

## Code conventions

- **Comments explain *why*, not *what*.** Most comments in this codebase exist because
  something surprising happened; keep that habit.
- **No new dependencies without a reason.** The toolkit deliberately runs on Node,
  Playwright and WP-CLI.
- **Anything project-specific goes into the config**, never into a tool.
- **Never loosen a test threshold to make things pass.** Add an approved deviation with
  a written reason instead — see [TESTING.md](docs/TESTING.md).

## Pull requests

- one topic per PR
- if it changes tool behaviour, say how you verified it
- if it fixes a pitfall, add or update the entry in `PITFALLS.md`

No CLA, no formatting bikeshed. MIT licensed.
