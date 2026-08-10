#!/usr/bin/env node
/**
 * migrate-storage.mjs — copie le contenu des buckets Storage d'un projet
 * Supabase vers un autre.
 * ============================================================================
 *
 * Ecrit pour le chantier 0 (projet Supabase dedie, cf. docs/CUTOVER_SUPABASE.md).
 * La CLI Supabase ne sait pas telecharger un bucket distant — `supabase storage
 * cp` ne fait que du local vers local et renvoie
 * LegacyStorageUnsupportedOperationError. D'ou ce script.
 *
 * Les buckets et leurs policies sont crees par la migration
 * 20260809_2_storage_buckets_et_policies.sql — ce script ne copie QUE le
 * contenu, il ne cree rien.
 *
 * Usage (PowerShell) :
 *   $env:SRC_URL  = "https://odspcxgafcqxjzrarsqf.supabase.co"
 *   $env:SRC_KEY  = "<service_role de la source>"
 *   $env:DST_URL  = "https://ejqqqwudmizqisdkxohw.supabase.co"
 *   $env:DST_KEY  = "<service_role de la cible>"
 *   node scripts/migrate-storage.mjs
 *
 * Ajouter --dry-run pour compter sans rien copier.
 *
 * Idempotent : les fichiers sont uploades en upsert, relancer le script ne
 * cree pas de doublon et reprend les manquants.
 */

import { createClient } from '@supabase/supabase-js';

const BUCKETS = [
  'contracts',
  'interventions',
  'product-documents',
  'product-images',
  'project-recordings',
  'technical-visits',
];

const DRY_RUN = process.argv.includes('--dry-run');

const { SRC_URL, SRC_KEY, DST_URL, DST_KEY } = process.env;
const manquants = ['SRC_URL', 'SRC_KEY', 'DST_URL', 'DST_KEY'].filter((k) => !process.env[k]);
if (manquants.length) {
  console.error(`Variables d'environnement manquantes : ${manquants.join(', ')}`);
  process.exit(1);
}
if (SRC_URL === DST_URL) {
  console.error('SRC_URL et DST_URL sont identiques — refus de copier un projet sur lui-meme.');
  process.exit(1);
}

const src = createClient(SRC_URL, SRC_KEY, { auth: { persistSession: false } });
const dst = createClient(DST_URL, DST_KEY, { auth: { persistSession: false } });

/**
 * Liste recursivement les fichiers d'un bucket.
 * L'API `list` ne descend pas dans les sous-dossiers et pagine par 100 :
 * les deux pieges qui font silencieusement rater des fichiers.
 */
async function listerRecursif(client, bucket, prefixe = '') {
  const fichiers = [];
  const PAGE = 100;
  let offset = 0;

  for (;;) {
    const { data, error } = await client.storage
      .from(bucket)
      .list(prefixe, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });

    if (error) throw new Error(`list ${bucket}/${prefixe} : ${error.message}`);
    if (!data || data.length === 0) break;

    for (const entree of data) {
      const chemin = prefixe ? `${prefixe}/${entree.name}` : entree.name;
      // Un dossier se reconnait a l'absence de metadonnees.
      if (entree.id === null || entree.metadata === null) {
        fichiers.push(...(await listerRecursif(client, bucket, chemin)));
      } else {
        fichiers.push({ chemin, taille: entree.metadata?.size ?? 0, type: entree.metadata?.mimetype });
      }
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  return fichiers;
}

let totalOk = 0;
let totalEchec = 0;
let totalOctets = 0;
const echecs = [];

for (const bucket of BUCKETS) {
  process.stdout.write(`\n${bucket}\n`);

  let fichiers;
  try {
    fichiers = await listerRecursif(src, bucket);
  } catch (e) {
    console.error(`  listage impossible : ${e.message}`);
    totalEchec++;
    echecs.push({ bucket, chemin: '(listage)', raison: e.message });
    continue;
  }

  if (fichiers.length === 0) {
    console.log('  vide');
    continue;
  }
  console.log(`  ${fichiers.length} fichier(s)`);
  if (DRY_RUN) {
    totalOctets += fichiers.reduce((s, f) => s + f.taille, 0);
    continue;
  }

  let i = 0;
  for (const f of fichiers) {
    i++;
    try {
      const { data: blob, error: eDl } = await src.storage.from(bucket).download(f.chemin);
      if (eDl) throw new Error(`telechargement : ${eDl.message}`);

      const { error: eUp } = await dst.storage.from(bucket).upload(f.chemin, blob, {
        upsert: true,
        contentType: f.type || 'application/octet-stream',
      });
      if (eUp) throw new Error(`envoi : ${eUp.message}`);

      totalOk++;
      totalOctets += f.taille;
    } catch (e) {
      totalEchec++;
      echecs.push({ bucket, chemin: f.chemin, raison: e.message });
      console.error(`  ECHEC ${f.chemin} : ${e.message}`);
    }
    if (i % 25 === 0) process.stdout.write(`  ... ${i}/${fichiers.length}\n`);
  }
}

console.log('\n=== Bilan ===');
if (DRY_RUN) {
  console.log('  (simulation, rien n a ete copie)');
}
console.log(`  copies  : ${totalOk}`);
console.log(`  echecs  : ${totalEchec}`);
console.log(`  volume  : ${(totalOctets / 1024 / 1024).toFixed(2)} Mo`);

if (echecs.length) {
  console.log('\n  Detail des echecs :');
  for (const e of echecs.slice(0, 30)) console.log(`    ${e.bucket}/${e.chemin} — ${e.raison}`);
  if (echecs.length > 30) console.log(`    ... et ${echecs.length - 30} autres`);
}

// Sortie non nulle si quoi que ce soit a echoue : un transfert partiel ne doit
// pas passer pour un succes.
process.exit(totalEchec > 0 ? 1 : 0);
