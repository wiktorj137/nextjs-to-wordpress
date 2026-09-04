// Wyciąga komponenty, których NIE MA w statycznym eksporcie.
//
// Część komponentów Reacta renderuje się dopiero po stronie klienta (baner cookies
// sprawdza localStorage, pasek CTA reaguje na scroll). W eksporcie ich nie widać,
// więc generator szablonów by je pominął — i strona po migracji cicho straciłaby
// funkcjonalność. Ten skrypt czyta je z ŻYWEJ starej strony.
//
// Użycie: node extract-client-only.mjs --base http://localhost:3000 --out ../theme/template-parts
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith("--") ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), [])
);
const BASE = (args.base || "http://localhost:3000").replace(/\/$/, "");
const OUT = args.out || "../theme/template-parts";

// Komponenty renderowane wyłącznie po stronie klienta — z konfiguracji projektu.
const CONFIG = JSON.parse(await readFile(args.config || "../migration.config.json", "utf8"));

const TARGETS = Object.entries(CONFIG.komponentyKlienckie ?? {})
    .filter(([name]) => !name.startsWith("_"))
    .map(([name, cfg]) => ({
        name,
        viewport: cfg.viewport,
        findSource: cfg.znajdz,
        wire: (html) => (cfg.podepnij ?? []).reduce(
            (acc, r) => acc.replace(r.regex ? new RegExp(r.szukaj) : r.szukaj, r.zamien),
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
        // Scroll wyzwala komponenty zależne od pozycji strony.
        await page.evaluate(() => window.scrollTo(0, 600));
        await page.waitForTimeout(800);

        // page.evaluate serializuje wynik — element DOM przechodzi jako pusty obiekt,
        // więc zwracamy outerHTML już po stronie przeglądarki.
        const html = await page.evaluate(`(() => (${target.findSource}))()?.outerHTML ?? null`);
        await ctx.close();

        if (!html) {
            console.log(`  ${target.name}: NIE ZNALEZIONO — sprawdź selektor`);
            continue;
        }

        const wired = target.wire ? target.wire(html) : html;
        const file = path.join(OUT, `${target.name}.php`);
        await writeFile(file, `<?php
/**
 * ${target.name} — wyciągnięte z żywej strony Next.js przez tools/extract-client-only.mjs.
 *
 * Ten komponent renderował się dopiero po stronie klienta, więc NIE MA GO
 * w statycznym eksporcie. Bez tego kroku zniknąłby po migracji bez śladu.
 *
 * Zachowanie obsługuje assets/js/main.js.
 */
defined( 'ABSPATH' ) || exit;
?>
${wired}
`);
        found.push(target.name);
        if (/(?:tel:|wa\.me)/.test(wired)) {
            console.log(`    UWAGA: ${target.name} zawiera zahardkodowany numer — podmień na <prefiks>_tel() / <prefiks>_whatsapp_url()`);
        }
        console.log(`  ${target.name}: ${(html.length / 1024).toFixed(1)} kB → ${file}`);
    }

    await browser.close();
    console.log(`\nWyciągnięto ${found.length}/${TARGETS.length} komponentów klienckich.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
