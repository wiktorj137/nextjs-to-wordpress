// Podpina wygenerowane szablony pod pola edycyjne.
//
// Szablony powstają z eksportu jednej konkretnej strony, więc mają wpisaną treść
// TEJ strony. Trzy kategorie pojazdów dzielą jeden szablon — bez tego kroku
// wszystkie trzy pokazywałyby to samo.
//
// Zamiast przepisywać 22 kB markupu ręcznie, podmieniamy znane wartości
// (z content/pages.json) na wywołania pól. Struktura znaczników i klasy zostają
// nietknięte — od tego zależy test wizualny.
//
// Użycie: node wire-fields.mjs --theme ../theme
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith("--") ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), [])
);
const CONFIG = JSON.parse(await readFile(args.config || "../migration.config.json", "utf8"));
const THEME = args.theme || CONFIG.sciezki?.motyw || "../theme";
const PREFIX = CONFIG.prefix || "motyw";

/* ------------------------------------------------------------------ *
 * Minimalny parser znaczników — tylko po to, by znaleźć granice
 * powtarzanego bloku. Nie budujemy pełnego DOM, bo w szablonach są już
 * wstawki <?php ?>, które każdy prawdziwy parser by zniekształcił.
 * ------------------------------------------------------------------ */

const VOID = new Set(["img", "br", "hr", "input", "meta", "link", "source", "path", "circle", "rect", "line", "polyline", "polygon", "use", "area", "col", "embed", "track", "wbr"]);

