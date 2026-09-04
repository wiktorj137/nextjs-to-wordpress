<?php
/**
 * Imports content into WordPress from the JSON files produced by the tools in tools/.
 *
 * Run with:  wp eval-file tools/import.php
 *
 * The script is IDEMPOTENT - run it as many times as you like. Posts are matched by
 * slug, so a second run updates rather than duplicates. That matters: the import stops
 * being a one-shot action against production and becomes a repeatable part of the
 * process, to be re-run after any change to the original.
 *
 * Reads:
 *   migration.config.json       - route to post-type mapping
 *   <theme>/content/pages.json  - metadata and FAQs (extract-content.mjs)
 *   <theme>/content/fields.json - per-page field values (wire-fields.mjs)
 */

defined( 'ABSPATH' ) || exit;

$config_path = getenv( 'MIGRATION_CONFIG' ) ?: dirname( __DIR__ ) . '/migration.config.json';
if ( ! file_exists( $config_path ) ) {
	WP_CLI::error( "Config file not found: {$config_path}" );
}

$config      = json_decode( file_get_contents( $config_path ), true );
$prefix      = $config['prefix'] ?? 'motyw';
$content_dir = get_template_directory() . '/content';

$read = function ( string $file ) use ( $content_dir ) {
	$path = $content_dir . '/' . $file;
	return file_exists( $path ) ? json_decode( file_get_contents( $path ), true ) : array();
};

$pages        = $read( 'pages.json' );
$field_values = $read( 'fields.json' );

if ( ! $pages ) {
	WP_CLI::error( 'pages.json missing - run `make content` first.' );
}

/** Finds a post by slug, or creates one. */
function migration_upsert( string $slug, string $type, string $title ): int {
	$existing = get_posts( array(
		'name'        => $slug,
		'post_type'   => $type,
		'post_status' => 'any',
		'numberposts' => 1,
	) );

	if ( $existing ) {
		return $existing[0]->ID;
	}

	$id = wp_insert_post( array(
		'post_name'   => $slug,
		'post_type'   => $type,
		'post_title'  => $title,
		'post_status' => 'publish',
	), true );

	if ( is_wp_error( $id ) ) {
		WP_CLI::error( "Could not create \"{$title}\": " . $id->get_error_message() );
	}

	return $id;
}

$created = 0;
$updated = 0;

foreach ( $config['trasy'] as $file => $cfg ) {
	if ( str_starts_with( $file, '_' ) ) {
		continue;
	}

	$route = $cfg['route'];
	$data  = null;
	foreach ( $pages as $p ) {
		if ( $p['route'] === $route ) {
			$data = $p;
			break;
		}
	}

	if ( ! $data ) {
		WP_CLI::warning( "No data for route {$route} - skipping." );
		continue;
	}

	// The post type follows from the template: a template shared by several pages
	// declares its post_type in the field map; a one-off page is a plain 'page'.
	$post_type = $config['mapaPol'][ $cfg['template'] ]['post_type'] ?? 'page';
	$slug      = $cfg['slug'];

	$before = get_posts( array( 'name' => $slug, 'post_type' => $post_type, 'post_status' => 'any', 'numberposts' => 1 ) );
	$id    = migration_upsert( $slug, $post_type, $cfg['title'] ?? $slug );
	$before ? $updated++ : $created++;

	// --- SEO: exactly the values the old site had -----------------------
	if ( ! empty( $data['seo']['title'] ) ) {
		update_field( 'seo_title', $data['seo']['title'], $id );
	}
	if ( ! empty( $data['seo']['description'] ) ) {
		update_field( 'seo_description', $data['seo']['description'], $id );
	}

	// --- Fields discovered by comparing pages that share a template -----
	$entry = $field_values[ $slug ] ?? null;
	if ( $entry ) {
		if ( ! empty( $entry['tytul'] ) ) {
			wp_update_post( array( 'ID' => $id, 'post_title' => $entry['tytul'] ) );
		}
		foreach ( $entry['fields'] as $name => $value ) {
			if ( null === $value || '' === $value || array() === $value ) {
				continue;
			}
			update_field( $name, $value, $id );
		}
	}

	// --- FAQ -----------------------------------------------------------
	if ( ! empty( $data['faq'] ) ) {
		$rows = array();
		foreach ( $data['faq'] as $faq ) {
			if ( empty( $faq['pytanie'] ) || empty( $faq['odpowiedz'] ) ) {
				continue;
			}
			$rows[] = array( 'pytanie' => $faq['pytanie'], 'odpowiedz' => $faq['odpowiedz'] );
		}
		if ( $rows ) {
			update_field( 'faq', $rows, $id );
		}
	}

	if ( '/' === $route ) {
		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', $id );
	}

	WP_CLI::log( sprintf(
		'  %-52s -> %s #%d (%d FAQ, %d fields)',
		$route,
		$post_type,
		$id,
		count( $data['faq'] ?? array() ),
		$entry ? count( $entry['fields'] ) : 0
	) );
}

// --- Clean up after the WordPress install --------------------------------
// The default pages would otherwise end up in the sitemap and the menu.
foreach ( array( 'sample-page', 'privacy-policy' ) as $slug ) {
	$default_page = get_posts( array( 'name' => $slug, 'post_type' => 'page', 'post_status' => 'any', 'numberposts' => 1 ) );
	if ( $default_page ) {
		wp_delete_post( $default_page[0]->ID, true );
		WP_CLI::log( "  removed default page: {$slug}" );
	}
}
$hello = get_posts( array( 'name' => 'hello-world', 'post_type' => 'post', 'post_status' => 'any', 'numberposts' => 1 ) );
if ( $hello ) {
	wp_delete_post( $hello[0]->ID, true );
	WP_CLI::log( '  removed default post: hello-world' );
}

// --- Client role ---------------------------------------------------------
// The editor role edits content and has no access to appearance, plugins or code.
$editor = get_role( 'editor' );
if ( $editor ) {
	foreach ( array( 'switch_themes', 'edit_themes', 'activate_plugins', 'edit_plugins',
	                 'install_plugins', 'update_plugins', 'edit_files', 'manage_options' ) as $cap ) {
		$editor->remove_cap( $cap );
	}
	WP_CLI::log( '  editor role -> restricted to content editing' );
}

flush_rewrite_rules();

WP_CLI::success( sprintf( 'Import finished: %d created, %d updated.', $created, $updated ) );

/*
 * EXTENSION POINTS
 *
 * Project-specific work (article dates, menus, business data in options, WYSIWYG
 * content) goes here. Two pitfalls worth remembering:
 *
 * 1. wp_update_post() ALWAYS overwrites post_modified with the current time. If a
 *    modification date must reach JSON-LD matching the original, write it straight
 *    to the database via $wpdb->update() and call clean_post_cache().
 *
 * 2. update_field() resolves field names GLOBALLY. Two repeaters sharing a name in
 *    different field groups means silent data loss - subfields from the first matching
 *    definition are written and the rest vanish without an error.
 */
