// Podpina wygenerowane szablony pod pola edycyjne.
//
// A template is generated from one specific page, so it carries THAT page's content.
// When several pages share a template, without this step they would all render the same.
//
// Instead of editing kilobytes of markup by hand, replace known values with field
// calls. Markup structure and classes stay untouched - the visual test depends on it.
//
// Usage: node wire-fields.mjs --theme ../theme
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith("--") ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), [])
);
const CONFIG = JSON.parse(await readFile(args.config || "../migration.config.json", "utf8"));
const THEME = args.theme || CONFIG.paths?.motyw || "../theme";
const PREFIX = CONFIG.prefix || "motyw";

/* ------------------------------------------------------------------ *
 * A minimal tag scanner, only used to find the boundaries of a repeated block.
 * We deliberately do not build a real DOM: the templates already contain <?php ?>
 * fragments that any real parser would mangle.
 * ------------------------------------------------------------------ */

const VOID = new Set(["img", "br", "hr", "input", "meta", "link", "source", "path", "circle", "rect", "line", "polyline", "polygon", "use", "area", "col", "embed", "track", "wbr"]);

/** Returns elements as {tag, openStart, openEnd, closeStart, closeEnd}, sorted by position. */
function indexElements(html) {
    const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
    const stack = [];
    const elements = [];
    let m;

    while ((m = tagRe.exec(html))) {
        const [full, slash, tag, attrs] = m;
        const lower = tag.toLowerCase();

        if (slash) {
            // Close the nearest matching open tag.
            for (let i = stack.length - 1; i >= 0; i--) {
                if (stack[i].tag === lower) {
                    const el = stack[i];
                    elements.push({ tag: lower, openStart: el.start, openEnd: el.end, closeStart: m.index, closeEnd: m.index + full.length });
                    stack.length = i;
                    break;
                }
            }
            continue;
        }

        if (VOID.has(lower) || attrs.trim().endsWith("/")) continue;
        stack.push({ tag: lower, start: m.index, end: m.index + full.length });
    }

    return elements.sort((a, b) => a.openStart - b.openStart);
}

/**
 * Finds the boundary element of a single repeater row.
 *
 * Take the LARGEST element that contains the row and does not reach the next one.
 * The smallest would be wrong: for a bullet list it lands on the <span> holding the
 * text, and deleting its siblings wipes out the <li> wrappers, collapsing the whole
 * list into one bullet. An element-height diff caught exactly this case.
 */
