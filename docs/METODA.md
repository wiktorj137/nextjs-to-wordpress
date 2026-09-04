# Metoda krok po kroku

## 0. Zanim zaczniesz: audyt

Sprawdź, czy strona nadaje się do tego podejścia:

- **Ile stron dzieli szablon?** Jeśli kilka stron ma identyczną strukturę i różni
  się tylko treścią — to typy treści w WordPressie i główny zysk z migracji.
- **Czy jest backend?** Formularze, API, logowanie zmieniają obraz.
  Strona czysto prezentacyjna to najprostszy przypadek.
- **Skąd bierze się treść?** Jeśli jest zahardkodowana w plikach — świetnie,
  cała „dynamika" to treść, którą przeniesiemy do pól.
- **Jakie animacje?** Proste fade-in da się odtworzyć w 20 liniach.
  Złożone timeline'y GSAP przenoszą się jako vanilla JS bez zmian.
- **Nieużywane zależności.** Warto sprawdzić `grep` po imporcie — w projekcie
  referencyjnym cztery ciężkie biblioteki w `package.json` nie były używane nigdzie.

## 1. Statyczny eksport

```bash
cd zrodlo-nextjs && npm run build
```

Wynikowy HTML jest **źródłem prawdy dla wyglądu**. Nie TSX — HTML, bo to jest to,
co faktycznie widzi przeglądarka.

## 2. Zrzut wzorcowy

Uruchom starą stronę produkcyjnie i zrób zrzuty **zanim** cokolwiek zmienisz:

```bash
make baseline
```

Bez wzorca nie ma jak udowodnić zgodności. To pierwszy krok, nie ostatni.

## 3. Szablony

```bash
make theme
```

`html-to-php.mjs` usuwa runtime Next (skrypty hydracji, znaczniki Suspense,
atrybuty Reacta), podmienia hashowane klasy fontów i wykrywa strukturę:

- czy `<nav>` jest identyczny na wszystkich stronach → jeden `header.php`
- czy `<footer>` ma warianty → jedna stopka sterowana zmienną
- które strony dzielą szablon → typy treści

**Wzorzec dla szablonu współdzielonego wybieraj po najbogatszej treści.**
Szablon wygenerowany ze strony bez FAQ nie ma czego podpiąć pod pole.

## 4. Co ma być polem

```bash
make variants
```

Narzędzie porównuje sekwencje tekstów stron dzielących szablon i wypisuje różnice
z indeksami. To jest lista pól — wyliczona, nie wymyślona.

Dwie rzeczy do zapamiętania:

- **Wyklucz z porównania to, co już jest pętlą** (np. FAQ), inaczej różna liczba
  elementów rozjedzie porównanie pozycyjne.
- **Nie każda pozycja repeatera trafi na listę.** Jeśli jeden punkt listy jest
  identyczny na wszystkich stronach, nie pojawi się wśród różnic — a nadal należy
  do repeatera. Pominięcie go kasuje cały wiersz. Dlatego mapa pól przyjmuje
  też wartości dosłowne, nie tylko indeksy.

## 5. Podpięcie pól

```bash
make wire
```

Podmiana tekstów na wywołania pól i powtórzonych bloków na pętle `foreach`.

Najtrudniejszy fragment to **wyznaczanie granic wiersza repeatera**. Bierz
**największy** element zawierający wiersz i niesięgający następnego. Najmniejszy
trafia w `<span>` z tekstem, a usunięcie rodzeństwa kasuje opakowania `<li>`
i cała lista zlewa się w jeden punkt.

Kolejność też ma znaczenie: **repeatery przed podmianami cząstkowymi**.
Krótka wartość w rodzaju nazwy miasta bywa podciągiem tytułu sekcji i wcześniejsza
podmiana rozbija wykrywanie bloków.

## 6. Model treści

Zasada: klient edytuje **treść**, nie **układ**. Żadnych pól na kolory, odstępy,
kolejność sekcji ani klasy CSS.

- pole na każdy tekst, który się zmienia
- repeater na listy i FAQ
- edytor WYSIWYG tam, gdzie treść ma akapity i listy — a klasy z oryginału
  odtwórz w CSS przez `@apply`, żeby wygląd został 1:1
- polska odmiana wymaga osobnych pól (`miasto`, `miasto_w`) — nie da się jej
  wyliczyć z jednej wartości

Zabezpieczenia: rola bez dostępu do wyglądu i wtyczek, `DISALLOW_FILE_EDIT`,
limity długości na nagłówkach, pola wymagane tam, gdzie pustka rozwali layout.

## 7. Style

Ten sam plik wejściowy CSS co w oryginale, Tailwind skanuje `.php`.
Budowanie **po** podpięciu pól — inaczej klasy z nowo wstawionego markupu
nie trafią do arkusza.

Fonty bierz z builda Next, nie z Google. W buildzie są też **metryki fallbacku**
(`size-adjust`, `ascent-override`), które decydują o tym, że tekst nie przeskakuje
przed załadowaniem fontu.

## 8. Import

```bash
make import
```

Idempotentnie, po slugu. Dzięki temu import jest częścią procesu, a nie
jednorazową akcją — po zmianie w oryginale puszczasz go ponownie.

## 9. Dowód

```bash
make verify
```

Dopóki to nie świeci na zielono, migracja nie jest skończona.
Szczegóły: [TESTY.md](TESTY.md).
