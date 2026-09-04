// Porównanie treści, SEO i JSON-LD. Łapie to, czego diff pikselowy nie widzi:
// zgubiony canonical, przekręcony numer telefonu, inny JSON-LD, martwy link.
// Użycie: node diff-content.mjs [--old snapshots/old] [--new snapshots/new]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith("--") ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), [])
);
const OLD = args.old || "snapshots/old";
const NEW = args.new || "snapshots/new";
const OUT = args.report || "report";

const load = async (dir) => JSON.parse(await readFile(path.join(dir, "content.json"), "utf8"));

// Domena różni się między środowiskami: stara strona podaje w canonical i JSON-LD
// adres produkcyjny (projekt24.pl), nowa localhost. Porównujemy same ścieżki —
// inaczej każda strona zgłaszałaby fałszywą rozbieżność.
const normUrl = (v) => {
    if (typeof v !== "string") return v;

    // Obrazy przeniosły się z katalogu głównego do motywu (/wp-content/themes/...),
    // ale to te same pliki. Porównujemy nazwę pliku — inaczej każda strona
    // zgłaszałaby rozbieżność w og:image i logo, zagłuszając prawdziwe problemy.
    if (/\.(png|jpe?g|webp|svg|gif|ico)$/i.test(v)) return v.split("/").pop();

    const m = v.match(/^https?:\/\/[^/]+(\/.*)?$/);
    return m ? (m[1] || "/") : v;
};

function normalize(obj) {
    if (Array.isArray(obj)) return obj.map((v) => normalize(v));
    if (obj && typeof obj === "object") return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalize(v)]));
    if (typeof obj === "string") return normUrl(obj.replace(/\s+/g, " ").trim());
    return obj;
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function diffArrays(a = [], b = []) {
    const missing = a.filter((x) => !b.includes(x));
    const added = b.filter((x) => !a.includes(x));
    return { missing, added };
}

/** Zatwierdzone odstępstwa — patrz odstepstwa.json i ODSTEPSTWA.md. */
async function loadDeviations() {
    try {
        const d = JSON.parse(await readFile(new URL("./odstepstwa.json", import.meta.url), "utf8"));
        return d.tresc ?? [];
    } catch {
        return [];
    }
}

