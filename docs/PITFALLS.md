# Pitfalls

Everything below actually happened and cost time. Ordered from most treacherous.

If you hit a new one, please [open an issue](../../issues/new?template=pitfall.md) —
this file is the most valuable part of the repo.

---

## 1. A static export freezes the initial animation state

**Symptom:** after migration, a whole section of the page is blank.

`framer-motion` renders its initial state as an inline style:

```html
<div style="opacity:0;transform:translateY(30px)">
```

In SSR and in a static export this stays there **permanently**. Without working
JavaScript the page shows an empty screen — and that is what reaches screen readers,
and Google when JS execution fails. The bug is already present in the original.

**Fix:** convert the inline style into a `data-reveal` attribute holding the transform.
CSS keeps elements **visible by default** and only hides them once JS confirms it is
running (a class on `<html>`). No JS means a visible page, not an empty one.

**Watch out:** the pattern is not limited to `translateY`. One project also used
`scale()`, `translateX()` and `scaleX()`, sometimes combined with `font-size`.
A regex that only matches `translateY` will silently leave the rest invisible.

---

## 2. The hiding class must go in `<head>`, not in `main.js`

**Symptom:** Lighthouse reports an LCP several times worse than the original,
even though the page looks fine.

If a script adds the `js-reveal` class after `DOMContentLoaded`, the browser paints
the content, the script hides it, then animates it back. The largest element is
painted **twice**, and LCP is measured from the second paint.

**Fix:** a one-line inline script in `<head>`, executed synchronously.

---

## 3. Some animations run on mount, others on scroll

The export **cannot tell them apart** — both look identical (`opacity:0` in `style`).
Treat them all as scroll-triggered and above-the-fold sections stay invisible until
the first mouse movement.

**How to check:** load the live old site, wait 2 seconds **without scrolling**, and
count elements with `opacity < 0.5`. The count and positions must match the new site.

---

## 4. Client-only components vanish without a trace

A cookie consent banner checks `localStorage`. A sticky CTA bar reacts to scroll.
Neither exists in the static export, so a template generator skips them and the
migration quietly loses functionality.

**Fix:** extract them from the **live** old site via `outerHTML`
(see `extract-client-only.mjs`). Two gotchas:

- `page.evaluate` serializes its result — a DOM element comes back as an empty
  object, so return `outerHTML` from inside the browser
- some components only render at a specific viewport width

---

## 5. `<nav>` is sometimes inside `<main>`

**Symptom:** none. That is what makes it dangerous.

If your page template keeps `<main>` and the navigation also went into `header.php`,
it renders **twice**. Nothing is visible, because `position: fixed` stacks the copies
perfectly. But the DOM is duplicated, screen readers announce the menu twice, and
`querySelector` in your scripts only ever finds the first copy.

Only a **content** diff catches this. A pixel diff never will.

---

## 6. `wp_update_post()` always overwrites `post_modified`

If a modification date feeds JSON-LD and has to match the original, passing it to
`wp_update_post()` does nothing — WordPress stamps the current time anyway.
Write it straight to the database with `$wpdb->update()` and call `clean_post_cache()`.

---

## 7. `update_field()` resolves field names globally

Two repeaters with the same name in different field groups (say `sections` on two
post types) means **silent data loss**. ACF/SCF writes the subfields from the first
matching definition; the rest disappears without an error.

In practice: section titles saved correctly, section bodies came back empty.
Field names must be unique across the whole site.

---

## 8. `wpautop` on textarea fields changes section height

ACF runs `textarea` values through `wpautop` by default, which injects paragraphs
and shifts everything below by a dozen pixels. Set `'new_lines' => ''`.

---

## 9. Variables do not travel between WordPress templates

Each template is loaded in its **own scope**, so `$flag = false;` in `page-contact.php`
never reaches `footer.php`. You need a function backed by a global or static,
reset on `template_redirect`.

Also: a flag that affects the **header** must be set **before** `get_header()`,
because that is what emits the markup. Set afterwards, there is nothing left to disable.

---

## 10. A custom post type with slug `/` swallows every URL

`'rewrite' => array( 'slug' => '/' )` generates the rule `^([^/]+)/?$`, which matches
**every** top-level URL and turns all your pages into 404s.

**Fix:** `'rewrite' => false` plus a narrow custom rule matching only your pattern,
and a `post_type_link` filter to build permalinks.

Related: a page and a CPT sharing a prefix (`/shop/` as an index page and
`/shop/product/` as a CPT) needs an explicit rule for the index page itself.

---

## 11. A trailing-slash filter breaks file URLs

`user_trailingslashit` will happily append a slash to `/sitemap.xml`, producing a 301
to `/sitemap.xml/`. Skip paths that have a file extension.

Similarly, `redirect_canonical` can redirect your custom endpoint before it emits
anything — disable it for that specific request.

---

## 12. Favicon

WordPress serves **its own default logo** at `/favicon.ico`. The `<link>` tags in
`<head>` are not enough — browsers request `/favicon.ico` directly regardless.
Serve the icons from the site root.

Easy to miss, because no standard test checks for it.

---

## 13. The test harness has its own pitfalls

A test that lies is worse than no test — people stop trusting it.

- **Lazy loading:** `complete === true` does not mean the image is painted.
  In `fullPage` screenshots, large files are often loaded but not yet rendered.
  Force `loading="eager"` and await `img.decode()`.
- **Scroll animations:** scroll to the bottom and back before capturing, or half the
  sections will be invisible in one of the two images you are comparing.
- **URLs across environments:** the old site emits its production domain in `canonical`
  and JSON-LD, the new one emits localhost. Compare paths, not full URLs.
- **Images moved into the theme:** same file, different path. Compare filenames,
  or every page reports a false difference.
- **A partial capture overwriting a full one:** a "single route" mode must **merge**
  into the previous result, not replace it.

---

## 14. Never pipe a long-running writer into `head`

```bash
node wire-fields.mjs | head -5     # ← SIGPIPE kills the script mid-write
```

This cost half an hour of hunting a "regression" that did not exist. Templates were
partially wired and the tests showed a 95% mismatch.
