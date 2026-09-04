// Pixel-by-pixel comparison of old and new screenshots. Produces an HTML report.
// Usage: node diff-visual.mjs [--old snapshots/old] [--new snapshots/new] [--threshold 0.1]
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
// Maximum share of differing pixels allowed per page.
const THRESHOLD = Number(args.threshold ?? 0.1);
// Per-pixel colour tolerance (absorbs font antialiasing).
const PIXEL_TOLERANCE = 0.15;

// Pads both images to the same size. A height difference is a failure in itself,
// but we still want to see WHERE they diverge.
function pad(png, width, height) {
    if (png.width === width && png.height === height) return png;
    const out = new PNG({ width, height });
    out.data.fill(0);
    PNG.bitblt(png, out, 0, 0, Math.min(png.width, width), Math.min(png.height, height), 0, 0);
    return out;
}

/** Approved deviations - see deviations.json and docs/TESTING.md. */
async function loadDeviations() {
    try {
        const d = JSON.parse(await readFile(new URL("./deviations.json", import.meta.url), "utf8"));
        return d.visual ?? [];
    } catch {
        return [];
    }
}

async function main() {
    const deviations = await loadDeviations();

    /** Raised tolerance for an approved deviation, if one applies. */
    const allowanceFor = (vp, page) => {
        const hit = deviations.find((d) => d.pages.includes(page) && d.widths.includes(vp));
        return hit ? { limit: hit.tolerance, reason: hit.reason } : null;
    };

    const results = [];
    let viewports;
    try {
        viewports = (await readdir(OLD, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
        console.error(`Directory ${OLD} not found. Run capture.mjs first.`);
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
                results.push({ vp, file, status: "FAIL", note: `${newPath} not found` });
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
            if (pct > limit || heightDelta >= 8) status = "FAIL";
            else if (allow && pct > THRESHOLD) status = "DEVIATION";

            results.push({
                vp,
                file,
                pct: Number(pct.toFixed(4)),
                changed,
                heightDelta,
                status,
                reason: status === "DEVIATION" ? allow.reason : null,
                diffFile: pct > 0 ? `diff/${diffFile}` : null,
            });
        }
    }

    results.sort((x, y) => (y.pct ?? 100) - (x.pct ?? 100));
    const failed = results.filter((r) => r.status === "FAIL");
    const accepted = results.filter((r) => r.status === "DEVIATION");

    const rows = results.map((r) => `<tr class="${r.status === "OK" ? "ok" : r.status === "DEVIATION" ? "dev" : "bad"}">
      <td>${r.vp}</td><td>${r.file.replace(".png", "")}</td>
      <td>${r.pct ?? "—"}%</td><td>${r.changed ?? "—"}</td><td>${r.heightDelta ?? "—"}px</td>
      <td>${r.status}${r.reason ? `<br><span style="font-weight:400;font-size:11px;color:#666">${r.reason}</span>` : ""}</td>
      <td>${r.diffFile ? `<a href="${r.diffFile}">view</a>` : ""}</td></tr>`).join("\n");

    await writeFile(path.join(OUT, "visual.html"), `<!doctype html><meta charset="utf-8">
<title>Visual diff</title>
<style>body{font:14px system-ui;margin:2rem;max-width:1000px}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #ddd;padding:6px 10px;text-align:left}.ok td{background:#f2fbf3}.bad td{background:#fdf0f0}.dev td{background:#fffbe9}
h1{margin-bottom:.2rem} .sum{padding:1rem;border-radius:8px;margin:1rem 0;font-weight:600}</style>
<h1>Visual diff: Next.js vs WordPress</h1>
<p>Threshold: ${THRESHOLD}% of pixels per page. Per-pixel colour tolerance: ${PIXEL_TOLERANCE}.</p>
<div class="sum" style="background:${failed.length ? "#fdf0f0" : "#f2fbf3"}">
${failed.length ? `${failed.length} / ${results.length} screenshots over threshold` : `All ${results.length} screenshots within threshold`}${accepted.length ? ` (including ${accepted.length} approved deviations)` : ""}</div>
<table><tr><th>Width</th><th>Page</th><th>Diff</th><th>Pixels</th><th>Height delta</th><th>Status</th><th></th></tr>
${rows}</table>`);

    console.log(`\nRaport: ${path.join(OUT, "visual.html")}`);
    for (const r of failed) console.log(`  FAIL ${r.vp}/${r.file} - ${r.pct ?? r.note}% (height delta ${r.heightDelta}px)`);
    for (const r of accepted) console.log(`  DEVIATION ${r.vp}/${r.file} - ${r.pct}% (approved)`);
    console.log(failed.length
        ? `\n${failed.length}/${results.length} over threshold`
        : `\nOK: ${results.length}/${results.length} (including ${accepted.length} approved deviations)`);
    process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
