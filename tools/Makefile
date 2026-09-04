# The whole migration in one place and in ONE order.
#
# Order matters: generating templates OVERWRITES files, so field wiring must run
# immediately after. Getting this wrong once cost half an hour of chasing a
# "regression" that did not exist.

NEXT_DIR := ../reference-nextjs
THEME    := ../theme
TESTS    := ../tests
OLD_URL  ?= http://localhost:3000
NEW_URL  ?= http://localhost:8080
WP       := docker compose -f ../docker-compose.yml exec -T cli wp --path=/var/www/html

.PHONY: all export theme content variants guides wire css import baseline verify lighthouse clean

## Full run: export -> templates -> fields -> import -> CSS
all: export theme content variants guides wire css import

## 1. Next.js static export - the source of truth for markup
export:
	cd $(NEXT_DIR) && npm run build

## 2. HTML -> PHP templates (header, footer, page templates)
theme:
	node html-to-php.mjs --in $(NEXT_DIR)/out --out $(THEME)
	node extract-fonts.mjs --next $(NEXT_DIR) --out $(THEME)/assets
	node extract-client-only.mjs --base $(OLD_URL) --out $(THEME)/template-parts
	# Site icons: Next generated these from src/app; WordPress would substitute its
	# own default logo. Copy the originals - the theme must serve them from the site
	# root, because browsers request /favicon.ico directly.
	cp $(NEXT_DIR)/src/app/favicon.ico $(NEXT_DIR)/src/app/icon.png $(NEXT_DIR)/src/app/apple-icon.png $(THEME)/assets/img/

## 3. Content, metadata and FAQs -> JSON
content:
	node extract-content.mjs --snapshot $(TESTS)/snapshots/old --theme $(THEME)

## 4. Which texts differ between pages sharing a template
variants:
	node find-variants.mjs --in $(NEXT_DIR)/out --theme $(THEME)

## 5. (optional) Project-specific extractors - see docs/METHOD.md
guides:
	node extract-guides.mjs --in $(NEXT_DIR)/out --theme $(THEME)

## 6. Swap template text for editable fields
wire:
	node wire-fields.mjs --theme $(THEME)

## 7. Build CSS (Tailwind scans PHP, so AFTER field wiring)
css:
	cd $(THEME) && npx tailwindcss -i ./assets/css/src.css -o ./assets/css/main.css --minify

## 8. Import content into WordPress (idempotent)
import:
	$(WP) eval-file /tools/import.php

## Baseline capture of the old site (needs Next running on OLD_URL)
baseline:
	cd $(TESTS) && node capture.mjs --base $(OLD_URL) --out snapshots/old

## Verify: appearance + content and SEO
verify:
	cd $(TESTS) && node capture.mjs --base $(NEW_URL) --out snapshots/new
	cd $(TESTS) && node diff-visual.mjs && node diff-content.mjs

## Performance comparison, before vs after
lighthouse:
	cd $(TESTS) && ./lighthouse.sh $(OLD_URL) $(NEW_URL)

clean:
	rm -rf $(TESTS)/snapshots/new $(TESTS)/report
