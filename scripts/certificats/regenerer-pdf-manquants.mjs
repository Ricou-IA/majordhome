#!/usr/bin/env node
/**
 * Régénère les PDF manquants des certificats SIGNÉS et remet les cartes d'accord.
 * ============================================================================
 * Contexte (2026-10-01) : 18 certificats signés sans PDF ni clôture — le wizard
 * attendait un 2ᵉ bouton après la signature (corrigé dans CertificatWizard :
 * « Valider la signature » clôture en un geste). Ce script rattrape le stock :
 *
 *   pour chaque certificat `statut='signe'` sans `pdf_storage_path` :
 *     1. carte : enfant pas « réalisé » (ou passé « Néant » à la main) et racine
 *        pas réalisée/facturée → `savService.markRealise` (le vrai écrivain :
 *        clôture du parent, visite annuelle, contrat rattaché) ;
 *     2. PDF : rendu du VRAI gabarit (CertificatDocument) avec les mêmes
 *        données que le wizard → Storage `certificats` → `pdf_storage_path`
 *        via `certificatsService` (uploadPdf / getSignedUrl / updatePdfInfo).
 *
 * Rien n'est recalculé : les données du certificat sont relues telles quelles.
 * Un échec est signalé par certificat et fait sortir en code 1 ; rien n'est
 * avalé. `--dry-run` écrit les PDF en local (pour contrôle visuel) et affiche
 * le plan sans toucher à la base ni au Storage.
 *
 * Usage :
 *   node scripts/certificats/regenerer-pdf-manquants.mjs --env .env.local --dry-run [--out <dossier>]
 *   node scripts/certificats/regenerer-pdf-manquants.mjs --env .env.local
 *   options : --ref CERT-2026-00940   (un seul)   --technicien Verloo   (filtre nom)
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

// --------------------------------------------------------------------------
// Arguments
// --------------------------------------------------------------------------
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };
const flag = (name) => args.includes(name);

const dryRun = flag('--dry-run');
const envFile = opt('--env');
const refFiltre = opt('--ref');
const techFiltre = opt('--technicien');
const outDir = path.resolve(opt('--out') || path.join(here, 'out', 'pdf'));

if (!envFile) {
  console.error('Usage : --env <fichier .env DST_URL/DST_KEY> [--dry-run] [--ref CERT-…] [--technicien <nom>] [--out <dossier>]');
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

// --------------------------------------------------------------------------
// Bundle : services de l'app + gabarit PDF, client Supabase remplacé
// --------------------------------------------------------------------------
async function construirePont() {
  const outfile = path.join(here, 'out', 'pont-certificat.mjs');
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  const stub = path.join(here, '_supabase-service-role.mjs');
  await esbuild.build({
    entryPoints: [path.join(here, '_pont-certificat.jsx')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external', // node_modules résolus à l'exécution (react-pdf build node)
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

// --------------------------------------------------------------------------
// Lectures (mêmes vues que l'app)
// --------------------------------------------------------------------------
async function uneLigne(q, contexte) {
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`${contexte} : ${error.message}`);
  return data;
}

async function listerCertificats(supabase) {
  let q = supabase.from('majordhome_certificats').select('*')
    .eq('statut', 'signe').is('pdf_storage_path', null).order('signed_at', { ascending: true });
  if (refFiltre) q = q.eq('reference', refFiltre);
  if (techFiltre) q = q.ilike('technicien_nom', `%${techFiltre}%`);
  const { data, error } = await q;
  if (error) throw new Error(`liste certificats : ${error.message}`);
  return data || [];
}

/** Décide le geste carte, comme CertificatWizard.finaliser (racine close ⇒ rien). */
function gesteCarte(intervention) {
  if (!intervention) return { action: 'aucune', raison: 'intervention introuvable' };
  const estEnfant = !!intervention.parent_id;
  const realise = intervention.workflow_status === 'realise';
  const neant = realise && intervention.status === 'cancelled';
  if (estEnfant) {
    if (!realise) return { action: 'markRealise', raison: `enfant ${intervention.workflow_status} → réalisé` };
    if (neant) return { action: 'markRealise', raison: 'enfant « Néant » → rempli' };
    return { action: 'aucune', raison: 'enfant déjà rempli' };
  }
  if (['realise', 'facture'].includes(intervention.workflow_status)) {
    return { action: 'aucune', raison: `racine déjà ${intervention.workflow_status}` };
  }
  return { action: 'markRealise', raison: `racine ${intervention.workflow_status} → réalisé` };
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------
const pont = await construirePont();
const { supabase, savService, certificatsService, equipmentCategoriesService, buildCompanyInfo, indexReferentiel, renderCertificatPdf } = pont;

const certificats = await listerCertificats(supabase);
console.log(`${certificats.length} certificat(s) signé(s) sans PDF${dryRun ? ' — DRY RUN (aucune écriture)' : ''}`);
if (certificats.length === 0) process.exit(0);
if (dryRun) fs.mkdirSync(outDir, { recursive: true });

const cacheOrg = new Map(); // org_id → { company, referentiel }
async function contexteOrg(orgId) {
  if (cacheOrg.has(orgId)) return cacheOrg.get(orgId);
  const org = await uneLigne(supabase.from('organizations').select('id, settings').eq('id', orgId), 'organisation');
  if (!org) throw new Error(`organisation ${orgId} introuvable`);
  const { data: categories, error } = await equipmentCategoriesService.getCategories(orgId, { activeOnly: false });
  if (error) throw new Error(`catégories : ${error.message}`);
  const ctx = { company: buildCompanyInfo(org.settings), referentiel: indexReferentiel({ categories }) };
  cacheOrg.set(orgId, ctx);
  return ctx;
}

const echecs = [];
let pdfOk = 0; let cartesOk = 0;

for (const cert of certificats) {
  const tag = `${cert.reference} (${cert.technicien_nom || '?'}, signé le ${String(cert.signed_at).slice(0, 10)})`;
  try {
    const intervention = await uneLigne(
      supabase.from('majordhome_interventions').select('id, parent_id, workflow_status, status, client_id, contract_id').eq('id', cert.intervention_id),
      'intervention',
    );
    const client = cert.client_id
      ? await uneLigne(supabase.from('majordhome_clients').select('id, display_name, last_name, address, postal_code, city, phone').eq('id', cert.client_id), 'client')
      : null;
    const contractId = cert.contract_id || intervention?.contract_id || null;
    const contract = contractId
      ? await uneLigne(supabase.from('majordhome_contracts').select('id, contract_number').eq('id', contractId), 'contrat')
      : null;
    if (!client) throw new Error('client introuvable (client_id du certificat)');

    const { company, referentiel } = await contexteOrg(cert.org_id);
    const geste = gesteCarte(intervention);

    // Mêmes champs que `pdfData` du wizard — rien de recalculé.
    const pdfData = {
      ...cert,
      profil: referentiel.profilParCode(cert.equipement_type),
      equipement_type_label: referentiel.categoriesByCode.get(cert.equipement_type)?.label || cert.equipement_type,
      reference: contract?.contract_number || cert.reference || '',
      client_name: client.display_name || client.last_name || '',
      client_address: [client.address, client.postal_code, client.city].filter(Boolean).join(', '),
      client_phone: client.phone || '',
    };

    const buffer = await renderCertificatPdf(pdfData, company);

    if (dryRun) {
      const fichier = path.join(outDir, `${cert.reference}.pdf`);
      fs.writeFileSync(fichier, buffer);
      console.log(`• ${tag}\n    carte : ${geste.action} (${geste.raison})\n    PDF   : ${buffer.length} octets → ${fichier}`);
      continue;
    }

    // 1. Carte (avant le PDF, comme dans l'app)
    if (geste.action === 'markRealise') {
      const { error } = await savService.markRealise(intervention.id, { visitDate: cert.date_intervention || null });
      if (error) throw new Error(`markRealise : ${error.message || error}`);
      cartesOk += 1;
    }

    // 2. PDF → Storage → ligne certificat
    const blob = new Blob([buffer], { type: 'application/pdf' });
    const up = await certificatsService.uploadPdf(cert.org_id, client.id, cert.id, blob);
    if (up.error) throw new Error(`uploadPdf : ${up.error.message || up.error}`);
    const url = await certificatsService.getSignedUrl(up.data.storagePath);
    if (url.error) throw new Error(`getSignedUrl : ${url.error.message || url.error}`);
    const maj = await certificatsService.updatePdfInfo(cert.id, up.data.storagePath, url.data || '');
    if (maj.error) throw new Error(`updatePdfInfo : ${maj.error.message || maj.error}`);
    if (!maj.data?.pdf_storage_path) throw new Error('updatePdfInfo : ligne non mise à jour (0 ligne)');
    pdfOk += 1;
    console.log(`✓ ${tag}\n    carte : ${geste.action} (${geste.raison})\n    PDF   : ${up.data.storagePath}`);
  } catch (err) {
    echecs.push({ ref: cert.reference, message: err.message });
    console.error(`✗ ${tag}\n    ${err.message}`);
  }
}

console.log(`\nBilan : ${dryRun ? `${certificats.length - echecs.length} PDF rendus en local` : `${pdfOk} PDF archivés, ${cartesOk} carte(s) mise(s) à jour`}, ${echecs.length} échec(s).`);
if (echecs.length) {
  for (const e of echecs) console.error(`  - ${e.ref} : ${e.message}`);
  process.exit(1);
}
