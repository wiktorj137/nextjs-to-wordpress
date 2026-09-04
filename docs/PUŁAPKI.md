# Pułapki

Wszystko poniżej wydarzyło się naprawdę i kosztowało czas. Kolejność:
od najbardziej podstępnych.

---

## 1. Statyczny eksport zawiera stan początkowy animacji

**Objaw:** po migracji cała sekcja strony jest czarna/pusta.

`framer-motion` renderuje stan początkowy jako inline style:

```html
<div style="opacity:0;transform:translateY(30px)">
```

W SSR i w statycznym eksporcie zostaje to **na stałe**. Bez działającego JS
strona pokazuje pusty ekran — i taka trafia do czytników oraz do Google
przy problemach z JavaScriptem. To wada obecna już w oryginale.

**Rozwiązanie:** zamień inline style na atrybut `data-reveal` z zapisanym
transformem. CSS trzyma elementy **widoczne domyślnie**, a ukrywa je dopiero
gdy JS potwierdzi swoją obecność (klasa na `<html>`). Brak JS = widoczna strona.

**Uwaga:** wzorzec nie ogranicza się do `translateY`. W jednym projekcie było
też `scale()`, `translateX()` i `scaleX()`, czasem w parze z `font-size`.
Regex łapiący tylko `translateY` przepuści resztę i zostawi je niewidoczne.

---

## 2. Klasa ukrywająca musi trafić do `<head>`, nie do `main.js`

**Objaw:** Lighthouse pokazuje LCP kilka razy gorszy, mimo że strona wygląda dobrze.

Jeśli klasę `js-reveal` dodaje skrypt po `DOMContentLoaded`, przeglądarka zdąży
narysować treść, skrypt ją chowa, po czym animuje z powrotem. Największy element
jest malowany **dwa razy** i LCP liczy się od tego drugiego razu.

**Rozwiązanie:** jednolinijkowy skrypt inline w `<head>`, synchronicznie.

---

## 3. Część animacji odpala się przy wczytaniu, część przy przewijaniu

Eksport ich **nie odróżnia** — obie wyglądają tak samo (`opacity:0` w `style`).
Jeśli wszystkie potraktujesz jako scroll-triggered, sekcje nad zgięciem
pozostaną niewidoczne do pierwszego ruchu myszy.

**Jak sprawdzić:** wczytaj żywą starą stronę, poczekaj 2 s **bez przewijania**
i policz elementy z `opacity < 0.5`. Porównaj z nową wersją — liczba i pozycje
muszą się zgadzać.

---

## 4. Komponenty renderowane tylko po stronie klienta znikają bez śladu

Baner zgody na cookies sprawdza `localStorage`. Pasek CTA reaguje na scroll.
Żadnego z nich **nie ma w statycznym eksporcie**, więc generator szablonów
je pominie, a migracja po cichu straci funkcjonalność.

**Rozwiązanie:** wyciągnąć je z **żywej** starej strony przez `outerHTML`
(patrz `extract-client-only.mjs`). Uwaga na dwie rzeczy:
- `page.evaluate` serializuje wynik — element DOM przechodzi jako pusty obiekt,
  trzeba zwrócić `outerHTML` już po stronie przeglądarki
- niektóre komponenty pokazują się tylko przy określonej szerokości okna

---

## 5. `<nav>` bywa wewnątrz `<main>`

**Objaw:** żaden. I to jest najgorsze.

Jeśli szablon strony zachowuje `<main>`, a nawigacja trafiła też do `header.php`,
renderuje się **dwa razy**. Wizualnie nie widać nic, bo `position: fixed` nakłada
kopie idealnie. Ale DOM jest zdublowany, czytniki ekranu czytają menu dwukrotnie,
a `querySelector` w skryptach trafia tylko w pierwszą kopię.

Wykrywa to wyłącznie porównanie **treści**, nie zrzutów.

---

## 6. `wp_update_post()` zawsze nadpisuje `post_modified`

Jeśli data modyfikacji trafia do JSON-LD i ma zgadzać się z oryginałem,
przekazanie jej do `wp_update_post()` nic nie da — WordPress i tak wstawi
bieżący czas. Trzeba zapisać wprost do bazy przez `$wpdb->update()`
i wywołać `clean_post_cache()`.

---

