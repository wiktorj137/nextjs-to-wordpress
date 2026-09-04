# Roadmap

The goal: a tool that runs the migration semi-automatically, leaving humans only the
design decisions.

## Where we are

**Fully automated**

- moving the markup and detecting shared templates
- fonts with fallback metrics
- client-only components
- working out which texts should be fields
- swapping text for fields and repetitions for loops
- importing content, menus and the client role
- proving equivalence (visual + content + performance)

**Still manual — and rightly so**

- **Field names and types.** The tool knows text #13 differs. It does not know whether
  that is an "intro" or a "short description", nor whether it should be a text field or
  an editor. That is a design decision and should not be generated.
- **The content model.** What is a post type versus a single page.
- **The editability boundary.** What the client may change and what stays locked.

**Manual, but automatable**

- field definitions (derivable from the field map)
- post type registration (already in the config)
- JSON-LD (reproducible from the original — the structure is in the export)
- rewrite rules

## Next steps

These are also the best places to contribute. See [CONTRIBUTING.md](../CONTRIBUTING.md).

1. **Field definition generator** from `mapaPol` — currently hand-written PHP, while
   the map already holds nearly everything needed.
2. **Reproduce JSON-LD from the export.** The structure sits in the static HTML;
   today it is transcribed into PHP by hand, which is the most tedious step after fields.
3. **A config wizard** — instead of filling in JSON by hand: show detected routes,
   propose templates, ask for field names.
4. **A second migration.** The tools carried one project end to end. Only a second one
   will show what is genuinely general and what merely looks it.
5. **Other sources** — Astro, Gatsby, plain HTML. The method ("slice the generated
   HTML") is not specific to Next.js.
6. **Config validation.** Right now a typo in `migration.config.json` surfaces as a
   stack trace deep inside a tool. A schema check at load time is a small,
   self-contained first contribution.

## Deliberate non-goals

- **Do not auto-generate field names.** The client sees them in the admin panel.
  `field_13` is a worse experience than ten minutes of human work.
- **Do not try to replicate React animations one to one.** The export cannot
  distinguish mount animations from scroll animations. Measure the behaviour on the
  live site and reproduce it with a rule.
- **Do not loosen test thresholds to get green.** That is where distrust of your own
  report begins.
