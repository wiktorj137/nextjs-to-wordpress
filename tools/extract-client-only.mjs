// Extracts components that are ABSENT from the static export.
//
// Some React components only render client-side (a consent banner checks
// localStorage, a sticky CTA bar reacts to scroll). They are invisible in the
// export, so a template generator skips them and the migrated site quietly loses
// functionality. This script reads them from the LIVE old site instead.
//
// Usage: node extract-client-only.mjs --base http://localhost:3000 --out ../theme/template-parts
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith("--") ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), [])
);
const BASE = (args.base || "http://localhost:3000").replace(/\/$/, "");
const OUT = args.out || "../theme/template-parts";

// Client-only components, declared in the project config.
const CONFIG = JSON.parse(await readFile(args.config || "../migration.config.json", "utf8"));

const TARGETS = Object.entries(CONFIG.clientOnlyComponents ?? {})
    .filter(([name]) => !name.startsWith("_"))
    .map(([name, cfg]) => ({
        name,
        viewport: cfg.viewport,
        findSource: cfg.find,
        wire: (html) => (cfg.wire ?? []).reduce(
            (acc, r) => acc.replace(r.regex ? new RegExp(r.search) : r.search, r.replace),
            html
        ),
    }));

async function main() {
    await mkdir(OUT, { recursive: true });
    const browser = await chromium.launch();
    const found = [];

    for (const target of TARGETS) {
        const ctx = await browser.newContext({ viewport: target.viewport ?? { width: 1440, height: 900 } });
        const page = await ctx.newPage();
        await page.goto(BASE + "/", { waitUntil: "networkidle" });
        // Scrolling triggers components that depend on page position.
        await page.evaluate(() => window.scrollTo(0, 600));
        await page.waitForTimeout(800);

        // page.evaluate serializes its result — a DOM element comes back as an empty
        // object, so return outerHTML from inside the browser.
        const html = await page.evaluate(`(() => (${target.findSource}))()?.outerHTML ?? null`);
        await ctx.close();

        if (!html) {
            console.log(`  ${target.name}: NOT FOUND — check the selector`);
            continue;
        }

        const wired = target.wire ? target.wire(html) : html;
        const file = path.join(OUT, `${target.name}.php`);
        await writeFile(file, `<?php
/**
 * ${target.name} — extracted from the live Next.js site by tools/extract-client-only.mjs.
 *
 * This component only rendered client-side, so it is NOT present in the static
 * export. Without this step it would disappear in the migration without a trace.
 *
 * Behaviour is handled by assets/js/main.js.
 */
defined( 'ABSPATH' ) || exit;
?>
${wired}
`);
        found.push(target.name);
        if (/(?:tel:|wa\.me)/.test(wired)) {
            console.log(`    WARNING: ${target.name} contains a hardcoded contact value — replace it with a field call`);
        }
        console.log(`  ${target.name}: ${(html.length / 1024).toFixed(1)} kB → ${file}`);
    }

    await browser.close();
    console.log(`\nExtracted ${found.length}/${TARGETS.length} client-only components.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