async function main() {
    const deviations = await loadDeviations();
    const acceptedFor = (route, field) =>
        deviations.find((d) => d.strony.includes(route) && d.pola.includes(field));

    const oldData = await load(OLD);
    const newData = await load(NEW);
    // Kanoniczne URL-e są bezwzględne i wskazują produkcję — sprowadzamy oba do ścieżek.
    const findings = [];

    const routes = [...new Set([...Object.keys(oldData.content), ...Object.keys(newData.content)])];

    for (const route of routes) {
        const o = oldData.content[route];
        const n = newData.content[route];
        const add = (severity, field, detail) => {
            const accepted = acceptedFor(route, field);
            findings.push({
                route,
                severity: accepted ? "ODSTĘPSTWO" : severity,
                field,
                detail: accepted ? accepted.powod : detail,
            });
        };

        if (!n) { add("KRYTYCZNY", "strona", "brak strony w nowej wersji"); continue; }
        if (!o) { add("UWAGA", "strona", "strona nie istniała w starej wersji"); continue; }

        // Status HTTP — 404 musi zostać 404, reszta 200.
        if (oldData.statuses[route] !== newData.statuses[route])
            add("KRYTYCZNY", "status HTTP", `${oldData.statuses[route]} → ${newData.statuses[route]}`);

        // SEO: pola, których rozjazd realnie kosztuje pozycje w Google.
        for (const f of ["title", "description", "lang", "robots", "ogTitle", "ogDescription"]) {
            if (o[f] !== n[f]) add(f === "title" || f === "description" ? "KRYTYCZNY" : "UWAGA", f, `„${o[f]}” → „${n[f]}”`);
        }
        for (const f of ["canonical", "ogImage"]) {
            const ov = normUrl(o[f]), nv = normUrl(n[f]);
            if (ov !== nv) add("KRYTYCZNY", f, `„${ov}” → „${nv}”`);
        }

        // Struktura nagłówków — inna hierarchia H1/H2 to zmiana SEO, nie kosmetyka.
        if (!eq(o.h1, n.h1)) add("KRYTYCZNY", "H1", `${JSON.stringify(o.h1)} → ${JSON.stringify(n.h1)}`);
        if (!eq(o.headings, n.headings)) {
            const d = diffArrays(o.headings, n.headings);
            add("KRYTYCZNY", "nagłówki", `brakuje: ${JSON.stringify(d.missing)}; nadmiarowe: ${JSON.stringify(d.added)}`);
        }

        // JSON-LD porównywany strukturalnie po normalizacji URL-i i kolejności kluczy.
        if (!eq(normalize(o.jsonLd), normalize(n.jsonLd)))
            add("KRYTYCZNY", "JSON-LD", `stary: ${JSON.stringify(normalize(o.jsonLd)).slice(0, 600)}\nnowy: ${JSON.stringify(normalize(n.jsonLd)).slice(0, 600)}`);

        // CTA: telefon i WhatsApp to jedyna droga konwersji na tej stronie.
        if (!eq([...o.ctas].sort(), [...n.ctas].sort())) {
            const d = diffArrays(o.ctas, n.ctas);
            add("KRYTYCZNY", "CTA (tel/WhatsApp)", `brakuje: ${JSON.stringify(d.missing)}; nadmiarowe: ${JSON.stringify(d.added)}`);
        }

        // Linki wewnętrzne — łapie zgubione przekierowania i literówki w slugach.
        const d = diffArrays([...new Set(o.links)], [...new Set(n.links)]);
        if (d.missing.length || d.added.length)
            add("UWAGA", "linki", `brakuje: ${JSON.stringify(d.missing)}; nadmiarowe: ${JSON.stringify(d.added)}`);

        // Ikony strony (favicon). Brak wpisu oznacza, że w karcie przeglądarki
        // pokaże się domyślne logo WordPressa zamiast logo klienta.
        if (!eq(o.ikony, n.ikony)) {
            add("KRYTYCZNY", "ikony strony", `${JSON.stringify(o.ikony)} → ${JSON.stringify(n.ikony)}`);
        }

        // Alt-y obrazów i nazwy plików.
        const oAlt = o.images.map((i) => i.alt), nAlt = n.images.map((i) => i.alt);
        if (!eq(oAlt, nAlt)) add("UWAGA", "alt obrazów", `${JSON.stringify(oAlt)} → ${JSON.stringify(nAlt)}`);
        if (o.images.length !== n.images.length) add("KRYTYCZNY", "liczba obrazów", `${o.images.length} → ${n.images.length}`);

        // Widoczny tekst — ostatnia sieć bezpieczeństwa na zgubioną treść.
        if (o.bodyText !== n.bodyText) {
            const ow = o.bodyText.split(" "), nw = n.bodyText.split(" ");
            const missing = ow.filter((w) => !nw.includes(w));
            add(missing.length ? "KRYTYCZNY" : "UWAGA", "tekst strony",
                `różnica długości ${ow.length} → ${nw.length} słów; brakujące fragmenty: ${JSON.stringify(missing.slice(0, 40))}`);
        }
    }

    const crit = findings.filter((f) => f.severity === "KRYTYCZNY");
    const accepted = findings.filter((f) => f.severity === "ODSTĘPSTWO");
    await mkdir(OUT, { recursive: true });
    await writeFile(path.join(OUT, "content.html"), `<!doctype html><meta charset="utf-8">
<title>Przykład — diff treści i SEO</title>
<style>body{font:14px system-ui;margin:2rem;max-width:1100px}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #ddd;padding:6px 10px;text-align:left;vertical-align:top}
td:last-child{font:12px ui-monospace,monospace;white-space:pre-wrap;word-break:break-word;max-width:520px}
.KRYTYCZNY td{background:#fdf0f0}.UWAGA td{background:#fffbe9}.ODSTĘPSTWO td{background:#eef4fd}
.sum{padding:1rem;border-radius:8px;margin:1rem 0;font-weight:600}</style>
<h1>Diff treści i SEO: Next.js vs WordPress</h1>
<div class="sum" style="background:${crit.length ? "#fdf0f0" : "#f2fbf3"}">
${crit.length ? `${crit.length} rozbieżności krytycznych` : "Brak rozbieżności krytycznych"} — ${findings.length} znalezisk łącznie, w tym ${accepted.length} zatwierdzonych odstępstw</div>
${findings.length ? `<table><tr><th>Strona</th><th>Waga</th><th>Pole</th><th>Szczegóły</th></tr>
${findings.map((f) => `<tr class="${f.severity}"><td>${f.route}</td><td>${f.severity}</td><td>${f.field}</td><td>${String(f.detail).replace(/</g, "&lt;")}</td></tr>`).join("\n")}</table>` : "<p>Wszystko zgodne.</p>"}`);

    console.log(`\nRaport: ${path.join(OUT, "content.html")}`);
    for (const f of crit) console.log(`  KRYTYCZNY ${f.route} — ${f.field}`);
    for (const f of accepted) console.log(`  ODSTĘPSTWO ${f.route} — ${f.field}`);
    console.log(crit.length
        ? `\n${crit.length} rozbieżności krytycznych`
        : `\nOK: brak rozbieżności krytycznych (${accepted.length} zatwierdzonych odstępstw, ${findings.length - accepted.length} uwag)`);
    process.exit(crit.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
