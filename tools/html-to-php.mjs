// Zamienia statyczny eksport Next.js na szkielet motywu WordPress.
// Instead of retyping thousands of lines of TSX by hand, take the generated HTML
// (exactly what the browser sees) and slice it mechanically.
//
// Usage: node html-to-php.mjs --in ../reference-nextjs/out --out ../theme
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith("--") ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), [])
);
const IN = args.in || "../reference-nextjs/out";
const OUT = args.out || "../theme";

// The export-file -> template/route mapping comes from the project config.
const CONFIG = JSON.parse(await readFile(args.config || "../migration.config.json", "utf8"));
const ROUTE_MAP = Object.fromEntries(
    Object.entries(CONFIG.routes).filter(([k]) => !k.startsWith("_"))
);
const PREFIX = CONFIG.prefix || "motyw";

const hash = (s) => createHash("sha1").update(s).digest("hex").slice(0, 12);

/**
 * framer-motion renders its initial state as an inline style: opacity:0 plus a
 * transform (translateY, translateX, scale, scaleX depending on the section).
 * A static export freezes that permanently, so without JS the page would be BLANK.
 * Not hypothetically: the first visual test showed an entirely black section.
 *
 * Convert those two declarations into a data-reveal attribute, preserving any others
 * (e.g. font-size). CSS controls visibility - visible by default - and an
 * IntersectionObserver adds the animation only once JS is running.
 */