function rowBoundary(elements, from, to, exclude = null, tag = null) {
    let best = null;
    for (const el of elements) {
        if (el.openStart > from || el.closeEnd < to) continue;
        if (tag && el.tag !== tag) continue;
        if (exclude !== null && el.openStart <= exclude && el.closeEnd >= exclude) continue;
        if (!best || el.closeEnd - el.openStart > best.closeEnd - best.openStart) best = el;
    }
    return best;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replaces an exact string with a PHP snippet. Reports when the text is absent -
 *  staying silent here would mean the migrated page shows another page's content. */
function replaceScalar(html, value, php, label, report) {
    if (!value) return html;
    if (!html.includes(value)) {
        report.missing.push(label);
        return html;
    }
    report.wired.push(label);
    return html.replace(value, php);
}

/**
 * Turns N repeated blocks into a foreach loop.
 * The template block comes from the first element; the rest are removed.
 */
function replaceRepeater(html, items, cfg, report) {
    if (!items?.length) return html;

    const elements = indexElements(html);
    const ranges = [];

    for (let i = 0; i < items.length; i++) {
        const texts = cfg.fields.map((f) => items[i][f.key]).filter(Boolean);
        if (!texts.length) return html;

        const positions = texts.map((t) => html.indexOf(t));
        if (positions.some((p) => p === -1)) {
            report.missing.push(`${cfg.label}[${i}]`);
            return html;
        }

        const from = Math.min(...positions);
        const to = Math.max(...positions.map((p, n) => p + texts[n].length));

        // The neighbouring row must stay out of range, or we would grab the container.
        const nextItem = items[i + 1];
        const excludePos = nextItem
            ? html.indexOf(cfg.fields.map((f) => nextItem[f.key]).find(Boolean))
            : null;

        // The last row has no successor, so bound it with the previous one.
        let el;
        if (nextItem) {
            el = rowBoundary(elements, from, to, excludePos >= 0 ? excludePos : null, ranges[0]?.tag ?? null);
        } else {
            const prev = items[i - 1];
            const prevPos = prev ? html.indexOf(cfg.fields.map((f) => prev[f.key]).find(Boolean)) : -1;
            el = rowBoundary(elements, from, to, prevPos >= 0 ? prevPos : null, ranges[0]?.tag ?? null);
        }
        if (!el) { report.missing.push(`${cfg.label}[${i}] — brak granic bloku`); return html; }
        ranges.push(el);
    }

    // Blocks must be siblings of the same tag, otherwise this is not a repeater.
    const tag = ranges[0].tag;
    if (!ranges.every((r) => r.tag === tag)) {
        report.missing.push(`${cfg.label} - blocks of differing tags (${ranges.map((r) => r.tag).join(",")})`);
        return html;
    }

    let block = html.slice(ranges[0].openStart, ranges[0].closeEnd);
    for (const f of cfg.fields) {
        const value = items[0][f.key];
        if (value && block.includes(value)) block = block.replace(value, f.php);
    }

    const loop = `<?php foreach ( ${cfg.source} as $${cfg.var} ) : ?>${block}<?php endforeach; ?>`;

    // Splice: everything before the first block + the loop + everything after the last.
    const out = html.slice(0, ranges[0].openStart) + loop + html.slice(ranges[ranges.length - 1].closeEnd);
    report.wired.push(`${cfg.label} (${items.length} rows -> loop)`);
    return out;
}

/* ------------------------------------------------------------------ *
 * Replacement helpers.
 * ------------------------------------------------------------------ */

/** Simple repeater (list of strings) -> foreach over ${PREFIX}_simple_repeater(). */
function replaceSimpleList(html, values, cfg, report) {
    const items = values.map((v) => ({ v }));
    return replaceRepeater(html, items, {
        label: cfg.label,
        source: `${PREFIX}_simple_repeater( '${cfg.name}', '${cfg.sub}' )`,
        var: cfg.sub,
        fields: [{ key: "v", php: `<?php echo esc_html( $${cfg.sub} ); ?>` }],
    }, report);
}

/** Paired repeater (title + body) -> foreach over the field. */
function replacePairList(html, pairs, cfg, report) {
    const items = pairs.map(([a, b]) => ({ a, b }));
    return replaceRepeater(html, items, {
        label: cfg.label,
        source: `${PREFIX}_field( '${cfg.name}', array() )`,
        var: "row",
        fields: [
            { key: "a", php: `<?php echo esc_html( $row['${cfg.sub[0]}'] ); ?>` },
            { key: "b", php: `<?php echo esc_html( $row['${cfg.sub[1]}'] ); ?>` },
        ],
    }, report);
}

/**
 * WYSIWYG repeater: the whole content container becomes a loop.
 *
 * A separate function because, unlike the other repeaters, the body is arbitrary
 * HTML from an editor rather than a single string. The original Tailwind classes are
 * reproduced by a `<prefix>-body` CSS class (via @apply), so the client gets a normal
 * editor while the rendering stays identical.
 *
 * Konfiguracja (w mapaPol.<szablon>.wysiwyg):
 *   { "kontener": "space-y-8", "pole": "sekcje", "podpola": ["tytul", "tresc"] }
 * where `kontener` is a CSS class fragment that uniquely identifies the container.
 */
function wireWysiwygRepeater(html, cfg, report) {
    const klasaTresci = `${PREFIX}-tresc`;
    if (html.includes(klasaTresci)) { report.wired.push(`${cfg.field} (already wired)`); return html; }

    const marker = html.indexOf(cfg.container);
    if (marker === -1) { report.missing.push(`${cfg.field} - container "${cfg.container}" not found`); return html; }

    const divStart = html.lastIndexOf("<div", marker);
    const elements = indexElements(html);
    const container = elements.find((el) => el.openStart === divStart);
    if (!container) { report.missing.push(`${cfg.field} - could not read the container`); return html; }

    // The heading keeps its original classes; the body gets a wrapper that restores typography.
    const h2Class = html.slice(container.openEnd, container.closeStart).match(/<h2 class="([^"]*)"/)?.[1] ?? "";
    const [subTytul, subTresc] = cfg.subfields ?? ["tytul", "tresc"];

    const loop = `<?php foreach ( ${PREFIX}_field( '${cfg.field}', array() ) as $row ) : ?>`
        + `<div>`
        + `<h2 class="${h2Class}"><?php echo esc_html( $row['${subTytul}'] ); ?></h2>`
        + `<div class="${klasaTresci}"><?php echo wp_kses_post( $row['${subTresc}'] ); ?></div>`
        + `</div>`
        + `<?php endforeach; ?>`;

    report.wired.push(`${cfg.field} (container -> loop)`);
    return html.slice(0, container.openEnd) + loop + html.slice(container.closeStart);
}

