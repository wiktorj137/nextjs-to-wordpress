// Detects which texts differ between pages that share a template.
//
// Pages sharing a template have identical markup and differ only in content.
// Instead of reading through tens of kilobytes of markup hunting for the spots
// to parameterise, compare the text sequences from the export: what differs
// is exactly the list of fields the client needs.
//
// Usage: node find-variants.mjs --in ../reference-nextjs/out --theme ../theme
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith("--") ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), [])
);
const IN = args.in || "../reference-nextjs/out";
const THEME = args.theme || "../theme";

/** Returns text nodes in document order, skipping scripts and styles. */
function textNodes(html) {
    const body = html.slice(html.indexOf("<body"), html.lastIndexOf("</body>"));
    const clean = body
        .replace(/<script[\s\S]*?<\/script>/g, "")
        .replace(/<style[\s\S]*?<\/style>/g, "");

    const out = [];
    const re = />([^<]+)</g;
    let m;
    while ((m = re.exec(clean))) {
        const text = m[1].replace(/<!--\s*-->/g, "").replace(/\s+/g, " ").trim();
        if (text && text !== "+") out.push(text);
    }
    return out;
}

async function main() {
    const manifest = JSON.parse(await readFile(path.join(THEME, "content", "manifest.json"), "utf8"));

    // Grupujemy strony po szablonie.
    const groups = new Map();
    for (const p of manifest.pages) {
        if (!groups.has(p.template)) groups.set(p.template, []);
        groups.get(p.template).push(p);
    }

    // FAQs are already a loop in the template, and a differing number of questions
    // would throw off the positional comparison. Drop them before comparing.
    const pagesData = JSON.parse(await readFile(path.join(THEME, "content", "pages.json"), "utf8"));
    const faqTexts = (slug) => {
        const p = pagesData.find((x) => x.slug === slug);
        const set = new Set();
        for (const f of p?.faq ?? []) { set.add(f.pytanie.replace(/\s+/g, " ").trim()); set.add(f.odpowiedz.replace(/\s+/g, " ").trim()); }
        return set;
    };

    const result = {};

    for (const [template, pages] of groups) {
        if (pages.length < 2) continue;

        const texts = {};
        for (const p of pages) {
            const skip = faqTexts(p.slug);
            texts[p.slug] = textNodes(await readFile(path.join(IN, p.file), "utf8")).filter((t) => !skip.has(t));
        }

        const lengths = [...new Set(Object.values(texts).map((t) => t.length))];
        const base = manifest.templateSources[template].slug;

        if (lengths.length > 1) {
            // A different text count means a different element count. Positional
            // comparison is meaningless then and needs a human look.
            console.log(`${template}: pages have different text counts (${lengths.join(", ")}) — positional comparison skipped`);
            result[template] = { base, warning: "different element count", lengths: Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, v.length])) };
            continue;
        }

        const n = lengths[0];
        const variants = [];
        for (let i = 0; i < n; i++) {
            const values = Object.fromEntries(pages.map((p) => [p.slug, texts[p.slug][i]]));
            const unique = new Set(Object.values(values));
            if (unique.size > 1) variants.push({ index: i, source: values[base], values: values });
        }

        result[template] = { base, liczbaTekstow: n, differences: variants };
        console.log(`${template}: ${variants.length} of ${n} texts differ across ${pages.length} pages`);
    }

    await writeFile(path.join(THEME, "content", "variants.json"), JSON.stringify(result, null, 2));
    console.log(`\nZapisano do ${THEME}/content/variants.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
