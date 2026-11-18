#!/usr/bin/env node
/**
 * Régénère les attestations d'entretien et de ramonage des entretiens déjà facturés.
 * ============================================================================
 * Contexte (2026-11-18) : une cliente a réclamé une attestation conforme à l'article
 * R. 1331-75 du Code de la santé publique (conduit ramoné, méthode, vacuité). Le texte
 * a été complété (commit dbd0c7a6) ; ce script refait les attestations déjà émises.
 *
 * Pour chaque carte d'entretien facturée depuis `--depuis` qui porte un certificat avec
 * ramonage : appel de la VRAIE fonction de l'app `genererAttestationsIntervention`
 * (même modèle, même gabarit, même archivage `…-attestation.pdf` à côté du certificat,
 * fichier remplacé), avec la date de facturation de la carte. Seuls le rendu PDF (Node)
 * et, en `--dry-run`, l'archivage (fichiers locaux) sont substitués.
 *
 * Ce qui n'est pas éligible est dit par certificat (motifs de l'app), jamais avalé.
 *
 * Usage :
 *   node scripts/certificats/regenerer-attestations.mjs --env .env.local --dry-run [--out <dossier>]
 *   node scripts/certificats/regenerer-attestations.mjs --env .env.local
 *   options : --depuis 2026-10-24 (défaut)   --carte <id intervention racine> (une seule)
 *
 * `.env.local` doit porter DST_URL / DST_KEY (service_role du projet prod).
 * Le bundle esbuild est écrit dans scripts/certificats/out/ (gitignoré).
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(here, '..', '..');
const src = path.join(racine, 'src');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };
const flag = (name) => args.includes(name);

const dryRun = flag('--dry-run');
const envFile = opt('--env');
const depuis = opt('--depuis') || '2026-10-24';
const carteFiltre = opt('--carte');
const outDir = path.resolve(opt('--out') || path.join(here, 'out', 'attestations'));

if (!envFile || !/^\d{4}-\d{2}-\d{2}$/.test(depuis)) {
  console.error('Usage : --env <fichier .env DST_URL/DST_KEY> [--dry-run] [--depuis AAAA-MM-JJ] [--carte <id>] [--out <dossier>]');
  process.exit(2);
}

function lireEnv(fichier) {
  const txt = fs.readFileSync(fichier, 'utf8');
  return Object.fromEntries(txt.split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
}
const env = lireEnv(path.resolve(envFile));
if (!env.DST_URL || !env.DST_KEY) { console.error('DST_URL / DST_KEY absents du fichier env'); process.exit(2); }
process.env.DST_URL = env.DST_URL;
process.env.DST_KEY = env.DST_KEY;

// Même bundle que regenerer-pdf-manquants.mjs : services de l'app, client Supabase remplacé.
async function construirePont() {
  const outfile = path.join(here, 'out', 'pont-attestations.mjs');
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  const stub = path.join(here, '_supabase-service-role.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, '_pont-certificat.jsx')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    jsx: 'automatic',
    loader: { '.png': 'dataurl' },
    define: { 'import.meta.env': JSON.stringify({ DEV: false, PROD: true, MODE: 'production' }) },
    absWorkingDir: racine,
    alias: {
      '@lib': path.join(src, 'lib'),
      '@services': path.join(src, 'shared', 'services'),
      '@hooks': path.join(src, 'shared', 'hooks'),
      '@hooksPipeline': path.join(src, 'hooks', 'pipeline'),
      '@components': path.join(src, 'components'),
      '@contexts': path.join(src, 'contexts'),
      '@apps': path.join(src, 'apps'),
      '@pages': path.join(src, 'pages'),
      '@layouts': path.join(src, 'layouts'),
      '@': src,
    },
    plugins: [{
      name: 'supabase-service-role',
      setup(b) {
        b.onResolve({ filter: /(^|\/)supabaseClient(\.js)?$/ }, () => ({ path: stub }));
      },
    }],
    logLevel: 'warning',
  });
  return import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
}

/** Date de facturation au calendrier de Paris (`invoiced_at` est un instant UTC). */
const dateParis = (iso) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

const pont = await construirePont();
const { supabase, equipmentCategoriesService, buildCompanyInfo, genererAttestationsIntervention, renderAttestationPdf } = pont;

