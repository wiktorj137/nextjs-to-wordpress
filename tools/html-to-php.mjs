// Zamienia statyczny eksport Next.js na szkielet motywu WordPress.
// Zamiast przepisywać ~4600 linii TSX z palca, bierzemy wygenerowany HTML
// (czyli dokładnie to, co widzi przeglądarka) i tniemy go mechanicznie.
//
// Użycie: node html-to-php.mjs --in ../reference-nextjs/out --out ../theme
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith("--") ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), [])
);
const IN = args.in || "../reference-nextjs/out";
const OUT = args.out || "../theme";

// Mapowanie pliku eksportu na szablon i trasę pochodzi z konfiguracji projektu.
const CONFIG = JSON.parse(await readFile(args.config || "../migration.config.json", "utf8"));
const ROUTE_MAP = Object.fromEntries(
    Object.entries(CONFIG.trasy).filter(([k]) => !k.startsWith("_"))
);
const PREFIX = CONFIG.prefix || "motyw";

const hash = (s) => createHash("sha1").update(s).digest("hex").slice(0, 12);

/**
 * framer-motion renderuje stan początkowy jako inline style: opacity:0 plus transform
 * (translateY, translateX, scale, scaleX — zależnie od sekcji). W eksporcie zostaje to
 * na stałe, więc bez JS strona byłaby PUSTA. Nie teoretycznie: pierwszy test wizualny
 * pokazał całkowicie czarną sekcję pomocy drogowej.
 *
 * Zamieniamy te dwie deklaracje na atrybut data-reveal (z zachowaniem pozostałych,
 * np. font-size). Widoczność steruje CSS — domyślnie widoczne — a animację dokłada
 * IntersectionObserver dopiero gdy JS działa.
 */
function convertMotionStyles(html) {
    let count = 0;

    const out = html.replace(/style="([^"]*opacity:0[^"]*)"/g, (whole, style) => {
        const decls = style.split(";").map((d) => d.trim()).filter(Boolean);

        const transform = decls.find((d) => d.startsWith("transform:"));
        const rest = decls.filter((d) => !d.startsWith("transform:") && !/^opacity:\s*0$/.test(d));

        // Bez opacity:0 to nie jest stan początkowy animacji — zostawiamy bez zmian.
        if (!decls.some((d) => /^opacity:\s*0$/.test(d))) return whole;

        count++;
        const from = transform ? transform.slice("transform:".length).trim() : "none";
        const keep = rest.length ? ` style="${rest.join(";")}"` : "";
        return `data-reveal="${from}"${keep}`;
    });

    return { html: out, count };
}

function stripNextRuntime(html) {
    return html
        // Skrypty runtime'u Next i hydracji — w WordPressie nie mają odpowiednika.
        .replace(/<script[^>]*>[\s\S]*?<\/script>/g, "")
        .replace(/<script[^>]*\/>/g, "")
        // Znaczniki granic Suspense i pusty kontener hydracji.
        .replace(/<!--\$-->|<!--\/\$-->|<!--\$\?-->|<!--\$!-->/g, "")
        .replace(/<div hidden="">\s*<\/div>/g, "")
        .replace(/<template[\s\S]*?<\/template>/g, "")
        // Atrybuty specyficzne dla Reacta/Next — nie wpływają na wygląd.
        .replace(/\s(?:data-precedence|data-nscript|fetchPriority)="[^"]*"/g, "")
        .replace(/\s(?:data-reactroot)(?:="[^"]*")?/g, "");
}

function extractJsonLd(html) {
    const out = [];
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        try { out.push(JSON.parse(m[1])); } catch { /* pomijamy niepoprawny blok */ }
    }
    return out;
}

// Klasy fontów z next/font są generowane z hasha — w motywie zastępujemy je własnymi.
const FONT_CLASS_RE = /\b(?:inter|syne|outfit)_[0-9a-f]+-module__[A-Za-z0-9_]+__variable\s*/g;

function section(html, tag) {
    const start = html.indexOf(`<${tag}`);
    if (start === -1) return null;
    // Prosty licznik zagnieżdżeń — wystarcza dla dobrze uformowanego eksportu.
    const re = new RegExp(`</?${tag}[\\s>]`, "g");
    re.lastIndex = start;
    let depth = 0, m;
    while ((m = re.exec(html))) {
        depth += m[0].startsWith("</") ? -1 : 1;
        if (depth === 0) {
            const end = html.indexOf(">", m.index) + 1;
            return { html: html.slice(start, end), start, end };
        }
    }
    return null;
}

async function walk(dir, base = dir) {
    const out = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...(await walk(full, base)));
        else if (e.name.endsWith(".html")) out.push(path.relative(base, full));
    }
    return out;
}