function convertMotionStyles(html) {
    let count = 0;

    const out = html.replace(/style="([^"]*opacity:0[^"]*)"/g, (whole, style) => {
        const decls = style.split(";").map((d) => d.trim()).filter(Boolean);

        const transform = decls.find((d) => d.startsWith("transform:"));
        const rest = decls.filter((d) => !d.startsWith("transform:") && !/^opacity:\s*0$/.test(d));

        // Without opacity:0 this is not an animation start state - leave it alone.
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
        // Next runtime and hydration scripts - no equivalent in WordPress.
        .replace(/<script[^>]*>[\s\S]*?<\/script>/g, "")
        .replace(/<script[^>]*\/>/g, "")
        // Suspense boundary markers and the empty hydration container.
        .replace(/<!--\$-->|<!--\/\$-->|<!--\$\?-->|<!--\$!-->/g, "")
        .replace(/<div hidden="">\s*<\/div>/g, "")
        .replace(/<template[\s\S]*?<\/template>/g, "")
        // React/Next-specific attributes - they do not affect appearance.
        .replace(/\s(?:data-precedence|data-nscript|fetchPriority)="[^"]*"/g, "")
        .replace(/\s(?:data-reactroot)(?:="[^"]*")?/g, "");
}

function extractJsonLd(html) {
    const out = [];
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        try { out.push(JSON.parse(m[1])); } catch { /* skip malformed block */ }
    }
    return out;
}

// next/font class names are hash-generated - the theme replaces them with its own.
const FONT_CLASS_RE = /\b(?:inter|syne|outfit)_[0-9a-f]+-module__[A-Za-z0-9_]+__variable\s*/g;

function section(html, tag) {
    const start = html.indexOf(`<${tag}`);
    if (start === -1) return null;
    // A simple nesting counter - sufficient for a well-formed export.
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
    if (missing.length) console.warn(`Warning - missing from export: ${missing.join(", ")}`);

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

        // Images live in the theme (assets/img), not the media library: they are layout
        // elements the client does not change. Rewrite the paths into a PHP call.
        body = body.replace(
            /(<img[^>]*?\ssrc=")\/((?:cars\/)?[^"]+\.(?:png|jpe?g|webp|svg))"/g,
            '$1<?php echo esc_url( ${PREFIX}_img( \'$2\' ) ); ?>"'
        );

        const nav = section(body, "nav");
        const footer = section(body, "footer");
        const main = section(body, "main");

        if (nav) navHashes.set(file, hash(nav.html));
        if (nav && !firstNav) firstNav = nav.html;

        // The footer has two padding variants: pages with a mobile CTA bar use
        // "pb-28 lg:pb-8", the rest "pb-8". Reduce that to one footer driven by a
        // variable instead of keeping two nearly identical partials.
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

        // Only <main> stays in the page template - header and footer are partials.
        let inner = main ? main.html : body;

        // In the original the nav sits INSIDE <main>. Since it also went into
        // header.php, leaving it here would render it twice. Nothing is visible
        // (the nav is position:fixed, so the copies stack perfectly), but the DOM is
        // duplicated, screen readers announce the menu twice, and scripts only ever
        // find the first copy. The content diff caught this.
        if (nav && inner.includes(nav.html)) {
            inner = inner.replace(nav.html, "");
            navStripped++;
        }
        const php = `<?php
/**
 * Wygenerowane automatycznie z ${file} przez tools/html-to-php.mjs
 * Trasa: ${meta.route}
 *
 * MANUAL STEP: swap the content for fields (the_field/get_field).
 * DO NOT change markup structure or classes - the visual test depends on it.
 */
${nav ? "" : `// The original rendered this page without navigation - the only such case.
// Must be set BEFORE get_header(), because that is what emits the nav.
${PREFIX}_set_nav( false );
`}get_header();
${hasMobileCta === false ? `
// This page has no mobile CTA bar, so the footer uses smaller bottom padding
// (pb-8 instead of pb-28). Without this the page is 80px taller than the original.
${PREFIX}_set_mobile_cta( false );
` : ""}?>
${inner}
<?php get_footer(); ?>
`;
        // Several pages may share one template (e.g. all products). Use the page with
        // the RICHEST content as the source - a template generated from an entry with
        // no FAQ would have nothing to wire a field into.
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

    // Header and footer are identical across pages -> one partial, not N copies.
    const navUnique = new Set(navHashes.values());
    const footerUnique = new Set(footerHashes.values());

    await writeFile(path.join(OUT, "header.php"), `<?php
/** Generated automatically. The header is shared across all ${navHashes.size} pages. */
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
 * Generated automatically. The footer is shared across all ${footerHashes.size} pages.
 * The mobile CTA bar affects the footer's bottom padding. Page templates disable it
 * via ${PREFIX}_set_mobile_cta( false ) - a plain variable would never arrive here,
 * because WordPress loads each template in its own scope.
 */
$mobile_cta = ${PREFIX}_show_mobile_cta();
?>
${firstFooter ?? "<!-- nie znaleziono <footer> -->"}
<?php
// Components the original rendered client-side only - absent from the static
// export, so they come from tools/extract-client-only.mjs.
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

    console.log(`Generated ${manifest.length} templates in ${OUT}`);
    console.log(`  header: ${navUnique.size === 1 ? "identical on every page" : `WARNING - ${navUnique.size} variants, check manually`}`);
    console.log(`  footer: ${footerUnique.size === 1 ? "identical after padding normalisation" : `WARNING - ${footerUnique.size} variants, check manually`}`);
    const noCta = manifest.filter((m) => m.mobileCta === false).map((m) => m.route);
    console.log(`  no mobile CTA bar: ${noCta.join(", ") || "none"}`);
    const byTemplate = manifest.reduce((a, m) => ({ ...a, [m.template]: (a[m.template] ?? 0) + 1 }), {});
    for (const [t, n] of Object.entries(byTemplate)) {
        const src = templateCandidates.get(t);
        const note = n > 1 ? `pages (shared, source: ${src?.slug}, ${src?.richness} FAQ)` : "page";
        console.log(`  ${t}.php ← ${n} ${note}`);
    }
    console.log(`  nav: stripped from ${navStripped} templates (it lives inside <main> in the original)`);
    console.log(`  entry animations: ${revealTotal} elements moved from inline opacity:0 to data-reveal`);
    console.log(`\n${(manifest.reduce((a, m) => a + m.bytes, 0) / 1024).toFixed(0)} kB of markup moved without any hand-retyping.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
