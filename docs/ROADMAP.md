# Droga do programu

Cel: narzędzie, które przeprowadza migrację półautomatycznie, a człowiek
podejmuje tylko decyzje projektowe.

## Gdzie jesteśmy

**Zautomatyzowane w całości:**
- przeniesienie markupu i wykrycie szablonów współdzielonych
- fonty z metrykami fallbacku
- komponenty renderowane po stronie klienta
- wykrycie, które teksty mają być polami
- podmiana treści na pola i powtórzeń na pętle
- import treści, menu, roli klienta
- dowód zgodności (wygląd + treść + wydajność)

**Nadal ręczne — i słusznie:**
- **nazwy i typy pól.** Automat wie, że tekst nr 13 się różni. Nie wie, czy to
  „intro", czy „opis skrócony", ani czy ma być polem tekstowym czy edytorem.
  To decyzja projektowa i nie powinna być generowana.
- **model treści.** Co jest typem treści, a co pojedynczą stroną.
- **granica edytowalności.** Co klient może zmieniać, a co ma być zablokowane.

**Ręczne, ale do zautomatyzowania:**
- rejestracja pól (generowalna z mapy pól)
- rejestracja typów treści (jest już w konfiguracji)
- JSON-LD (odtwarzalne z oryginału — struktura jest w eksporcie)
- reguły przepisywania adresów

## Następne kroki

1. **Generator definicji pól** z `mapaPol` — dziś pisane ręcznie w PHP,
   a mapa zawiera już prawie wszystko.
2. **Odtwarzanie JSON-LD z eksportu.** Struktura jest w statycznym HTML;
   dziś przepisuje się ją do PHP ręcznie, a to najbardziej żmudny krok po polach.
3. **Kreator konfiguracji** — zamiast wypełniać JSON z ręki, interaktywnie:
   pokaż wykryte trasy, zaproponuj szablony, zapytaj o nazwy pól.
4. **Druga migracja.** Narzędzia przeszły jeden projekt od początku do końca.
   Dopiero drugi pokaże, co jest naprawdę uogólnione, a co tylko wygląda.
5. **Wsparcie dla innych źródeł** — Astro, Gatsby, zwykły HTML. Metoda
   („potnij wygenerowany HTML") nie jest specyficzna dla Next.js.

## Czego świadomie nie robić

- **Nie generuj nazw pól automatycznie.** Klient zobaczy je w panelu.
  `pole_13` to gorsze doświadczenie niż dziesięć minut pracy człowieka.
- **Nie próbuj odtwarzać animacji Reacta jeden do jednego.** Eksport nie odróżnia
  animacji przy wczytaniu od animacji przy przewijaniu. Zmierz zachowanie
  na żywej stronie i odtwórz regułą.
- **Nie luzuj progów testowych, żeby było zielono.** Od tego zaczyna się
  nieufność do własnego raportu.
