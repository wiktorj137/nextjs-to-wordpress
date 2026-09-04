<?php
/**
 * Import treści do WordPressa z plików JSON wygenerowanych przez narzędzia z tools/.
 *
 * Uruchomienie:  wp eval-file tools/import.php
 *
 * Skrypt jest IDEMPOTENTNY — można go puszczać wielokrotnie. Wpisy dopasowywane
 * są po slugu, więc kolejne uruchomienie aktualizuje, a nie duplikuje. To ważne:
 * import przestaje być jednorazową akcją „na produkcji", a staje się częścią
 * procesu, którą można powtórzyć po każdej zmianie w oryginale.
 *
 * Czyta:
 *   migration.config.json        — mapa tras na typy treści
 *   <motyw>/content/pages.json   — metadane i FAQ (extract-content.mjs)
 *   <motyw>/content/fields.json  — wartości pól per strona (wire-fields.mjs)
 */

defined( 'ABSPATH' ) || exit;

$config_path = getenv( 'MIGRATION_CONFIG' ) ?: dirname( __DIR__ ) . '/migration.config.json';
if ( ! file_exists( $config_path ) ) {
	WP_CLI::error( "Brak pliku konfiguracji: {$config_path}" );
}

$config      = json_decode( file_get_contents( $config_path ), true );
$prefix      = $config['prefix'] ?? 'motyw';
$content_dir = get_template_directory() . '/content';

$wczytaj = function ( string $plik ) use ( $content_dir ) {
	$sciezka = $content_dir . '/' . $plik;
	return file_exists( $sciezka ) ? json_decode( file_get_contents( $sciezka ), true ) : array();
};

$pages        = $wczytaj( 'pages.json' );
$field_values = $wczytaj( 'fields.json' );

if ( ! $pages ) {
	WP_CLI::error( 'Brak pages.json — uruchom najpierw `make content`.' );
}

/** Znajduje wpis po slugu albo tworzy nowy. */
function migracja_upsert( string $slug, string $type, string $title ): int {
	$istnieje = get_posts( array(
		'name'        => $slug,
		'post_type'   => $type,
		'post_status' => 'any',
		'numberposts' => 1,
	) );

	if ( $istnieje ) {
		return $istnieje[0]->ID;
	}

	$id = wp_insert_post( array(
		'post_name'   => $slug,
		'post_type'   => $type,
		'post_title'  => $title,
		'post_status' => 'publish',
	), true );

	if ( is_wp_error( $id ) ) {
		WP_CLI::error( "Nie udało się utworzyć „{$title}”: " . $id->get_error_message() );
	}

	return $id;
}

$utworzono = 0;
$zaktualizowano = 0;