// Certificats finalisés avec au moins un conduit ramoné → leurs cartes racines facturées.
const { data: certs, error: certErr } = await supabase.from('majordhome_certificats')
  .select('id, reference, org_id, intervention_id, donnees_ramonage')
  .in('statut', ['signe', 'envoye'])
  .not('donnees_ramonage', 'is', null);
if (certErr) { console.error(`certificats illisibles : ${certErr.message}`); process.exit(1); }
const avecRamonage = (certs || []).filter((c) => (c.donnees_ramonage?.conduits || []).some((x) => x?.resultat === 'ramone'));

const { data: itvs, error: itvErr } = await supabase.from('majordhome_interventions')
  .select('id, parent_id').in('id', avecRamonage.map((c) => c.intervention_id));
if (itvErr) { console.error(`interventions illisibles : ${itvErr.message}`); process.exit(1); }
const racineDe = new Map((itvs || []).map((i) => [i.id, i.parent_id || i.id]));
const racines = [...new Set(avecRamonage.map((c) => racineDe.get(c.intervention_id)).filter(Boolean))]
  .filter((id) => !carteFiltre || id === carteFiltre);

const { data: cartes, error: carteErr } = await supabase.from('majordhome_entretien_sav')
  .select('id, org_id, invoiced_at, client_name, client_first_name, client_last_name, client_address, client_postal_code, client_city')
  .in('id', racines)
  .gte('invoiced_at', `${depuis}T00:00:00Z`)
  .order('invoiced_at', { ascending: true });
if (carteErr) { console.error(`cartes illisibles : ${carteErr.message}`); process.exit(1); }

console.log(`${cartes.length} carte(s) facturée(s) depuis le ${depuis} avec un ramonage${dryRun ? ' — DRY RUN (fichiers locaux, rien en Storage)' : ''}`);
if (dryRun) fs.mkdirSync(outDir, { recursive: true });

const cacheOrg = new Map();
async function contexteOrg(orgId) {
  if (cacheOrg.has(orgId)) return cacheOrg.get(orgId);
  const { data: org, error } = await supabase.from('organizations').select('id, settings').eq('id', orgId).maybeSingle();
  if (error || !org) throw new Error(`organisation ${orgId} : ${error?.message || 'introuvable'}`);
  const { data: categories, error: catErr } = await equipmentCategoriesService.getCategories(orgId, { activeOnly: false });
  if (catErr) throw new Error(`catégories : ${catErr.message}`);
  const ctx = { company: buildCompanyInfo(org.settings), categories: categories || [] };
  cacheOrg.set(orgId, ctx);
  return ctx;
}

const archiverLocal = async (storagePath, buffer) => {
  fs.writeFileSync(path.join(outDir, path.basename(storagePath)), buffer);
  return { error: null };
};

let generees = 0;
let echecs = 0;
for (const carte of cartes) {
  const client = {
    name: carte.client_name || `${carte.client_first_name || ''} ${carte.client_last_name || ''}`.trim(),
    address: carte.client_address,
    postal_code: carte.client_postal_code,
    city: carte.client_city,
  };
  const tag = `${client.name} (facturée le ${dateParis(carte.invoiced_at)})`;
  try {
    const { company, categories } = await contexteOrg(carte.org_id);
    const r = await genererAttestationsIntervention({
      orgId: carte.org_id,
      interventionId: carte.id,
      client,
      company,
      categories,
      invoiceDate: dateParis(carte.invoiced_at),
      deps: { rendrePdf: renderAttestationPdf, ...(dryRun ? { archiver: archiverLocal } : {}) },
    });
    generees += r.generated.length;
    console.log(`✔ ${tag} : ${r.generated.length} attestation(s)`);
    r.skipped.forEach((s) => console.log(`   · non générée : ${s.message}`));
    [...new Set(r.warnings)].forEach((w) => console.log(`   · ${w}`));
  } catch (err) {
    echecs += 1;
    console.error(`✘ ${tag} : ${err?.message || err}`);
  }
}

console.log(`\n${generees} attestation(s) ${dryRun ? `écrite(s) dans ${outDir}` : 'régénérée(s) dans le Storage'}, ${echecs} carte(s) en échec.`);
process.exit(echecs ? 1 : 0);
