// Zrzuty ekranu wszystkich tras w 3 szerokościach + zrzut struktury DOM/SEO.
// Użycie: node capture.mjs --base http://localhost:3000 --out snapshots/old
import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

export const VIEWPORTS = [
    { name: "mobile", width: 375, height: 812 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 900 },
];

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith("--") ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), [])
);
const BASE = (args.base || "http://localhost:3000").replace(/\/$/, "");
const OUT = args.out || "snapshots/out";

export const slug = (route) => (route === "/" ? "home" : route.replace(/^\/|\/$/g, "").replace(/\//g, "__"));

// Wycisza to, co z natury różni się między dwoma uruchomieniami i nie jest regresją.
const FREEZE_CSS = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    animation-duration: 0s !important;
    transition-duration: 0s !important;
    caret-color: transparent !important;
  }
  html { scroll-behavior: auto !important; }
`;

async function collectContent(page) {
    return page.evaluate(() => {
        const txt = (sel) => Array.from(document.querySelectorAll(sel)).map((el) => el.textContent.trim().replace(/\s+/g, " "));
        const attr = (sel, a) => Array.from(document.querySelectorAll(sel)).map((el) => el.getAttribute(a));
        return {
            title: document.title,
            description: document.querySelector('meta[name="description"]')?.content ?? null,
            canonical: document.querySelector('link[rel="canonical"]')?.href ?? null,
            robots: document.querySelector('meta[name="robots"]')?.content ?? null,
            ogTitle: document.querySelector('meta[property="og:title"]')?.content ?? null,
            ogDescription: document.querySelector('meta[property="og:description"]')?.content ?? null,
            ogImage: document.querySelector('meta[property="og:image"]')?.content ?? null,
            // Ikony strony — łatwo je przeoczyć przy migracji, a widać je w karcie przeglądarki.
            ikony: Array.from(document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]'))
                .map((el) => ({ rel: el.getAttribute("rel"), sizes: el.getAttribute("sizes"), type: el.getAttribute("type"), plik: (el.getAttribute("href") || "").split("/").pop().split("?")[0] })),
            lang: document.documentElement.lang,
            h1: txt("h1"),
            headings: Array.from(document.querySelectorAll("h1,h2,h3,h4")).map((el) => `${el.tagName}: ${el.textContent.trim().replace(/\s+/g, " ")}`),
            // Widoczny tekst — łapie zgubione lub przekręcone treści.
            bodyText: document.body.innerText.replace(/\s+/g, " ").trim(),
            // Linki wewnętrzne + CTA (tel:, wa.me) — najczęstsze źródło cichych błędów po migracji.
            links: attr("a[href]", "href").map((h) => { try { return new URL(h, location.href).pathname + (h.startsWith("tel:") || h.startsWith("mailto:") ? h : ""); } catch { return h; } }),
            ctas: attr('a[href^="tel:"], a[href*="wa.me"], a[href^="mailto:"]', "href"),
            images: Array.from(document.querySelectorAll("img")).map((el) => ({
                alt: el.getAttribute("alt"),
                file: (el.currentSrc || el.src || "").split("/").pop()?.split("?")[0] ?? null,
                loading: el.getAttribute("loading"),
            })),
            // JSON-LD porównywany strukturalnie, nie jako tekst.
            jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
                .map((el) => { try { return JSON.parse(el.textContent); } catch { return { __parseError: el.textContent.slice(0, 200) }; } })
                .sort((a, b) => String(a["@type"]).localeCompare(String(b["@type"]))),
        };
    });
}

async function main() {
    let routes = JSON.parse(await readFile(new URL("./routes.json", import.meta.url), "utf8"));
    // --only pozwala porównać pojedyncze trasy w trakcie prac, bez czekania na komplet.
    if (args.only) {
        const wanted = args.only.split(",").map((r) => r.trim());
        routes = routes.filter((r) => wanted.includes(r));
    }
    const browser = await chromium.launch();
    const content = {};
    const statuses = {};

    for (const vp of VIEWPORTS) {
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
        await ctx.addInitScript(() => { window.__TEST__ = true; });
        const page = await ctx.newPage();

        for (const route of routes) {
            const url = BASE + route;
            const res = await page.goto(url, { waitUntil: "networkidle" });
            statuses[route] = res?.status() ?? 0;

            await page.addStyleTag({ content: FREEZE_CSS });
            // Przewinięcie do końca odpala wszystkie animacje "on scroll", potem wracamy na górę.
            await page.evaluate(async () => {
                for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); }
                window.scrollTo(0, 0);
            });
            await page.waitForTimeout(500);

            // Wyłączamy lazy-loading i czekamy aż każdy obraz będzie ZDEKODOWANY.
            // Samo "complete" nie wystarcza: przy zrzucie fullPage duże pliki
            // (tu kilka po ~4 MB) bywają wczytane, ale jeszcze nie namalowane,
            // co dawało fałszywe różnice na całych kafelkach.
            await page.evaluate(async () => {
                const imgs = Array.from(document.images);
                imgs.forEach((i) => { i.loading = "eager"; });
                await Promise.all(imgs.map((i) => i.decode().catch(() => {})));
            });
            await page.waitForTimeout(300);

            const dir = path.join(OUT, vp.name);
            await mkdir(dir, { recursive: true });
            await page.screenshot({ path: path.join(dir, `${slug(route)}.png`), fullPage: true });

            if (vp.name === "desktop") content[route] = await collectContent(page);
            process.stdout.write(`  ${vp.name} ${route} (${statuses[route]})\n`);
        }
        await ctx.close();
    }

    await mkdir(OUT, { recursive: true });

    // Przy --only scalamy z tym, co już jest — inaczej zrzut jednej trasy
    // kasowałby dane pozostałych i diff treści porównywałby puste zbiory.
    let merged = { base: BASE, statuses, content };
    if (args.only) {
        try {
            const prev = JSON.parse(await readFile(path.join(OUT, "content.json"), "utf8"));
            merged = {
                base: BASE,
                statuses: { ...prev.statuses, ...statuses },
                content: { ...prev.content, ...content },
            };
        } catch { /* pierwszy przebieg */ }
    }

    await writeFile(path.join(OUT, "content.json"), JSON.stringify(merged, null, 2));
    await browser.close();
    console.log(`\nZapisano do ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