/**
 * The FAQ block must not render when an entry has no questions.
 * Without this, an entry without FAQs rendered an empty "FAQ" heading.
 */
function hideEmptyFaqSection(html, report) {
    if (html.includes("${PREFIX}_faqs() ) : ?>")) return html;

    const loopStart = html.indexOf("<?php foreach ( ${PREFIX}_faqs()");
    if (loopStart === -1) return html;

    // The FAQ block may not have its own <section> - it can sit in the same one as the
    // article body, inside a <div> together with its heading. So start from the heading
    // preceding the loop and walk back to its <div>.
    const h2 = html.lastIndexOf("<h2", loopStart);
    if (h2 === -1) { report.missing.push("empty-FAQ guard - no heading found"); return html; }

    // Find a container that wraps BOTH the heading and the loop. The nearest <div>
    // before the heading sometimes wraps only the heading and closes before the loop,
    // in which case walk out one more level.
    const closeOf = (start) => {
        let depth = 0, m;
        const re = /<\/?div\b/g;
        re.lastIndex = start;
        while ((m = re.exec(html))) {
            depth += m[0][1] === "/" ? -1 : 1;
            if (depth === 0) return html.indexOf(">", m.index) + 1;
        }
        return -1;
    };

    let open = h2, close = -1;
    for (let guard = 0; guard < 8; guard++) {
        open = html.lastIndexOf("<div", open - 1);
        if (open === -1) break;
        const c = closeOf(open);
        if (c > loopStart) { close = c; break; }
    }

    if (open === -1 || close === -1) {
        report.missing.push("empty-FAQ guard - no common container found");
        return html;
    }

    report.wired.push("FAQ block hidden when there are no questions");
    return html.slice(0, open)
        + `<?php if ( ${PREFIX}_faqs() ) : ?>`
        + html.slice(open, close)
        + `<?php endif; ?>`
        + html.slice(close);
}

/**
 * Nawigacja w header.php pochodzi z eksportu i ma wpisane linki na sztywno.
 * Both sets (desktop bar and mobile panel) become loops over a WordPress menu,
 * with classes preserved byte for byte. If the client never assigns a menu,
 * ${PREFIX}_menu_items() falls back to the original layout so the nav never vanishes.
 */
