# The method, step by step

## 0. Audit first

Check whether the site suits this approach:

- **How many pages share a template?** Pages with identical structure that differ only
  in content become post types in WordPress — that is the main win.
- **Is there a backend?** Forms, APIs and auth change the picture. A purely
  presentational site is the easiest case.
- **Where does content come from?** If it is hardcoded in files, good: all the
  "dynamic" behaviour is content you are about to move into fields.
- **What animations are there?** Simple fade-ins take ~20 lines to reproduce.
  Complex GSAP timelines port over as vanilla JS unchanged.
- **Unused dependencies.** Grep the imports. The reference project had four heavy
  libraries in `package.json` that were never used anywhere.

## 1. Static export

```bash
cd source-nextjs && npm run build
```

The resulting HTML is **the source of truth for appearance** — not the TSX,
because HTML is what the browser actually renders.

## 2. Baseline snapshot

Run the old site in production mode and capture screenshots **before** you change
anything:

```bash
make baseline
```

Without a baseline there is no way to prove equivalence. This is step one, not the last.

## 3. Templates

```bash
make theme
```

`html-to-php.mjs` strips the Next runtime (hydration scripts, Suspense markers,
React attributes), replaces hashed font classes, and detects structure:

- is `<nav>` identical on every page → one `header.php`
- does `<footer>` have variants → one footer driven by a variable
- which pages share a template → post types

**Pick the richest page as the template source.** A template generated from a page
with no FAQ has nothing to wire a field into.

## 4. Deciding what becomes a field

```bash
make variants
```

The tool compares text sequences of pages sharing a template and prints the
differences with indexes. That is your field list — computed, not invented.

Two things to remember:

- **Exclude anything already turned into a loop** (e.g. FAQs), otherwise a differing
  number of elements throws off the positional comparison.
- **Not every repeater row shows up.** If one list item is identical across all pages
  it will not appear among the differences — yet it still belongs to the repeater.
  Skipping it deletes that row. That is why the field map also accepts literal values,
  not just indexes.

## 5. Wiring the fields

```bash
make wire
```

Text becomes field calls, repeated blocks become `foreach` loops.

The hardest part is **finding the boundary of a repeater row**. Take the **largest**
element that contains the row and does not reach the next one. The smallest one lands
on the `<span>` holding the text, and deleting its siblings wipes out the `<li>`
wrappers — collapsing the whole list into a single bullet.

Order matters too: **repeaters before partial replacements**. A short value like a city
name is often a substring of a section title, and replacing it first breaks block
detection.

## 6. Content model

The rule: the client edits **content**, not **layout**. No fields for colours, spacing,
section order or CSS classes.

- a field for every text that varies
- a repeater for lists and FAQs
- a WYSIWYG editor where content has paragraphs and lists — and reproduce the original
  classes in CSS via `@apply`, so the look stays identical
- languages with grammatical cases need separate fields (`city`, `city_locative`);
  you cannot derive them from one value

Guardrails: a role without access to appearance or plugins, `DISALLOW_FILE_EDIT`,
length limits on headings, required fields wherever an empty value would break layout.

## 7. Styles

Same CSS entry file as the original, with Tailwind scanning `.php`.
Build **after** wiring the fields, or classes from newly inserted markup will be missing.

Take fonts from the Next build, not from Google. The build also contains the
**fallback metrics** (`size-adjust`, `ascent-override`) that stop text from jumping
before the webfont loads.

## 8. Import

```bash
make import
```

Idempotent, matched by slug. That makes the import part of the process rather than a
one-shot action — after any change to the original, just run it again.

## 9. Proof

```bash
make verify
```

Until this is green, the migration is not finished. See [TESTING.md](TESTING.md).
