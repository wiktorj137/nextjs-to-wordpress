// Porównanie pixel-by-pixel zrzutów starej i nowej strony. Generuje raport HTML.
// Użycie: node diff-visual.mjs [--old snapshots/old] [--new snapshots/new] [--threshold 0.1]
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith("--") ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), [])
);
const OLD = args.old || "snapshots/old";
const NEW = args.new || "snapshots/new";
const OUT = args.report || "report";
// Maksymalny dopuszczalny odsetek różniących się pikseli na stronę.
const THRESHOLD = Number(args.threshold ?? 0.1);
// Tolerancja różnicy koloru pojedynczego piksela (antyaliasing fontów).
const PIXEL_TOLERANCE = 0.15;

// Dopasowuje wysokość obu obrazów — różnica wysokości sama w sobie jest błędem,
// ale chcemy jeszcze zobaczyć GDZIE się rozjeżdża.
function pad(png, width, height) {
    if (png.width === width && png.height === height) return png;
    const out = new PNG({ width, height });
    out.data.fill(0);
    PNG.bitblt(png, out, 0, 0, Math.min(png.width, width), Math.min(png.height, height), 0, 0);
    return out;
}

/** Zatwierdzone odstępstwa — patrz odstepstwa.json i ODSTEPSTWA.md. */
async function loadDeviations() {
    try {
        const d = JSON.parse(await readFile(new URL("./odstepstwa.json", import.meta.url), "utf8"));
        return d.wizualne ?? [];
    } catch {
        return [];
    }
}

async function main() {
    const deviations = await loadDeviations();

    /** Podwyższona tolerancja dla zatwierdzonego odstępstwa, jeśli takie istnieje. */
    const allowanceFor = (vp, page) => {
        const hit = deviations.find((d) => d.strony.includes(page) && d.szerokosci.includes(vp));
        return hit ? { limit: hit.tolerancja, powod: hit.powod } : null;
    };

    const results = [];
    let viewports;
    try {
        viewports = (await readdir(OLD, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
        console.error(`Brak katalogu ${OLD}. Najpierw uruchom capture.mjs.`);
        process.exit(1);
    }

    await mkdir(path.join(OUT, "diff"), { recursive: true });

    for (const vp of viewports) {
        const files = (await readdir(path.join(OLD, vp))).filter((f) => f.endsWith(".png"));
        for (const file of files) {
            const oldPath = path.join(OLD, vp, file);
            const newPath = path.join(NEW, vp, file);
            let a, b;
            try {
                a = PNG.sync.read(await readFile(oldPath));
                b = PNG.sync.read(await readFile(newPath));
            } catch {
                results.push({ vp, file, status: "BRAK", note: `nie znaleziono ${newPath}` });
                continue;
            }

            const width = Math.max(a.width, b.width);
            const height = Math.max(a.height, b.height);
            const heightDelta = Math.abs(a.height - b.height);
            const pa = pad(a, width, height);
            const pb = pad(b, width, height);
            const diff = new PNG({ width, height });

            const changed = pixelmatch(pa.data, pb.data, diff.data, width, height, {
                threshold: PIXEL_TOLERANCE,
                includeAA: false,
                alpha: 0.2,
            });
            const pct = (changed / (width * height)) * 100;
            const diffFile = `${vp}__${file}`;
            if (pct > 0) await writeFile(path.join(OUT, "diff", diffFile), PNG.sync.write(diff));

            const page = file.replace(".png", "");
            const allow = allowanceFor(vp, page);
            const limit = allow ? allow.limit : THRESHOLD;

            let status = "OK";
            if (pct > limit || heightDelta >= 8) status = "BŁĄD";
            else if (allow && pct > THRESHOLD) status = "ODSTĘPSTWO";

            results.push({
                vp,
                file,
                pct: Number(pct.toFixed(4)),
                changed,
                heightDelta,
                status,
                powod: status === "ODSTĘPSTWO" ? allow.powod : null,
                diffFile: pct > 0 ? `diff/${diffFile}` : null,
            });
        }
    }

    results.sort((x, y) => (y.pct ?? 100) - (x.pct ?? 100));
    const failed = results.filter((r) => r.status === "BŁĄD");
    const accepted = results.filter((r) => r.status === "ODSTĘPSTWO");

    const rows = results.map((r) => `<tr class="${r.status === "OK" ? "ok" : r.status === "ODSTĘPSTWO" ? "dev" : "bad"}">
      <td>${r.vp}</td><td>${r.file.replace(".png", "")}</td>
      <td>${r.pct ?? "—"}%</td><td>${r.changed ?? "—"}</td><td>${r.heightDelta ?? "—"}px</td>
      <td>${r.status}${r.powod ? `<br><span style="font-weight:400;font-size:11px;color:#666">${r.powod}</span>` : ""}</td>
      <td>${r.diffFile ? `<a href="${r.diffFile}">podgląd</a>` : ""}</td></tr>`).join("\n");

    await writeFile(path.join(OUT, "visual.html"), `<!doctype html><meta charset="utf-8">
<title>Przykład — diff wizualny</title>
<style>body{font:14px system-ui;margin:2rem;max-width:1000px}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #ddd;padding:6px 10px;text-align:left}.ok td{background:#f2fbf3}.bad td{background:#fdf0f0}.dev td{background:#fffbe9}
h1{margin-bottom:.2rem} .sum{padding:1rem;border-radius:8px;margin:1rem 0;font-weight:600}</style>
<h1>Diff wizualny: Next.js vs WordPress</h1>
<p>Próg: ${THRESHOLD}% pikseli na stronę. Tolerancja koloru piksela: ${PIXEL_TOLERANCE}.</p>
<div class="sum" style="background:${failed.length ? "#fdf0f0" : "#f2fbf3"}">
${failed.length ? `${failed.length} / ${results.length} zrzutów poza progiem` : `Wszystkie ${results.length} zrzutów w progu`}${accepted.length ? ` (w tym ${accepted.length} zatwierdzonych odstępstw)` : ""}</div>
<table><tr><th>Szerokość</th><th>Strona</th><th>Różnica</th><th>Piksele</th><th>Δ wysokości</th><th>Status</th><th></th></tr>
${rows}</table>`);

    console.log(`\nRaport: ${path.join(OUT, "visual.html")}`);
    for (const r of failed) console.log(`  BŁĄD ${r.vp}/${r.file} — ${r.pct ?? r.note}% (Δh ${r.heightDelta}px)`);
    for (const r of accepted) console.log(`  ODSTĘPSTWO ${r.vp}/${r.file} — ${r.pct}% (zatwierdzone)`);
    console.log(failed.length
        ? `\n${failed.length}/${results.length} poza progiem`
        : `\nOK: ${results.length}/${results.length} (w tym ${accepted.length} zatwierdzonych odstępstw)`);
    process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