foreach ( $config['trasy'] as $plik => $cfg ) {
	if ( str_starts_with( $plik, '_' ) ) {
		continue;
	}

	$route = $cfg['route'];
	$dane  = null;
	foreach ( $pages as $p ) {
		if ( $p['route'] === $route ) {
			$dane = $p;
			break;
		}
	}

	if ( ! $dane ) {
		WP_CLI::warning( "Brak danych dla trasy {$route} — pomijam." );
		continue;
	}

	// Typ treści wynika z szablonu: szablon współdzielony przez kilka stron
	// deklaruje post_type w mapaPol, pojedyncza strona to zwykła „page”.
	$post_type = $config['mapaPol'][ $cfg['template'] ]['post_type'] ?? 'page';
	$slug      = $cfg['slug'];

	$przed = get_posts( array( 'name' => $slug, 'post_type' => $post_type, 'post_status' => 'any', 'numberposts' => 1 ) );
	$id    = migracja_upsert( $slug, $post_type, $cfg['title'] ?? $slug );
	$przed ? $zaktualizowano++ : $utworzono++;

	// --- SEO: dokładnie te wartości, które miała stara strona -----------
	if ( ! empty( $dane['seo']['title'] ) ) {
		update_field( 'seo_title', $dane['seo']['title'], $id );
	}
	if ( ! empty( $dane['seo']['description'] ) ) {
		update_field( 'seo_description', $dane['seo']['description'], $id );
	}

	// --- Pola wykryte przez porównanie stron o wspólnym szablonie -------
	$entry = $field_values[ $slug ] ?? null;
	if ( $entry ) {
		if ( ! empty( $entry['tytul'] ) ) {
			wp_update_post( array( 'ID' => $id, 'post_title' => $entry['tytul'] ) );
		}
		foreach ( $entry['fields'] as $nazwa => $wartosc ) {
			if ( null === $wartosc || '' === $wartosc || array() === $wartosc ) {
				continue;
			}
			update_field( $nazwa, $wartosc, $id );
		}
	}

	// --- FAQ -----------------------------------------------------------
	if ( ! empty( $dane['faq'] ) ) {
		$wiersze = array();
		foreach ( $dane['faq'] as $faq ) {
			if ( empty( $faq['pytanie'] ) || empty( $faq['odpowiedz'] ) ) {
				continue;
			}
			$wiersze[] = array( 'pytanie' => $faq['pytanie'], 'odpowiedz' => $faq['odpowiedz'] );
		}
		if ( $wiersze ) {
			update_field( 'faq', $wiersze, $id );
		}
	}

	if ( '/' === $route ) {
		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', $id );
	}

	WP_CLI::log( sprintf(
		'  %-52s → %s #%d (%d FAQ, %d pól)',
		$route,
		$post_type,
		$id,
		count( $dane['faq'] ?? array() ),
		$entry ? count( $entry['fields'] ) : 0
	) );
}

// --- Sprzątanie po instalacji WordPressa ---------------------------------
// Domyślne strony trafiałyby do sitemapy i do menu.
foreach ( array( 'sample-page', 'privacy-policy' ) as $slug ) {
	$domyslna = get_posts( array( 'name' => $slug, 'post_type' => 'page', 'post_status' => 'any', 'numberposts' => 1 ) );
	if ( $domyslna ) {
		wp_delete_post( $domyslna[0]->ID, true );
		WP_CLI::log( "  usunięto domyślną stronę: {$slug}" );
	}
}
$hello = get_posts( array( 'name' => 'hello-world', 'post_type' => 'post', 'post_status' => 'any', 'numberposts' => 1 ) );
if ( $hello ) {
	wp_delete_post( $hello[0]->ID, true );
	WP_CLI::log( '  usunięto domyślny wpis: hello-world' );
}

// --- Rola klienta --------------------------------------------------------
// Redaktor edytuje treść i nie ma dostępu do wyglądu, wtyczek ani kodu.
$redaktor = get_role( 'editor' );
if ( $redaktor ) {
	foreach ( array( 'switch_themes', 'edit_themes', 'activate_plugins', 'edit_plugins',
	                 'install_plugins', 'update_plugins', 'edit_files', 'manage_options' ) as $cap ) {
		$redaktor->remove_cap( $cap );
	}
	WP_CLI::log( '  rola Redaktor → ograniczona do edycji treści' );
}

flush_rewrite_rules();

WP_CLI::success( sprintf( 'Import zakończony: utworzono %d, zaktualizowano %d.', $utworzono, $zaktualizowano ) );

/*
 * PUNKTY ROZSZERZENIA
 *
 * Rzeczy specyficzne dla projektu (daty artykułów, menu, dane firmy w opcjach,
 * treść z edytora WYSIWYG) dopisuje się tutaj. Dwie pułapki warte zapamiętania:
 *
 * 1. wp_update_post() ZAWSZE nadpisuje post_modified bieżącym czasem. Jeśli data
 *    modyfikacji ma trafić do JSON-LD zgodnie z oryginałem, zapisz ją wprost
 *    do bazy przez $wpdb->update() i wywołaj clean_post_cache().
 *
 * 2. update_field() rozwiązuje nazwę pola GLOBALNIE. Dwa repeatery o tej samej
 *    nazwie w różnych grupach pól to cicha utrata danych — zapisze się podpole
 *    z pierwszej znalezionej definicji, reszta przepadnie bez błędu.
 */
