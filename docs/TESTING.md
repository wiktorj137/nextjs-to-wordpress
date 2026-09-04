# The acceptance gate

The goal: turn "it looks the same" from an opinion into a **deployment condition**.

## Three layers

| Layer | Catches | Misses |
|---|---|---|
| **Visual** | layout drift, spacing, colours, fonts | typo in a phone number, missing `canonical` |
| **Content & SEO** | meta, JSON-LD, headings, CTAs, icons, alt text | a button moved by 40px |
| **Performance** | Core Web Vitals regressions | both of the above |

The first two are complementary, and **each found bugs the other could not see**.
That is not redundancy.

## Thresholds

- **visual:** ≤ 0.1% differing pixels per page, colour tolerance 0.15
  (absorbs font antialiasing, will not let a shifted element through)
- **page height:** difference < 8px — anything more means broken layout even at a
  low percentage
- **content:** zero critical diffs

## Approved deviations

Some differences are **intentional** — usually because you are fixing a bug in the
original. Rather than loosening thresholds globally (which weakens the gate everywhere),
keep a list of approved deviations with reasons:

```json
{
  "visual": [
    { "pages": ["home"], "widths": ["mobile"], "tolerance": 1.3,
      "reason": "Fix: the consent banner covered the CTA button." }
  ],
  "content": [
    { "pages": ["/404/"], "fields": ["canonical"],
      "reason": "A 404 page should not declare a canonical URL." }
  ]
}
```

The tests pass **only** those entries. Any new difference still fails the gate.
The report renders them in a distinct colour with the reason attached, so they never
drop out of sight.

## Trusting the harness

Before you trust a test, check that it does not lie: run **two independent captures
of the same site** and compare. The result must be zero. If it is not, you have false
positives and you will soon stop reading the report.

What `capture.mjs` does to earn that:

- disables every animation and transition, hides the caret
- scrolls to the bottom and back (triggers on-scroll animations)
- forces `loading="eager"` and awaits `img.decode()` — not `complete`
- fixed `deviceScaleFactor` and viewport, `fullPage` capture

## Performance

Measure **before and after**, on the same URLs, and keep the numbers.

Beware of artifacts: Lighthouse scrolls the page at the end of a run, which can trigger
entry animations and push LCP to the end of the trace. Before accepting a regression as
real, measure LCP in a real browser via `PerformanceObserver` — a 10-second gap in the
report has turned out to be 90ms for actual users.