/** Zwraca listę elementów jako {tag, open:[a,b], close:[c,d]} posortowaną po pozycji. */
function indexElements(html) {
    const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
    const stack = [];
    const elements = [];
    let m;

    while ((m = tagRe.exec(html))) {
        const [full, slash, tag, attrs] = m;
        const lower = tag.toLowerCase();

        if (slash) {
            // Domykamy najbliższy pasujący otwarty znacznik.
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
 * Element wyznaczający granice jednego wiersza repeatera.
 *
 * Bierzemy NAJWIĘKSZY element, który zawiera dany wiersz i nie sięga następnego.
 * Najmniejszy byłby błędem: dla listy zastosowań trafiłby w <span> z tekstem,
 * a usunięcie rodzeństwa skasowałoby opakowania <li> i cała lista zlewałaby się
 * w jeden punkt. Diff wysokości elementów wyłapał dokładnie ten przypadek.
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

/** Zamienia dokładny tekst na wstawkę PHP. Zgłasza błąd, gdy tekstu nie ma — cisza tutaj oznaczałaby, że strona po migracji pokazuje treść innej strony. */
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
 * Zamienia N powtórzonych bloków na pętlę foreach.
 * Blok wzorcowy bierzemy z pierwszego elementu; pozostałe usuwamy.
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

        // Sąsiedni element nie może wejść w zakres — inaczej złapalibyśmy kontener.
        const nextItem = items[i + 1];
        const excludePos = nextItem
            ? html.indexOf(cfg.fields.map((f) => nextItem[f.key]).find(Boolean))
            : null;

        // Ostatni wiersz nie ma następnika, więc odgradzamy go poprzednim.
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

    // Bloki muszą być rodzeństwem tego samego typu — inaczej to nie repeater.
    const tag = ranges[0].tag;
    if (!ranges.every((r) => r.tag === tag)) {
        report.missing.push(`${cfg.label} — bloki różnych typów (${ranges.map((r) => r.tag).join(",")})`);
        return html;
    }

    let block = html.slice(ranges[0].openStart, ranges[0].closeEnd);
    for (const f of cfg.fields) {
        const value = items[0][f.key];
        if (value && block.includes(value)) block = block.replace(value, f.php);
    }

    const loop = `<?php foreach ( ${cfg.source} as $${cfg.var} ) : ?>${block}<?php endforeach; ?>`;

    // Sklejamy: wszystko przed pierwszym blokiem + pętla + wszystko po ostatnim.
    const out = html.slice(0, ranges[0].openStart) + loop + html.slice(ranges[ranges.length - 1].closeEnd);
    report.wired.push(`${cfg.label} (${items.length} → pętla)`);
    return out;
}

/* ------------------------------------------------------------------ *
 * Konfiguracja: co i czym podmieniamy w każdym szablonie.
 * ------------------------------------------------------------------ */

/** Prosty repeater (lista tekstów) → pętla foreach po ${PREFIX}_simple_repeater(). */
function replaceSimpleList(html, values, cfg, report) {
    const items = values.map((v) => ({ v }));
    return replaceRepeater(html, items, {
        label: cfg.label,
        source: `${PREFIX}_simple_repeater( '${cfg.name}', '${cfg.sub}' )`,
        var: cfg.sub,
        fields: [{ key: "v", php: `<?php echo esc_html( $${cfg.sub} ); ?>` }],
    }, report);
}

/** Repeater par (tytuł + opis) → pętla po get_field(). */
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
 * Repeater z edytorem WYSIWYG: cały kontener treści zamieniamy na pętlę.
 *
 * Osobna funkcja, bo w odróżnieniu od pozostałych repeaterów treść jest dowolnym
 * HTML-em z edytora, a nie pojedynczym tekstem. Klasy Tailwinda z oryginału
 * odtwarza klasa `<prefiks>-tresc` w CSS (przez @apply), więc klient dostaje
 * normalny edytor, a wygląd zostaje 1:1.
 *
 * Konfiguracja (w mapaPol.<szablon>.wysiwyg):
 *   { "kontener": "space-y-8", "pole": "sekcje", "podpola": ["tytul", "tresc"] }
 * gdzie `kontener` to fragment klasy CSS jednoznacznie wskazujący kontener sekcji.
 */
function wireWysiwygRepeater(html, cfg, report) {
    const klasaTresci = `${PREFIX}-tresc`;
    if (html.includes(klasaTresci)) { report.wired.push(`${cfg.pole} (już podpięte)`); return html; }

    const marker = html.indexOf(cfg.kontener);
    if (marker === -1) { report.missing.push(`${cfg.pole} — nie znaleziono kontenera "${cfg.kontener}"`); return html; }

    const divStart = html.lastIndexOf("<div", marker);
    const elements = indexElements(html);
    const container = elements.find((el) => el.openStart === divStart);
    if (!container) { report.missing.push(`${cfg.pole} — nie udało się odczytać kontenera`); return html; }

    // Nagłówek zachowuje oryginalne klasy; treść dostaje wrapper odtwarzający typografię.
    const h2Class = html.slice(container.openEnd, container.closeStart).match(/<h2 class="([^"]*)"/)?.[1] ?? "";
    const [subTytul, subTresc] = cfg.podpola ?? ["tytul", "tresc"];

    const loop = `<?php foreach ( ${PREFIX}_field( '${cfg.pole}', array() ) as $row ) : ?>`
        + `<div>`
        + `<h2 class="${h2Class}"><?php echo esc_html( $row['${subTytul}'] ); ?></h2>`
        + `<div class="${klasaTresci}"><?php echo wp_kses_post( $row['${subTresc}'] ); ?></div>`
        + `</div>`
        + `<?php endforeach; ?>`;

    report.wired.push(`${cfg.pole} (kontener → pętla)`);
    return html.slice(0, container.openEnd) + loop + html.slice(container.closeStart);
}

/**
 * Sekcja FAQ ma się nie pokazywać, gdy wpis nie ma pytań.
 * Bez tego wpis bez FAQ renderował pusty nagłówek „Najczęstsze pytania”.
 */
function hideEmptyFaqSection(html, report) {
    if (html.includes("${PREFIX}_faqs() ) : ?>")) return html;

    const loopStart = html.indexOf("<?php foreach ( ${PREFIX}_faqs()");
    if (loopStart === -1) return html;

    // FAQ nie ma własnej <section> — siedzi w tej samej co treść artykułu,
    // w kontenerze <div> razem ze swoim nagłówkiem. Zaczynamy więc od
    // nagłówka poprzedzającego pętlę i cofamy się do jego <div>.
    const h2 = html.lastIndexOf("<h2", loopStart);
    if (h2 === -1) { report.missing.push("warunek pustego FAQ — brak nagłówka"); return html; }

    // Szukamy kontenera, który obejmuje ZARÓWNO nagłówek, jak i pętlę.
    // Najbliższy <div> przed nagłówkiem czasem opakowuje sam nagłówek
    // i domyka się przed pętlą — wtedy cofamy się o kolejny poziom.
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
        report.missing.push("warunek pustego FAQ — nie znaleziono wspólnego kontenera");
        return html;
    }

    report.wired.push("blok FAQ ukrywany przy braku pytań");
    return html.slice(0, open)
        + `<?php if ( ${PREFIX}_faqs() ) : ?>`
        + html.slice(open, close)
        + `<?php endif; ?>`
        + html.slice(close);
}

/**
 * Nawigacja w header.php pochodzi z eksportu i ma wpisane linki na sztywno.
 * Podmieniamy oba zestawy (desktop i menu mobilne) na pętle po menu WordPressa,
 * zachowując klasy co do znaku. Gdy klient nie przypisze menu,
 * ${PREFIX}_menu_items() oddaje układ z oryginału, więc nawigacja nie znika.
 */