async function main() {
    const files = (await walk(IN)).filter((f) => ROUTE_MAP[f]);
    const missing = Object.keys(ROUTE_MAP).filter((k) => !files.includes(k));
    if (missing.length) console.warn(`Uwaga — brak w eksporcie: ${missing.join(", ")}`);

    await mkdir(path.join(OUT, "template-parts"), { recursive: true });
    await mkdir(path.join(OUT, "content", "jsonld"), { recursive: true });

    const templateCandidates = new Map();
    let revealTotal = 0;
    let navStripped = 0;
    const navHashes = new Map();
    const footerHashes = new Map();
    const manifest = [];
    let firstNav = null, firstFooter = null, bodyClass = null;

    for (const file of files) {
        const meta = ROUTE_MAP[file];
        const raw = await readFile(path.join(IN, file), "utf8");

        // JSON-LD zapisujemy osobno — w motywie generuje go PHP, nie kopiowany tekst.
        const jsonLd = extractJsonLd(raw);
        await writeFile(path.join(OUT, "content", "jsonld", `${meta.slug}.json`), JSON.stringify(jsonLd, null, 2));

        const bodyOpen = raw.indexOf("<body");
        const bodyEnd = raw.lastIndexOf("</body>");
        let body = raw.slice(raw.indexOf(">", bodyOpen) + 1, bodyEnd);

        if (bodyClass === null) {
            bodyClass = (raw.slice(bodyOpen, raw.indexOf(">", bodyOpen)).match(/class="([^"]*)"/)?.[1] ?? "")
                .replace(FONT_CLASS_RE, "").trim();
        }

        body = stripNextRuntime(body).replace(FONT_CLASS_RE, "");
        const motion = convertMotionStyles(body);
        body = motion.html;
        revealTotal += motion.count;

        // Obrazy leżą w motywie (assets/img), nie w bibliotece mediów — to elementy
        // layoutu, których klient nie zmienia. Ścieżki przepisujemy na wywołanie PHP.
        body = body.replace(
            /(<img[^>]*?\ssrc=")\/((?:cars\/)?[^"]+\.(?:png|jpe?g|webp|svg))"/g,
            '$1<?php echo esc_url( ${PREFIX}_img( \'$2\' ) ); ?>"'
        );

        const nav = section(body, "nav");
        const footer = section(body, "footer");
        const main = section(body, "main");

        if (nav) navHashes.set(file, hash(nav.html));
        if (nav && !firstNav) firstNav = nav.html;

        // Stopka ma dwa warianty paddingu: strony z paskiem CTA na mobile mają
        // "pb-28 lg:pb-8", pozostałe "pb-8". Sprowadzamy to do jednej stopki
        // sterowanej zmienną, zamiast trzymać dwa niemal identyczne partiale.
        let hasMobileCta = null;
        if (footer) {
            hasMobileCta = /class="[^"]*\bpb-28 lg:pb-8\b/.test(footer.html);
            const normalized = footer.html.replace(/\bpb-28 lg:pb-8\b/, "pb-8");
            footerHashes.set(file, hash(normalized));
            if (!firstFooter) firstFooter = normalized.replace(
                /(<footer class=")([^"]*?)pb-8/,
                "$1$2<?php echo $mobile_cta ? 'pb-28 lg:pb-8' : 'pb-8'; ?>"
            );
        }

        // W szablonie strony zostaje wyłącznie <main> — nagłówek i stopka to partiale.
        let inner = main ? main.html : body;

        // W oryginale nawigacja siedzi WEWNĄTRZ <main>. Skoro trafiła do header.php,
        // to bez usunięcia jej stąd renderowałaby się dwa razy. Wizualnie nie widać
        // tego wcale (nav jest position:fixed, więc kopie idealnie się nakładają),
        // ale DOM jest zdublowany, czytniki ekranu czytają menu dwukrotnie,
        // a skrypty trafiają tylko w pierwszą kopię. Wykrył to diff treści.
        if (nav && inner.includes(nav.html)) {
            inner = inner.replace(nav.html, "");
            navStripped++;
        }
        const php = `<?php
/**
 * Wygenerowane automatycznie z ${file} przez tools/html-to-php.mjs
 * Trasa: ${meta.route}
 *
 * KROK RĘCZNY: podmień treść na pola ACF (the_field/get_field).
 * NIE zmieniaj struktury znaczników ani klas — od tego zależy test wizualny.
 */
${nav ? "" : `// Oryginał renderował tę stronę bez nawigacji — jedyny taki przypadek.
// Musi być USTAWIONE PRZED get_header(), bo to on wypisuje nawigację.
${PREFIX}_set_nav( false );
`}get_header();
${hasMobileCta === false ? `
// Ta strona nie pokazuje paska CTA na mobile — stopka ma wtedy mniejszy dolny
// padding (pb-8 zamiast pb-28). Bez tego strona jest o 80 px wyższa niż oryginał.
${PREFIX}_set_mobile_cta( false );
` : ""}?>
${inner}
<?php get_footer(); ?>
`;
        // Kilka stron może dzielić jeden szablon (np. wszystkie produkty).
        // Jako wzorzec bierzemy stronę o NAJBOGATSZEJ treści — inaczej szablon
        // wygenerowany z wpisu bez FAQ nie miałby czego podpiąć pod pole.
        const richness = jsonLd.find((j) => j["@type"] === "FAQPage")?.mainEntity?.length ?? 0;
        const prev = templateCandidates.get(meta.template);
        if (!prev || richness > prev.richness) {
            templateCandidates.set(meta.template, { php, richness, source: file, slug: meta.slug });
        }
        manifest.push({ file, ...meta, bytes: inner.length, mobileCta: hasMobileCta, jsonLdTypes: jsonLd.map((j) => j["@type"]) });
    }

    for (const [template, cand] of templateCandidates) {
        await writeFile(path.join(OUT, `${template}.php`), cand.php);
    }

    // Nagłówek i stopka są identyczne na wszystkich stronach → jeden partial, nie 14 kopii.
    const navUnique = new Set(navHashes.values());
    const footerUnique = new Set(footerHashes.values());

    await writeFile(path.join(OUT, "header.php"), `<?php
/** Wygenerowane automatycznie. Nagłówek jest wspólny dla wszystkich ${navHashes.size} stron. */
?><!doctype html>
<html <?php language_attributes(); ?> class="scroll-smooth">
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<?php wp_head(); ?>
</head>
<body <?php body_class( '${bodyClass}' ); ?>>
<?php if ( ${PREFIX}_show_nav() ) : ?>
${firstNav ?? "<!-- nie znaleziono <nav> -->"}
<?php endif; ?>
`);

    await writeFile(path.join(OUT, "footer.php"), `<?php
/**
 * Wygenerowane automatycznie. Stopka jest wspólna dla wszystkich ${footerHashes.size} stron.
 * Pasek CTA na mobile wpływa na dolny padding stopki. Szablony stron wyłączają go
 * przez ${PREFIX}_set_mobile_cta( false ) — zwykła zmienna by tu nie dotarła,
 * bo WordPress ładuje każdy szablon w osobnym zasięgu.
 */
$mobile_cta = ${PREFIX}_show_mobile_cta();
?>
${firstFooter ?? "<!-- nie znaleziono <footer> -->"}
<?php
// Komponenty renderowane w oryginale dopiero po stronie klienta — nie ma ich
// w statycznym eksporcie, więc pochodzą z tools/extract-client-only.mjs.
if ( $mobile_cta ) {
	get_template_part( 'template-parts/mobile-cta-bar' );
}
get_template_part( 'template-parts/cookie-consent' );

wp_footer(); ?>
</body>
</html>
`);

    const templateSources = Object.fromEntries(
        [...templateCandidates].map(([t, c]) => [t, { slug: c.slug, source: c.source, faq: c.richness }])
    );
    await writeFile(
        path.join(OUT, "content", "manifest.json"),
        JSON.stringify({ generated: new Date().toISOString(), templateSources, pages: manifest }, null, 2)
    );

    console.log(`Wygenerowano ${manifest.length} szablonów w ${OUT}`);
    console.log(`  nagłówek: ${navUnique.size === 1 ? "identyczny na wszystkich stronach ✓" : `UWAGA — ${navUnique.size} wariantów, sprawdź ręcznie`}`);
    console.log(`  stopka:   ${footerUnique.size === 1 ? "identyczna po normalizacji paddingu ✓" : `UWAGA — ${footerUnique.size} wariantów, sprawdź ręcznie`}`);
    const noCta = manifest.filter((m) => m.mobileCta === false).map((m) => m.route);
    console.log(`  bez paska CTA na mobile: ${noCta.join(", ") || "brak"} → w tych szablonach ustaw $mobile_cta = false;`);
    const byTemplate = manifest.reduce((a, m) => ({ ...a, [m.template]: (a[m.template] ?? 0) + 1 }), {});
    for (const [t, n] of Object.entries(byTemplate)) {
        const src = templateCandidates.get(t);
        const note = n > 1 ? `stron (współdzielony, wzorzec: ${src?.slug}, ${src?.richness} FAQ)` : "strona";
        console.log(`  ${t}.php ← ${n} ${note}`);
    }
    console.log(`  nawigacja: usunięta z ${navStripped} szablonów (w oryginale była wewnątrz <main>)`);
    console.log(`  animacje wejścia: ${revealTotal} elementów przepiętych z inline opacity:0 na data-reveal`);
    console.log(`\nŁącznie ${(manifest.reduce((a, m) => a + m.bytes, 0) / 1024).toFixed(0)} kB markupu przeniesione bez przepisywania z palca.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
