# Bramka testowa

Cel: zamienić „wygląda tak samo" z opinii w **warunek wdrożenia**.

## Trzy warstwy

| Warstwa | Co łapie | Czego nie łapie |
|---|---|---|
| **Wizualna** | rozjazd layoutu, odstępy, kolory, fonty | literówka w numerze telefonu, zgubiony `canonical` |
| **Treść i SEO** | meta, JSON-LD, nagłówki, CTA, ikony, alty | przycisk przesunięty o 40 px |
| **Wydajność** | regresja Core Web Vitals | jedno i drugie |

Pierwsze dwie są komplementarne i **obie znalazły błędy, których druga nie widziała**.
To nie jest nadmiarowość.

## Progi

- **wizualnie:** ≤ 0,1% różniących się pikseli na stronę, tolerancja koloru 0.15
  (zjada antyaliasing fontów, nie przepuści przesuniętego elementu)
- **wysokość strony:** różnica < 8 px — większa oznacza rozjechany layout
  nawet przy niskim procencie
- **treść:** zero rozbieżności o wadze krytycznej

## Zatwierdzone odstępstwa

Część różnic jest **celowa** — najczęściej dlatego, że naprawiasz błąd oryginału.
Zamiast luzować progi (co osłabia bramkę wszędzie), trzymaj listę zatwierdzonych
odstępstw z uzasadnieniem:

```json
{
  "wizualne": [
    { "strony": ["home"], "szerokosci": ["mobile"], "tolerancja": 1.3,
      "powod": "Poprawka: baner zgody zasłaniał przycisk CTA." }
  ],
  "tresc": [
    { "strony": ["/404/"], "pola": ["canonical"],
      "powod": "Strona 404 nie powinna mieć adresu kanonicznego." }
  ]
}
```

Testy przepuszczają **wyłącznie** te wpisy. Każda nowa różnica dalej zapala bramkę.
Raport pokazuje je osobnym kolorem z powodem — nie giną z pola widzenia.

## Zaufanie do harnessu

Zanim uwierzysz testowi, sprawdź, czy nie kłamie: zrób **dwa niezależne przebiegi
na tej samej stronie** i porównaj. Wynik ma być zerowy. Jeśli nie jest, masz
fałszywe alarmy i za chwilę przestaniesz patrzeć na raport.

Co robi `capture.mjs`, żeby tak było:

- wyłącza wszystkie animacje i tranzycje, kursor przezroczysty
- przewija stronę do końca i z powrotem (odpala animacje on-scroll)
- wymusza `loading="eager"` i czeka na `img.decode()` — nie na `complete`
- stały `deviceScaleFactor` i viewport, zrzut `fullPage`

## Wydajność

Mierz **przed i po**, na tych samych adresach, i zapisz wyniki.
Uwaga na artefakty: Lighthouse przewija stronę na koniec pomiaru, co potrafi
odpalić animacje wejścia i przesunąć LCP na koniec przebiegu. Zanim uznasz
regresję za realną, zmierz LCP w prawdziwej przeglądarce przez
`PerformanceObserver` — bywa, że różnica 10 sekund w raporcie to 90 ms u użytkownika.