## 7. `update_field()` rozwiązuje nazwę pola globalnie

Dwa repeatery o tej samej nazwie w różnych grupach pól (np. `sekcje` na dwóch
typach treści) to **cicha utrata danych**. ACF/SCF zapisze podpola z pierwszej
znalezionej definicji, reszta przepadnie bez żadnego błędu.

W praktyce wyglądało to tak: tytuły sekcji zapisywały się poprawnie, treść była
pusta. Nazwy pól muszą być unikalne w całym serwisie.

---

## 8. `wpautop` na polach typu textarea zmienia wysokość sekcji

ACF domyślnie przepuszcza `textarea` przez `wpautop`, co dokłada akapity
i przesuwa całą stronę poniżej o kilkanaście pikseli. Ustaw `'new_lines' => ''`.

---

## 9. Zmienne nie przechodzą między szablonami WordPressa

Każdy szablon ładowany jest w **osobnym zasięgu**, więc `$flaga = false;`
w `page-kontakt.php` nie dotrze do `footer.php`. Potrzebna funkcja z globalną
albo statyczną, resetowana na `template_redirect`.

Dodatkowo: flaga wpływająca na **nagłówek** musi być ustawiona **przed**
`get_header()`, bo to on wypisuje markup. Ustawiona po — nie ma czego wyłączyć.

---

## 10. CPT ze slugiem `/` przechwytuje wszystkie adresy

`'rewrite' => array( 'slug' => '/' )` tworzy regułę `^([^/]+)/?$`, która łapie
**każdy** adres w katalogu głównym i zamienia wszystkie strony w 404.

**Rozwiązanie:** `'rewrite' => false` plus wąska własna reguła dopasowana
do konkretnego wzorca, oraz filtr `post_type_link` do budowania permalinków.

Pokrewna sytuacja: strona i CPT dzielące ten sam prefiks (`/oferta/` jako strona
przeglądowa i `/oferta/produkt/` jako CPT). Potrzebna jawna reguła dla samej strony.

---

## 11. Filtr trailing slash psuje adresy plików

Filtr `user_trailingslashit` dokleja ukośnik również do `/sitemap.xml`,
co daje 301 na `/sitemap.xml/`. Trzeba pominąć ścieżki z rozszerzeniem.

Podobnie `redirect_canonical` potrafi przekierować własny endpoint zanim
zdąży cokolwiek wypisać — dla takiego adresu trzeba go wyłączyć punktowo.

---

## 12. Favicon

WordPress podstawia pod `/favicon.ico` **swoje domyślne logo**. Same `<link>`
w `<head>` nie wystarczą — przeglądarki pytają o `/favicon.ico` wprost.
Ikony trzeba serwować spod katalogu głównego.

Łatwe do przeoczenia, bo żaden standardowy test tego nie sprawdza.

---

## 13. Pułapki samego harnessu testowego

Test, który kłamie, jest gorszy niż brak testu — przestaje się mu ufać.

- **Lazy loading:** `complete === true` nie znaczy, że obraz jest namalowany.
  Przy zrzutach `fullPage` duże pliki bywają wczytane, ale jeszcze nie widoczne.
  Ustaw `loading="eager"` i poczekaj na `img.decode()`.
- **Animacje on-scroll:** przewiń stronę do końca i z powrotem przed zrzutem,
  inaczej połowa sekcji będzie niewidoczna na jednym z porównywanych obrazów.
- **Adresy między środowiskami:** stara strona podaje w `canonical` i JSON-LD
  domenę produkcyjną, nowa localhost. Porównuj ścieżki, nie pełne adresy.
- **Obrazy po przeniesieniu do motywu:** ten sam plik, inna ścieżka.
  Porównuj nazwę pliku, inaczej każda strona zgłosi fałszywą rozbieżność.
- **Zrzut częściowy nadpisuje pełny:** tryb „tylko jedna trasa" musi **scalać**
  wynik z poprzednim, nie zastępować.

---

## 14. Nie przepuszczaj długo działającego narzędzia przez `head`

```bash
node wire-fields.mjs | head -5     # ← SIGPIPE ubija skrypt w połowie zapisu
```

Kosztowało pół godziny szukania „regresji", której nie było. Szablony zostały
podpięte częściowo, a testy pokazały rozjazd 95%.
