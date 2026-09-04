# Cały proces migracji w jednym miejscu i w JEDNEJ kolejności.
#
# Kolejność ma znaczenie: generowanie szablonów NADPISUJE pliki, więc podpinanie
# pól musi iść zaraz po nim. Rozjechanie tego raz kosztowało pół godziny
# szukania „regresji", której nie było.

NEXT_DIR := ../reference-nextjs
THEME    := ../theme
TESTS    := ../tests
OLD_URL  ?= http://localhost:3000
NEW_URL  ?= http://localhost:8080
WP       := docker compose -f ../docker-compose.yml exec -T cli wp --path=/var/www/html

.PHONY: all export theme content variants guides wire css import baseline verify lighthouse clean

## Pełny przebieg: eksport → szablony → pola → import → CSS
all: export theme content variants guides wire css import

## 1. Statyczny eksport Next.js — źródło prawdy dla markupu
export:
	cd $(NEXT_DIR) && npm run build

## 2. HTML → szablony PHP (nagłówek, stopka, szablony stron)
theme:
	node html-to-php.mjs --in $(NEXT_DIR)/out --out $(THEME)
	node extract-fonts.mjs --next $(NEXT_DIR) --out $(THEME)/assets
	node extract-client-only.mjs --base $(OLD_URL) --out $(THEME)/template-parts
	# Ikony strony: Next generował je z plików w src/app, WordPress podstawiłby
	# własne domyślne logo. Kopiujemy oryginały — inc/icons.php serwuje je
	# spod katalogu głównego, bo przeglądarki pytają o /favicon.ico wprost.
	cp $(NEXT_DIR)/src/app/favicon.ico $(NEXT_DIR)/src/app/icon.png $(NEXT_DIR)/src/app/apple-icon.png $(THEME)/assets/img/

## 3. Treść, metadane i FAQ → JSON
content:
	node extract-content.mjs --snapshot $(TESTS)/snapshots/old --theme $(THEME)

## 4. Które teksty różnią się między stronami o wspólnym szablonie
variants:
	node find-variants.mjs --in $(NEXT_DIR)/out --theme $(THEME)

## 5. (opcjonalnie) Wyciągi specyficzne dla projektu — patrz docs/METODA.md
guides:
	node extract-guides.mjs --in $(NEXT_DIR)/out --theme $(THEME)

## 6. Podmiana treści w szablonach na pola edycyjne
wire:
	node wire-fields.mjs --theme $(THEME)

## 7. Budowa CSS (Tailwind skanuje pliki PHP, więc PO podpięciu pól)
css:
	cd $(THEME) && npx tailwindcss -i ./assets/css/src.css -o ./assets/css/main.css --minify

## 8. Wgranie treści do WordPressa (idempotentne)
import:
	$(WP) eval-file /tools/import.php

## Zrzut wzorcowy starej strony (wymaga uruchomionego Next na OLD_URL)
baseline:
	cd $(TESTS) && node capture.mjs --base $(OLD_URL) --out snapshots/old

## Weryfikacja: wygląd + treść i SEO
verify:
	cd $(TESTS) && node capture.mjs --base $(NEW_URL) --out snapshots/new
	cd $(TESTS) && node diff-visual.mjs && node diff-content.mjs

## Porównanie wydajności przed/po
lighthouse:
	cd $(TESTS) && ./lighthouse.sh $(OLD_URL) $(NEW_URL)

clean:
	rm -rf $(TESTS)/snapshots/new $(TESTS)/report
