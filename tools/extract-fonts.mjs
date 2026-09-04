// Przenosi fonty z builda Next do motywu.
//
// Nie pobieramy fontów z Google — bierzemy dokładnie te pliki, które serwowała
// stara strona, razem z regułami @font-face i metrykami fallbacku (size-adjust,
// ascent-override). To one decydują o tym, że tekst nie przeskakuje przed
// załadowaniem fontu, więc kopiowanie ich 1:1 jest warunkiem zgodności układu.
//
// Użycie: node extract-fonts.mjs --next ../reference-nextjs --out ../theme/assets
import { readFile, writeFile, mkdir, copyFile, readdir } from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith("--") ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), [])
);
const NEXT = args.next || "../reference-nextjs";
const OUT = args.out || "../theme/assets";

async function main() {
    const chunkDir = path.join(NEXT, ".next", "static", "chunks");
    const mediaDir = path.join(NEXT, ".next", "static", "media");

    const cssFiles = (await readdir(chunkDir)).filter((f) => f.endsWith(".css"));
    let css = "";
    for (const f of cssFiles) css += await readFile(path.join(chunkDir, f), "utf8");

    const faces = css.match(/@font-face\{[^}]*\}/g) ?? [];
    if (!faces.length) throw new Error("Nie znaleziono reguł @font-face — czy projekt Next jest zbudowany?");

    await mkdir(path.join(OUT, "fonts"), { recursive: true });

    const used = new Set();
    const rewritten = faces.map((face) =>
        face.replace(/url\((?:\.\.\/)*media\/([^)]+)\)/g, (_, file) => {
            used.add(file);
            return `url("../fonts/${file}")`;
        })
    );

    for (const file of used) {
        await copyFile(path.join(mediaDir, file), path.join(OUT, "fonts", file));
    }

    const out = `/*
 * Wygenerowane automatycznie przez tools/extract-fonts.mjs — nie edytować ręcznie.
 * Fonty i metryki fallbacku pochodzą wprost z builda Next.js, żeby typografia
 * zgadzała się co do piksela.
 */

/* Zmienne fontów.
 * UWAGA: w oryginale klasa Syne ustawiała --font-outfit zamiast --font-syne
 * (literówka w next/font), przez co --font-syne w ogóle nie istniało i Syne
 * renderowało się z wartości zapasowej w @theme. Tutaj zmienne są poprawne —
 * efekt wizualny po załadowaniu fontów jest identyczny. */
:root {
  --font-inter: "Inter", "Inter Fallback", sans-serif;
  --font-syne: "Syne", "Syne Fallback", sans-serif;
  --font-outfit: "Outfit", "Outfit Fallback", sans-serif;
}

${rewritten.join("\n")}
`;

    await mkdir(path.join(OUT, "css"), { recursive: true });
    await writeFile(path.join(OUT, "css", "fonts.css"), out);

    const families = [...new Set(faces.map((f) => f.match(/font-family:([^;]+)/)?.[1]))].filter(Boolean);
    console.log(`Przeniesiono ${used.size} plików woff2 i ${faces.length} reguł @font-face`);
    console.log(`  rodziny: ${families.join(", ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