function wireNav(html, links, report) {
    if (html.includes("${PREFIX}_menu_items")) { report.wired.push("menu (already wired)"); return html; }

    let out = html;
    let done = 0;

    // Two sets of the same links: the desktop bar and the mobile panel.
    for (let pass = 0; pass < 2; pass++) {
        const items = links.map((l) => ({ label: l.label, url: l.url }));
        const before = out;

        out = replaceRepeater(out, items, {
            label: `menu (${pass === 0 ? "desktop" : "mobilne"})`,
            source: "${PREFIX}_menu_items()",
            var: "item",
            fields: [
                { key: "label", php: `<?php echo esc_html( $item['label'] ); ?>` },
                { key: "url", php: `<?php echo esc_url( $item['url'] ); ?>` },
            ],
        }, report);

        if (out === before) break;
        done++;
    }

    if (!done) report.missing.push("menu - links not found");
    return out;
}

async function main() {
    const read = async (f) => JSON.parse(await readFile(path.join(THEME, "content", f), "utf8"));
    const { templateSources } = await read("manifest.json");
    const variants = await read("variants.json");
    const fieldMap = CONFIG.fieldMap ?? {};
    const pages = await read("pages.json");

    let totalWired = 0, totalMissing = 0;

    // The source-page value for a given variant index.
    // A repeater row can be identical on every page - then it never shows up among the
    // variants and must be given literally in the map. Skipping such a row deleted an
    // entire list item.
    const valueAt = (template, index) =>
        typeof index === "string"
            ? index
            : variants[template]?.differences?.find((r) => r.index === index)?.source;

    // The header is shared by every page, so it is wired separately.
    {
        const headerFile = path.join(THEME, "header.php");
        const report = { wired: [], missing: [] };
        let header = await readFile(headerFile, "utf8");
        header = wireNav(header, CONFIG.menu ?? [], report);
        await writeFile(headerFile, header);
        console.log("header.php");
        for (const w of report.wired) console.log(`  \u2713 ${w}`);
        for (const m of report.missing) console.log(`  \u2717 ${m} - NOT WIRED`);
        totalWired += report.wired.length;
        totalMissing += report.missing.length;
    }

    for (const [template, map] of Object.entries(fieldMap)) {
        if (template.startsWith("_")) continue;

        const file = path.join(THEME, `${template}.php`);
        let html;
        try { html = await readFile(file, "utf8"); }
        catch { console.log(`${template}.php - file missing, skipping`); continue; }

        const source = templateSources[template]?.slug;
        const report = { wired: [], missing: [] };
        console.log(`${template}.php (source: ${source})`);

        // Post title.
        if (map.title !== undefined) {
            const v = valueAt(template, map.title);
            if (v && html.includes(v)) html = replaceScalar(html, v, `<?php the_title(); ?>`, "title", report);
            else report.wired.push("title (already wired)");
        }

        // Pola tekstowe.
        for (const [name, index] of Object.entries(map.scalars ?? {})) {
            const v = valueAt(template, index);
            // h1 may already be wired from an earlier run - that is not an error.
            if (!v || !html.includes(v)) { report.wired.push(`${name} (already wired)`); continue; }
            html = replaceScalar(html, v, `<?php the_field( '${name}' ); ?>`, name, report);
        }

        // Repeatery.
        for (const [name, cfg] of Object.entries(map.repeaters ?? {})) {
            // The tool is idempotent: on a second run against an already wired template
            // there is nothing left to find, and that is not an error.
            if (html.includes(`'${name}'`)) { report.wired.push(`${name} (already wired)`); continue; }

            if (cfg.pairs) {
                const pairs = cfg.indexes.map(([a, b]) => [valueAt(template, a), valueAt(template, b)]);
                if (pairs.some(([a, b]) => !a || !b)) { report.missing.push(name); continue; }
                html = replacePairList(html, pairs, { label: name, name, sub: cfg.sub }, report);
            } else {
                const values = cfg.indexes.map((i) => valueAt(template, i));
                if (values.some((v) => !v)) { report.missing.push(name); continue; }
                html = replaceSimpleList(html, values, { label: name, name, sub: cfg.sub }, report);
            }
        }

        // Repeats of the same value elsewhere on the page.
        // Deliberately AFTER the repeaters: short values (a city name, say) are often a
        // substring of section titles, and replacing them first breaks block detection.
        for (const [name, indeksy] of Object.entries(map.repeats ?? {})) {
            for (const index of indeksy) {
                const v = valueAt(template, index);
                if (v && html.includes(v)) {
                    html = html.replace(v, `<?php the_field( '${name}' ); ?>`);
                    report.wired.push(`${name} (repeat #${index})`);
                }
            }
        }

        // Config-driven link rewrites.
        //
        // A shared template freezes the source page's parameters into every URL.
        // In one project this meant a contact link on every product page asked
        // about the wrong product - invisible in screenshots, caught by the
        // content diff. Declare rewrites per template in the config:
        //
        //   "linkRewrites": [
        //     { "match": "https://example\\.com/[^\"]*%3A[^\"]*", "php": "<?php echo esc_url( fn( get_field('type') ) ); ?>" }
        //   ]
        //
        // Order the entries from most specific to most general: a blanket rewrite
        // applied first will swallow the variants you meant to keep distinct.
        for (const rule of map.linkRewrites ?? []) {
            const before = html;
            html = html.replace(new RegExp(`href="${rule.match}"`, "g"), `href="${rule.php}"`);
            report.wired.push(html === before ? `link rewrite (already wired)` : `link rewrite: ${rule.match.slice(0, 40)}`);
        }

        // WYSIWYG repeater, if the template declares one.
        if (map.wysiwyg) {
            html = wireWysiwygRepeater(html, map.wysiwyg, report);
        }

        // FAQs have a fixed shape across templates.
        const faqSource = pages.find((p) => p.slug === source)?.faq ?? [];
        if (faqSource.length && html.includes(faqSource[0].pytanie)) {
            html = replaceRepeater(html, faqSource, {
                label: "FAQ",
                source: "${PREFIX}_faqs()",
                var: "faq",
                fields: [
                    { key: "pytanie", php: `<?php echo esc_html( $faq['pytanie'] ); ?>` },
                    { key: "odpowiedz", php: `<?php echo esc_html( $faq['odpowiedz'] ); ?>` },
                ],
            }, report);
        } else if (faqSource.length) {
            report.wired.push("FAQ (already wired)");
        }

        html = hideEmptyFaqSection(html, report);

        await writeFile(file, html);
        totalWired += report.wired.length;
        totalMissing += report.missing.length;

        for (const w of report.wired) console.log(`  \u2713 ${w}`);
        for (const m of report.missing) console.log(`  \u2717 ${m} - NOT WIRED`);
    }

    // Field values for EVERY page, not just the source one.
    // Without this, all pages sharing a template would show the source page's content.
    const values = {};
    for (const [template, map] of Object.entries(fieldMap)) {
        if (template.startsWith("_")) continue;
        const roznice = variants[template]?.differences ?? [];
        const at = (index) => roznice.find((r) => r.index === index)?.values ?? {};
        const slugs = Object.keys(at(map.title ?? Object.values(map.scalars ?? {})[0]));

        for (const slug of slugs) {
            const entry = { post_type: map.post_type, fields: {}, tytul: at(map.title)[slug] };

            for (const [name, index] of Object.entries(map.scalars ?? {})) {
                entry.fields[name] = at(index)[slug];
            }
            for (const [name, cfg] of Object.entries(map.repeaters ?? {})) {
                const val = (i) => (typeof i === "string" ? i : at(i)[slug]);
                entry.fields[name] = cfg.pairs
                    ? cfg.indexes.map(([a, b]) => ({ [cfg.sub[0]]: val(a), [cfg.sub[1]]: val(b) }))
                    : cfg.indexes.map((i) => ({ [cfg.sub]: val(i) }));
            }
            values[slug] = entry;
        }
    }

    await writeFile(path.join(THEME, "content", "fields.json"), JSON.stringify(values, null, 2));
    console.log(`\nField values for ${Object.keys(values).length} pages -> content/fields.json`);

    console.log(`\nWired ${totalWired} elements, ${totalMissing} failed.`);
    if (totalMissing) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