function wireNav(html, links, report) {
    if (html.includes("${PREFIX}_menu_items")) { report.wired.push("menu (już podpięte)"); return html; }

    let out = html;
    let done = 0;

    // Dwa zestawy tych samych linków: pasek na desktopie i panel mobilny.
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

    if (!done) report.missing.push("menu — nie znaleziono linków");
    return out;
}

async function main() {
    const read = async (f) => JSON.parse(await readFile(path.join(THEME, "content", f), "utf8"));
    const { templateSources } = await read("manifest.json");
    const variants = await read("variants.json");
    const fieldMap = CONFIG.mapaPol ?? {};
    const pages = await read("pages.json");

    let totalWired = 0, totalMissing = 0;

    // Wartość wzorcowa dla danego indeksu wariantu.
    // Pozycja repeatera bywa identyczna na wszystkich stronach — wtedy nie ma jej
    // w wariantach i podaje się ją w mapie dosłownie. Pominięcie takiej pozycji
    // kasowało cały wiersz listy.
    const valueAt = (template, index) =>
        typeof index === "string"
            ? index
            : variants[template]?.roznice?.find((r) => r.index === index)?.wzorzec;

    // Nagłówek jest wspólny dla wszystkich stron, więc podpinamy go osobno.
    {
        const headerFile = path.join(THEME, "header.php");
        const report = { wired: [], missing: [] };
        let header = await readFile(headerFile, "utf8");
        header = wireNav(header, CONFIG.menu ?? [], report);
        await writeFile(headerFile, header);
        console.log("header.php");
        for (const w of report.wired) console.log(`  \u2713 ${w}`);
        for (const m of report.missing) console.log(`  \u2717 ${m} — NIE PODPIĘTO`);
        totalWired += report.wired.length;
        totalMissing += report.missing.length;
    }

    for (const [template, map] of Object.entries(fieldMap)) {
        if (template.startsWith("_")) continue;

        const file = path.join(THEME, `${template}.php`);
        let html;
        try { html = await readFile(file, "utf8"); }
        catch { console.log(`${template}.php — brak pliku, pomijam`); continue; }

        const source = templateSources[template]?.slug;
        const report = { wired: [], missing: [] };
        console.log(`${template}.php (wzorzec: ${source})`);

        // Tytuł wpisu.
        if (map.tytul !== undefined) {
            const v = valueAt(template, map.tytul);
            if (v && html.includes(v)) html = replaceScalar(html, v, `<?php the_title(); ?>`, "tytuł", report);
            else report.wired.push("tytuł (już podpięte)");
        }

        // Pola tekstowe.
        for (const [name, index] of Object.entries(map.scalars ?? {})) {
            const v = valueAt(template, index);
            // h1 bywa już podpięty we wcześniejszym przebiegu — to nie błąd.
            if (!v || !html.includes(v)) { report.wired.push(`${name} (już podpięte)`); continue; }
            html = replaceScalar(html, v, `<?php the_field( '${name}' ); ?>`, name, report);
        }

        // Repeatery.
        for (const [name, cfg] of Object.entries(map.repeaters ?? {})) {
            // Narzędzie jest idempotentne: przy powtórnym uruchomieniu na już
            // podpiętym szablonie nie ma czego szukać i to nie jest błąd.
            if (html.includes(`'${name}'`)) { report.wired.push(`${name} (już podpięte)`); continue; }

            if (cfg.pary) {
                const pairs = cfg.indeksy.map(([a, b]) => [valueAt(template, a), valueAt(template, b)]);
                if (pairs.some(([a, b]) => !a || !b)) { report.missing.push(name); continue; }
                html = replacePairList(html, pairs, { label: name, name, sub: cfg.sub }, report);
            } else {
                const values = cfg.indeksy.map((i) => valueAt(template, i));
                if (values.some((v) => !v)) { report.missing.push(name); continue; }
                html = replaceSimpleList(html, values, { label: name, name, sub: cfg.sub }, report);
            }
        }

        // Powtórzenia tej samej wartości w innych miejscach strony.
        // Świadomie PO repeaterach: krótkie wartości jak „w Bochni" bywają
        // podciągiem tytułów sekcji i wcześniejsza podmiana rozbiłaby wykrywanie bloków.
        for (const [name, indeksy] of Object.entries(map.powtorzenia ?? {})) {
            for (const index of indeksy) {
                const v = valueAt(template, index);
                if (v && html.includes(v)) {
                    html = html.replace(v, `<?php the_field( '${name}' ); ?>`);
                    report.wired.push(`${name} (powtórzenie #${index})`);
                }
            }
        }

        // Link WhatsApp niesie w treści wiadomości typ pojazdu. W szablonie
        // zostawał typ ze strony wzorcowej, więc każda kategoria pytała o busa.
        if (template === "single-kategoria_pojazdu") {
            const before = html;
            // Strona ma DWA linki WhatsApp: jeden z typem pojazdu w treści
            // wiadomości (rozpoznajemy go po dwukropku %3A) i jeden ogólny.
            // Podmiana wszystkich naraz gubiła ten ogólny.
            html = html
                .replace(
                    /href="https:\/\/wa\.me\/[^"]*%3A[^"]*"/g,
                    `href="<?php echo esc_url( ${PREFIX}_whatsapp_url( get_field( 'typ_pojazdu' ) ) ); ?>"`
                )
                .replace(
                    /href="https:\/\/wa\.me\/(?![^"]*%3A)[^"]*"/g,
                    `href="<?php echo esc_url( ${PREFIX}_whatsapp_url() ); ?>"`
                );
            report.wired.push(html === before ? "link WhatsApp (już podpięte)" : "linki WhatsApp (z typem i ogólny)");
        }

        if (template === "single-lokalizacja") {
            const before = html;
            html = html.replace(
                /href="https:\/\/wa\.me\/[^"]*"/g,
                `href="<?php echo esc_url( ${PREFIX}_whatsapp_url() ); ?>"`
            );
            report.wired.push(html === before ? "link WhatsApp (już podpięte)" : "link WhatsApp");
        }

        // Repeater z edytorem WYSIWYG, jeśli szablon go deklaruje.
        if (map.wysiwyg) {
            html = wireWysiwygRepeater(html, map.wysiwyg, report);
        }

        // FAQ jest w każdym z tych szablonów i ma stały kształt.
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
            report.wired.push("FAQ (już podpięte)");
        }

        html = hideEmptyFaqSection(html, report);

        await writeFile(file, html);
        totalWired += report.wired.length;
        totalMissing += report.missing.length;

        for (const w of report.wired) console.log(`  \u2713 ${w}`);
        for (const m of report.missing) console.log(`  \u2717 ${m} — NIE PODPIĘTO`);
    }

    // Wartości pól dla WSZYSTKICH stron — nie tylko wzorcowej.
    // Bez tego trzy kategorie pokazywałyby treść busa 9-osobowego.
    const values = {};
    // Nagłówek jest wspólny dla wszystkich stron, więc podpinamy go osobno.
    {
        const headerFile = path.join(THEME, "header.php");
        const report = { wired: [], missing: [] };
        let header = await readFile(headerFile, "utf8");
        header = wireNav(header, CONFIG.menu ?? [], report);
        await writeFile(headerFile, header);
        console.log("header.php");
        for (const w of report.wired) console.log(`  \u2713 ${w}`);
        for (const m of report.missing) console.log(`  \u2717 ${m} — NIE PODPIĘTO`);
        totalWired += report.wired.length;
        totalMissing += report.missing.length;
    }

    for (const [template, map] of Object.entries(fieldMap)) {
        if (template.startsWith("_")) continue;
        const roznice = variants[template]?.roznice ?? [];
        const at = (index) => roznice.find((r) => r.index === index)?.wartosci ?? {};
        const slugs = Object.keys(at(map.tytul ?? Object.values(map.scalars ?? {})[0]));

        for (const slug of slugs) {
            const entry = { post_type: map.post_type, fields: {}, tytul: at(map.tytul)[slug] };

            for (const [name, index] of Object.entries(map.scalars ?? {})) {
                entry.fields[name] = at(index)[slug];
            }
            for (const [name, cfg] of Object.entries(map.repeaters ?? {})) {
                const val = (i) => (typeof i === "string" ? i : at(i)[slug]);
                entry.fields[name] = cfg.pary
                    ? cfg.indeksy.map(([a, b]) => ({ [cfg.sub[0]]: val(a), [cfg.sub[1]]: val(b) }))
                    : cfg.indeksy.map((i) => ({ [cfg.sub]: val(i) }));
            }
            values[slug] = entry;
        }
    }

    await writeFile(path.join(THEME, "content", "fields.json"), JSON.stringify(values, null, 2));
    console.log(`\nWartości pól dla ${Object.keys(values).length} stron → content/fields.json`);

    console.log(`\nPodpięto ${totalWired} elementów, nie udało się ${totalMissing}.`);
    if (totalMissing) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
