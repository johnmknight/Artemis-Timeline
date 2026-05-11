#!/usr/bin/env node
/**
 * One-time schema migration for photos.js.
 *
 * Adds five new fields to every photo entry that doesn't already have them:
 *
 *   addedAt   - ISO-8601 timestamp in EDT (single fixed value for the whole
 *               migration run, marking when this fork picked up the schema)
 *   source    - "upstream" for migrated entries (where the entry came from
 *               into this fork). Future values from the sync pipeline:
 *               "nasa_library", "flickr_nasahq", "flickr_kennedy", etc.
 *   source_id - getFlickrId(file) result, or the filename stem as a fallback
 *   era       - "mission" — all 519 existing entries are within Hank's
 *               mission-curated narrative. Adjust by hand later if any need
 *               reclassification to "pre-flight-hardware" / "pre-flight-
 *               training" / "post-mission".
 *   curator   - "hankmt" — Hank curated all upstream entries. Entries added
 *               via the sync pipeline + admin Pending tab will be stamped
 *               with "johnmknight" (or whichever GitHub handle is doing the
 *               promotion). Separates editorial responsibility from source
 *               of origin.
 *
 * Idempotent per-field. Re-running adds only the fields each entry is still
 * missing; entries that already have everything are left alone. This means
 * we can extend the schema later by adding another check below and re-
 * running migrate.js without worrying about earlier passes.
 *
 * Audio entries are NOT touched — they share the schema only loosely and
 * the era / curator concepts don't apply (all audio is mission window,
 * all upstream).
 *
 * Usage:
 *   node tools/import/migrate.js           # writes back to photos.js
 *   node tools/import/migrate.js --dry-run # report only, don't write
 */

'use strict';

const path = require('path');
const { readPhotosJs, writePhotosJs } = require('./shared/photos-io');
const { getFlickrId } = require('./shared/ids');
const { isoEdt } = require('./shared/dates');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PHOTOS_JS = path.join(REPO_ROOT, 'photos.js');

const MIGRATION_TS = isoEdt();   // single timestamp for the whole run

function deriveSourceId(file) {
  const fid = getFlickrId(file);
  if (fid) return fid;
  // Fallback: strip extension, keep everything else as the ID.
  return file.replace(/\.[^.]+$/, '');
}

/**
 * The canonical schema defaults for upstream entries. Each entry in the
 * existing photos.js gets these fields added IF they're missing. Order
 * matters for the touched-fields report only.
 */
const UPSTREAM_DEFAULTS = [
  ['addedAt',   () => MIGRATION_TS],
  ['source',    () => 'upstream'],
  ['source_id', (e) => deriveSourceId(e.file)],
  ['era',       () => 'mission'],
  ['curator',   () => 'hankmt'],
];

/**
 * Apply per-field defaults to an entry. Returns the (possibly updated) entry
 * plus a list of fields that were added. Empty `added` array means nothing
 * changed for this entry.
 */
function migrateEntry(entry) {
  const updated = { ...entry };
  const added = [];
  for (const [field, valueFn] of UPSTREAM_DEFAULTS) {
    if (updated[field] === undefined) {
      updated[field] = valueFn(entry);
      added.push(field);
    }
  }
  return { entry: updated, added };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`[migrate] reading ${PHOTOS_JS}`);
  const data = await readPhotosJs(PHOTOS_JS);
  console.log(`[migrate] loaded: ${data.photos.length} photos, ${data.audio.length} audio`);
  console.log(`[migrate] migration timestamp: ${MIGRATION_TS}`);

  const photos = [];
  const fieldCounts = {};         // { fieldName: number of entries that got it added }
  let entriesTouched = 0;          // entries that got at least one field added
  let entriesUntouched = 0;        // already fully migrated

  for (const p of data.photos) {
    const { entry, added } = migrateEntry(p);
    photos.push(entry);
    if (added.length === 0) {
      entriesUntouched++;
    } else {
      entriesTouched++;
      for (const f of added) fieldCounts[f] = (fieldCounts[f] || 0) + 1;
    }
  }

  console.log(`[migrate] entries touched:   ${entriesTouched}`);
  console.log(`[migrate] entries untouched: ${entriesUntouched}`);
  if (entriesTouched > 0) {
    console.log('[migrate] fields added (count per field):');
    for (const [f, n] of Object.entries(fieldCounts)) {
      console.log(`           ${f}: ${n}`);
    }
  }

  if (dryRun) {
    console.log('[migrate] dry run — not writing.');
    if (entriesTouched > 0) {
      const sample = photos[0];
      console.log('[migrate] sample entry after migration:');
      console.log(JSON.stringify({
        time: sample.time,
        file: sample.file,
        title: sample.title,
        addedAt: sample.addedAt,
        source: sample.source,
        source_id: sample.source_id,
        era: sample.era,
        curator: sample.curator,
      }, null, 2));
    }
    return;
  }

  if (entriesTouched === 0) {
    console.log('[migrate] nothing to do.');
    return;
  }

  const updated = { ...data, photos };
  await writePhotosJs(PHOTOS_JS, updated);
  console.log(`[migrate] wrote ${PHOTOS_JS}`);
}

main().catch(err => {
  console.error('[migrate] FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
