// Wyciąga treść i metadane ze starej strony do JSON-a gotowego do importu w WordPressie.
// Dzięki temu 14 stron nie jest przepisywanych ręcznie do panelu.
//
// Źródła: zrzut z tests/snapshots/old/content.json (meta, nagłówki, obrazy, CTA)
//         + JSON-LD z theme/content/jsonld/*.json (FAQ, dane firmy).
// Użycie: node extract-content.mjs --snapshot ../tests/snapshots/old --theme ../theme
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith("--") ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), [])
);
const SNAP = args.snapshot || "../tests/snapshots/old";
const THEME = args.theme || "../theme";

const flat = (x) => (Array.isArray(x) ? x : [x]).flat().filter(Boolean);

function faqsFrom(jsonLd) {
    const page = flat(jsonLd).find((j) => j?.["@type"] === "FAQPage");
    return (page?.mainEntity ?? []).map((q) => ({ pytanie: q.name, odpowiedz: q.acceptedAnswer?.text }));
}

function businessFrom(all) {
    // AutoRental/LocalBusiness niosą pełny NAP, Organization tylko podstawy —
    // scalamy je, zaczynając od bogatszego typu.
    const rich = all.find((j) => ["AutoRental", "LocalBusiness"].includes(j?.["@type"]));
    const org = all.find((j) => j?.["@type"] === "Organization");
    if (!rich && !org) return null;
    const biz = { ...(org ?? {}), ...(rich ?? {}) };
    return {
        nazwa: biz.name,
        telefon: biz.telephone,
        email: biz.email,
        ulica: biz.address?.streetAddress,
        kod_pocztowy: biz.address?.postalCode,
        miejscowosc: biz.address?.addressLocality,
        kraj: biz.address?.addressCountry,
        godziny: biz.openingHoursSpecification ?? biz.openingHours ?? null,
        geo: biz.geo ? { lat: biz.geo.latitude, lng: biz.geo.longitude } : null,
        url: biz.url,
        logo: biz.logo,
    };
}

async function main() {
    const snap = JSON.parse(await readFile(path.join(SNAP, "content.json"), "utf8"));
    const manifest = JSON.parse(await readFile(path.join(THEME, "content", "manifest.json"), "utf8"));

    const jsonLdDir = path.join(THEME, "content", "jsonld");
    const jsonLd = {};
    for (const f of await readdir(jsonLdDir)) {
        jsonLd[f.replace(".json", "")] = JSON.parse(await readFile(path.join(jsonLdDir, f), "utf8"));
    }

    const allLd = Object.values(jsonLd).flat();
    const firma = businessFrom(allLd);

    const pages = manifest.pages.map((p) => {
        const c = snap.content[p.route] ?? {};
        return {
            slug: p.slug,
            route: p.route,
            szablon: p.template,
            mobile_cta: p.mobileCta,
            seo: {
                title: c.title ?? null,
                description: c.description ?? null,
                canonical: c.canonical ?? null,
                og_image: c.ogImage ?? null,
            },
            h1: c.h1?.[0] ?? null,
            naglowki: c.headings ?? [],
            faq: faqsFrom(jsonLd[p.slug] ?? []),
            obrazy: [...new Set((c.images ?? []).map((i) => i.file).filter(Boolean))],
            alty: (c.images ?? []).map((i) => ({ plik: i.file, alt: i.alt })),
            cta: [...new Set(c.ctas ?? [])],
            jsonld_typy: p.jsonLdTypes,
        };
    });

    // Dane firmy powtarzają się na każdej stronie → w WP jedna strona opcji ACF.
    await mkdir(path.join(THEME, "content"), { recursive: true });
    await writeFile(path.join(THEME, "content", "firma.json"), JSON.stringify(firma, null, 2));
    await writeFile(path.join(THEME, "content", "pages.json"), JSON.stringify(pages, null, 2));

    const faqCount = pages.reduce((a, p) => a + p.faq.length, 0);
    const imgCount = new Set(pages.flatMap((p) => p.obrazy)).size;
    console.log(`Wyeksportowano ${pages.length} stron do ${THEME}/content/pages.json`);
    console.log(`  pytania FAQ:        ${faqCount} (gotowe do wrzucenia w repeatery ACF)`);
    console.log(`  unikalne obrazy:    ${imgCount}`);
    console.log(`  dane firmy (NAP):   ${firma ? "wyciągnięte ✓" : "NIE ZNALEZIONO — sprawdź JSON-LD"}`);
    const noTitle = pages.filter((p) => !p.seo.title).map((p) => p.route);
    if (noTitle.length) console.log(`  UWAGA — brak title dla: ${noTitle.join(", ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
