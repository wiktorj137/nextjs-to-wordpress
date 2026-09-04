// Compares content, SEO and JSON-LD. Catches what a pixel diff cannot see:
// a lost canonical, a mangled phone number, changed JSON-LD, a dead link.
// Usage: node diff-content.mjs [--old snapshots/old] [--new snapshots/new]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith("--") ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), [])
);
const OLD = args.old || "snapshots/old";
const NEW = args.new || "snapshots/new";
const OUT = args.report || "report";

const load = async (dir) => JSON.parse(await readFile(path.join(dir, "content.json"), "utf8"));

// Domains differ between environments: the old site emits its production URL in
// canonical and JSON-LD, the new one emits localhost. Compare paths only, or every
// page would report a false difference.
const normUrl = (v) => {
    if (typeof v !== "string") return v;

    // Images moved from the site root into the theme (/wp-content/themes/...), but they
    // are the same files. Compare filenames, or og:image and logo would report a
    // difference on every page and drown out the real problems.
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

/** Approved deviations - see deviations.json and docs/TESTING.md. */
async function loadDeviations() {
    try {
        const d = JSON.parse(await readFile(new URL("./deviations.json", import.meta.url), "utf8"));
        return d.content ?? [];
    } catch {
        return [];
    }
}

async function main() {
    const deviations = await loadDeviations();
    const acceptedFor = (route, field) =>
        deviations.find((d) => d.pages.includes(route) && d.fields.includes(field));

    const oldData = await load(OLD);
    const newData = await load(NEW);
    // Canonical URLs are absolute and point at production - reduce both to paths.
    const findings = [];

    const routes = [...new Set([...Object.keys(oldData.content), ...Object.keys(newData.content)])];

    for (const route of routes) {
        const o = oldData.content[route];
        const n = newData.content[route];
        const add = (severity, field, detail) => {
            const accepted = acceptedFor(route, field);
            findings.push({
                route,
                severity: accepted ? "DEVIATION" : severity,
                field,
                detail: accepted ? accepted.reason : detail,
            });
        };

        if (!n) { add("CRITICAL", "page", "page missing in the new version"); continue; }
        if (!o) { add("WARNING", "page", "page did not exist in the old version"); continue; }

        // HTTP status - a 404 must stay a 404, everything else 200.
        if (oldData.statuses[route] !== newData.statuses[route])
            add("CRITICAL", "HTTP status", `${oldData.statuses[route]} → ${newData.statuses[route]}`);

        // SEO: fields where drift genuinely costs search rankings.
        for (const f of ["title", "description", "lang", "robots", "ogTitle", "ogDescription"]) {
            if (o[f] !== n[f]) add(f === "title" || f === "description" ? "CRITICAL" : "WARNING", f, `„${o[f]}” → „${n[f]}”`);
        }
        for (const f of ["canonical", "ogImage"]) {
            const ov = normUrl(o[f]), nv = normUrl(n[f]);
            if (ov !== nv) add("CRITICAL", f, `"${ov}" -> "${nv}"`);
        }

        // Heading structure - a different H1/H2 hierarchy is an SEO change, not cosmetics.
        if (!eq(o.h1, n.h1)) add("CRITICAL", "H1", `${JSON.stringify(o.h1)} → ${JSON.stringify(n.h1)}`);
        if (!eq(o.headings, n.headings)) {
            const d = diffArrays(o.headings, n.headings);
            add("CRITICAL", "headings", `missing: ${JSON.stringify(d.missing)}; extra: ${JSON.stringify(d.added)}`);
        }

        // JSON-LD compared structurally, after normalising URLs and key order.
        if (!eq(normalize(o.jsonLd), normalize(n.jsonLd)))
            add("CRITICAL", "JSON-LD", `old: ${JSON.stringify(normalize(o.jsonLd)).slice(0, 600)}\nnew: ${JSON.stringify(normalize(n.jsonLd)).slice(0, 600)}`);

        // CTAs: contact links are often the only conversion path on the site.
        if (!eq([...o.ctas].sort(), [...n.ctas].sort())) {
            const d = diffArrays(o.ctas, n.ctas);
            add("CRITICAL", "CTA links", `missing: ${JSON.stringify(d.missing)}; extra: ${JSON.stringify(d.added)}`);
        }

        // Internal links - catches lost redirects and typos in slugs.
        const d = diffArrays([...new Set(o.links)], [...new Set(n.links)]);
        if (d.missing.length || d.added.length)
            add("WARNING", "links", `missing: ${JSON.stringify(d.missing)}; extra: ${JSON.stringify(d.added)}`);

        // Site icons (favicon). A missing entry means the browser tab shows the
        // default WordPress logo instead of the client's.
        if (!eq(o.ikony, n.ikony)) {
            add("CRITICAL", "site icons", `${JSON.stringify(o.ikony)} → ${JSON.stringify(n.ikony)}`);
        }

        // Image alt text and filenames.
        const oAlt = o.images.map((i) => i.alt), nAlt = n.images.map((i) => i.alt);
        if (!eq(oAlt, nAlt)) add("WARNING", "image alt text", `${JSON.stringify(oAlt)} -> ${JSON.stringify(nAlt)}`);
        if (o.images.length !== n.images.length) add("CRITICAL", "image count", `${o.images.length} -> ${n.images.length}`);

        // Visible text - the last safety net for lost content.
        if (o.bodyText !== n.bodyText) {
            const ow = o.bodyText.split(" "), nw = n.bodyText.split(" ");
            const missing = ow.filter((w) => !nw.includes(w));
            add(missing.length ? "CRITICAL" : "WARNING", "page text",
                `length ${ow.length} -> ${nw.length} words; missing fragments: ${JSON.stringify(missing.slice(0, 40))}`);
        }
    }

    const crit = findings.filter((f) => f.severity === "CRITICAL");
    const accepted = findings.filter((f) => f.severity === "DEVIATION");
    await mkdir(OUT, { recursive: true });
    await writeFile(path.join(OUT, "content.html"), `<!doctype html><meta charset="utf-8">
<title>Content and SEO diff</title>
<style>body{font:14px system-ui;margin:2rem;max-width:1100px}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #ddd;padding:6px 10px;text-align:left;vertical-align:top}
td:last-child{font:12px ui-monospace,monospace;white-space:pre-wrap;word-break:break-word;max-width:520px}
.CRITICAL td{background:#fdf0f0}.WARNING td{background:#fffbe9}.DEVIATION td{background:#eef4fd}
.sum{padding:1rem;border-radius:8px;margin:1rem 0;font-weight:600}</style>
<h1>Content and SEO diff: Next.js vs WordPress</h1>
<div class="sum" style="background:${crit.length ? "#fdf0f0" : "#f2fbf3"}">
${crit.length ? `${crit.length} critical differences` : "No critical differences"} - ${findings.length} findings total, including ${accepted.length} approved deviations</div>
${findings.length ? `<table><tr><th>Page</th><th>Severity</th><th>Field</th><th>Details</th></tr>
${findings.map((f) => `<tr class="${f.severity}"><td>${f.route}</td><td>${f.severity}</td><td>${f.field}</td><td>${String(f.detail).replace(/</g, "&lt;")}</td></tr>`).join("\n")}</table>` : "<p>Everything matches.</p>"}`);

    console.log(`\nRaport: ${path.join(OUT, "content.html")}`);
    for (const f of crit) console.log(`  CRITICAL ${f.route} - ${f.field}`);
    for (const f of accepted) console.log(`  DEVIATION ${f.route} - ${f.field}`);
    console.log(crit.length
        ? `\n${crit.length} critical differences`
        : `\nOK: no critical differences (${accepted.length} approved deviations, ${findings.length - accepted.length} warnings)`);
    process.exit(crit.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
