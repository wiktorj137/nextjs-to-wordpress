// Screenshots of every route at 3 widths, plus a capture of DOM/SEO structure.
// Usage: node capture.mjs --base http://localhost:3000 --out snapshots/old
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

// Silences what naturally differs between two runs and is not a regression.
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
            // Site icons - easy to miss in a migration, and visible in the browser tab.
            ikony: Array.from(document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]'))
                .map((el) => ({ rel: el.getAttribute("rel"), sizes: el.getAttribute("sizes"), type: el.getAttribute("type"), plik: (el.getAttribute("href") || "").split("/").pop().split("?")[0] })),
            lang: document.documentElement.lang,
            h1: txt("h1"),
            headings: Array.from(document.querySelectorAll("h1,h2,h3,h4")).map((el) => `${el.tagName}: ${el.textContent.trim().replace(/\s+/g, " ")}`),
            // Visible text - catches lost or mangled content.
            bodyText: document.body.innerText.replace(/\s+/g, " ").trim(),
            // Internal links and CTAs (tel:, wa.me) - the most common source of silent breakage.
            links: attr("a[href]", "href").map((h) => { try { return new URL(h, location.href).pathname + (h.startsWith("tel:") || h.startsWith("mailto:") ? h : ""); } catch { return h; } }),
            ctas: attr('a[href^="tel:"], a[href*="wa.me"], a[href^="mailto:"]', "href"),
            images: Array.from(document.querySelectorAll("img")).map((el) => ({
                alt: el.getAttribute("alt"),
                file: (el.currentSrc || el.src || "").split("/").pop()?.split("?")[0] ?? null,
                loading: el.getAttribute("loading"),
            })),
            // JSON-LD is compared structurally, not as text.
            jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
                .map((el) => { try { return JSON.parse(el.textContent); } catch { return { __parseError: el.textContent.slice(0, 200) }; } })
                .sort((a, b) => String(a["@type"]).localeCompare(String(b["@type"]))),
        };
    });
}

async function main() {
    let routes = JSON.parse(await readFile(new URL("./routes.json", import.meta.url), "utf8"));
    // --only lets you compare single routes while working, without a full run.
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
            // Scrolling to the bottom triggers every on-scroll animation, then we return to the top.
            await page.evaluate(async () => {
                for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); }
                window.scrollTo(0, 0);
            });
            await page.waitForTimeout(500);

            // Disable lazy-loading and wait until every image is DECODED.
            // "complete" alone is not enough: in fullPage captures large files
            // are often loaded but not yet painted, which produced false
            // differences across whole cards.
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

    // With --only, merge into what is already there: otherwise capturing one route
    // would wipe the others and the content diff would compare empty sets.
    let merged = { base: BASE, statuses, content };
    if (args.only) {
        try {
            const prev = JSON.parse(await readFile(path.join(OUT, "content.json"), "utf8"));
            merged = {
                base: BASE,
                statuses: { ...prev.statuses, ...statuses },
                content: { ...prev.content, ...content },
            };
        } catch { /* first run */ }
    }

    await writeFile(path.join(OUT, "content.json"), JSON.stringify(merged, null, 2));
    await browser.close();
    console.log(`\nSaved to ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
