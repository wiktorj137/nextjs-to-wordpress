# Next.js → WordPress: metoda i narzędzia

Zestaw narzędzi i notatek z przeprowadzonej migracji strony Next.js na WordPressa
**bez przepisywania markupu z palca** i z mierzalnym dowodem, że wynik wygląda tak samo.

To nie jest gotowy produkt. To działający warsztat i — przede wszystkim — **zapis
tego, co poszło nie tak**, żeby następnym razem nie tracić na to czasu.

## Problem

Klient ma stronę w Next.js. Chce WordPressa, żeby samodzielnie zmieniać treści.
Strona ma wyglądać identycznie. Ręczne odtwarzanie w page builderze to kilka dni
pracy i pewność, że nie wyjdzie 1:1.

## Metoda w jednym zdaniu

Zbuduj statyczny eksport Next.js, potnij wygenerowany HTML na szablony PHP
mechanicznie, podmień w nich treść na pola edycyjne, a zgodność udowodnij
porównaniem zrzutów i danych SEO — nie oceną wzrokową.

## Wynik na realnym projekcie

Strona: 15 tras, 3 szablony współdzielone, ~4600 linii TSX.

| | |
|---|---|
| Markup przeniesiony automatem | **306 kB**, zero przepisywania ręcznego |
| 15 stron → | **10 szablonów** PHP |
| Test wizualny | 45/45 zrzutów w progu (8 zatwierdzonych odstępstw) |
| Test treści i SEO | 0 rozbieżności krytycznych |
| Lighthouse | 4 z 5 mierzonych stron bez zmiany (100/100) |
| Czas | ~2 dni zamiast szacowanych 7,5 |

Osiem odstępstw to **naprawione błędy oryginału**, nie niedoróbki migracji —
każde opisane z uzasadnieniem.

## Pipeline

```
export → theme → content → variants → guides → wire → css → import
```

| Krok | Narzędzie | Co robi |
|---|---|---|
| export | `next build` | statyczny HTML — źródło prawdy dla markupu |
| theme | `html-to-php.mjs` | HTML → szablony PHP, wspólny nagłówek i stopka |
| | `extract-fonts.mjs` | fonty i metryki fallbacku wprost z builda |
| | `extract-client-only.mjs` | komponenty renderowane tylko po stronie klienta |
| content | `extract-content.mjs` | metadane, FAQ, alty, CTA → JSON |
| variants | `find-variants.mjs` | **które teksty różnią się** między stronami o wspólnym szablonie |
| wire | `wire-fields.mjs` | podmiana treści na pola, powtórzeń na pętle `foreach` |
| css | Tailwind CLI | ten sam plik wejściowy, skanuje `.php` |
| import | `import.php` | wgranie treści przez WP-CLI, idempotentnie |

Kolejność nie jest przypadkowa: generowanie szablonów **nadpisuje pliki**,
więc podpinanie pól musi iść zaraz po nim. Dlatego wszystko siedzi w `Makefile`.

## Trzy pomysły, które okazały się kluczowe

**1. Nie przepisuj markupu — potnij wygenerowany HTML.**
Klasy Tailwinda i struktura DOM zostają nietknięte, więc nie ma gdzie zrobić literówki.
Efekt uboczny: gdy klient poprosi o zmianę na starej stronie w trakcie migracji,
nie tracisz pracy — regenerujesz.

**2. Wylicz, co ma być polem, zamiast zgadywać.**
Trzy strony na wspólnym szablonie różnią się tylko treścią. Porównanie sekwencji
tekstów daje dokładną listę pól: w tym projekcie **14 z 86** tekstów na stronach
kategorii i **20 z 88** na stronach lokalnych.

**3. Testuj w dwóch warstwach, bo jedna nie wystarczy.**
Diff pikselowy nie wykryje literówki w numerze telefonu. Diff treści nie wykryje
przycisku przesuniętego o 40 px. Potrzebne są obie — i obie znalazły błędy,
których druga nie widziała.

## Co ten warsztat wykrył

Błędy, których bez testów nikt by nie zauważył przed wdrożeniem:

- **strona bez JS renderowała się pusta** — framer-motion zapisywał `opacity:0`
  w atrybucie `style`, co w statycznym eksporcie zostawało na stałe
- **nawigacja renderowała się dwa razy** — niewidoczne wizualnie, bo `position: fixed`
  nakłada kopie idealnie, ale czytniki ekranu czytały menu dwukrotnie
- **link WhatsApp na każdej podstronie pytał o niewłaściwy produkt** — w szablonie
  współdzielonym został parametr ze strony wzorcowej
- **12 stron było o dokładnie 80 px wyższych** od oryginału
- **brak favicony** — WordPress podstawiał swoje domyślne logo

Pełna lista z przyczynami: [docs/PUŁAPKI.md](docs/PUŁAPKI.md).

## Start

```bash
cp migration.config.example.json migration.config.json
```

Wypełnij `trasy` (plik eksportu → szablon), uruchom `make theme`, potem
`make variants` — wypisze, które teksty się różnią. Te indeksy wpisujesz
do `mapaPol` i puszczasz `make wire`.

Szczegóły: [docs/METODA.md](docs/METODA.md) · [docs/TESTY.md](docs/TESTY.md)

## Dokąd to zmierza

Docelowo program, który przeprowadza to półautomatycznie. Co już jest gotowe,
a co wymaga jeszcze ręcznej decyzji: [docs/ROADMAP.md](docs/ROADMAP.md).

## Stan

Narzędzia działają i przeprowadziły realną migrację od początku do końca.
Są uogólnione na tyle, że czytają konfigurację zamiast mieć wpisany jeden projekt,
ale **nie były jeszcze użyte na drugim projekcie** — spodziewaj się miejsc,
które trzeba będzie dopchnąć.
