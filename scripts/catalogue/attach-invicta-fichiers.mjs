// ============================================================================
// Copie des FICHIERS d'un relevé de pièces détachées Invicta dans notre Storage : photo et vues éclatées de chaque
// appareil, notices, fiches techniques et procédures (micrologiciels ignorés). Bucket privé product-documents,
// dossier `${orgId}/equipment-models/site/`. Les fichiers du site sont PUBLICS (CDN, sans session) : aucun
// identifiant n'est utilisé ; 4 téléchargements à la fois.
//   - Un fichier est stocké UNE fois par contenu (`doc-<etag>.pdf`, `img-<fileId>.webp`) : 973 documents = 294
//     contenus distincts au relevé du 2026-11-11.
//   - INCRÉMENTAL : un objet déjà présent n'est ni retéléchargé ni redéposé (relancer = compléter).
//   - NON BLOQUANT : un fichier en échec est compté et listé ; rien d'approximatif n'est écrit (règles pures de
//     scripts/catalogue/invicta-pieces-fichiers.js) ; relancer le script complète.
//   - Écriture en base par la seule RPC public.equipment_models_set_files (service_role), par lots de 60 modèles,
//     via l'API de management ; puis photo des articles du tarif de même référence (posée si l'article n'en a pas).
// Usage : node scripts/catalogue/attach-invicta-fichiers.mjs --fichier scripts/catalogue/data/invicta-pieces-AAAA-MM-JJ.json
//           [--env .env.local] [--org 3c68193e-…] [--fournisseur INVICTA] [--sans-ecriture] [--limite N]
// À lancer APRÈS import-invicta-pieces.mjs + apply-sql (les modèles doivent exister en base).
// ============================================================================
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { controlerReleve } from './invicta-pieces-releve.js';
import {
  cleContenu, extensionDepuisMime, cheminImage, cheminDocument, dossierSite, fichiersACopier, fichiersPourModeles,
} from './invicta-pieces-fichiers.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const drapeau = (k) => args.includes(k);
const ORG = opt('--org', '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1');
const REF = opt('--ref', 'ejqqqwudmizqisdkxohw');
const NOM = opt('--fournisseur', 'INVICTA');
const fichier = opt('--fichier');
const LIMITE = Number(opt('--limite', 0)) || 0;
const SANS_ECRITURE = drapeau('--sans-ecriture');
const BUCKET = 'product-documents';
const TAILLE_MAX = 20 * 1024 * 1024; // limite du bucket
const CONCURRENCE = 4;
const TAILLE_LOT = 60;
if (!fichier) { console.error('--fichier <relevé JSON> requis'); process.exit(2); }

const env = Object.fromEntries(readFileSync(opt('--env', '.env.local'), 'utf8').split(/\r?\n/)
  .filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const { DST_URL, DST_KEY, SUPABASE_ACCESS_TOKEN } = env;
if (!DST_URL || !DST_KEY || !SUPABASE_ACCESS_TOKEN) { console.error('DST_URL, DST_KEY et SUPABASE_ACCESS_TOKEN requis dans le fichier env'); process.exit(2); }
if (!DST_URL.includes(REF)) { console.error(`DST_URL ne pointe pas sur le projet ${REF}`); process.exit(2); }

const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`SQL HTTP ${r.status} : ${JSON.stringify(body).slice(0, 500)}`);
  return body;
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function parLots(liste, fn) {
  for (let i = 0; i < liste.length; i += CONCURRENCE) {
    await Promise.all(liste.slice(i, i + CONCURRENCE).map(fn));
    if ((i / CONCURRENCE) % 25 === 24) console.log(`  … ${Math.min(i + CONCURRENCE, liste.length)} / ${liste.length}`);
    await pause(100);
  }
}
/** fetch avec 3 essais sur erreur réseau ou 5xx ; rend la réponse (même 4xx) ou lève. */
async function appel(url, init) {
  for (let essai = 1; ; essai++) {
    try {
      const r = await fetch(url, init);
      if (r.status < 500) return r;
      if (essai >= 3) return r;
    } catch (e) {
      if (essai >= 3) throw e;
    }
    await pause(1500 * essai);
  }
}

const releve = JSON.parse(readFileSync(fichier, 'utf8'));
const controle = controlerReleve(releve);
if (!controle.ok) throw new Error(`Relevé incomplet : ${controle.erreurs.slice(0, 5).join(' ; ')}`);
const site = String(releve.source || '').replace(/\/api\/.*$/, '');
if (!/^https:\/\/pieces-detachees\.invicta-group\.fr$/.test(site)) throw new Error(`Site inattendu dans le relevé : ${site}`);
const marque = releve.manufacturer.name;
const version = `invicta-pieces_${String(releve.fetched_at).slice(0, 10)}`;

let { images, documents, ignores } = fichiersACopier(releve);
if (LIMITE) { images = images.slice(0, LIMITE); documents = documents.slice(0, LIMITE); }
console.log(`${marque} — ${images.length} images, ${documents.length} documents à ranger (ignorés : ${JSON.stringify(ignores)})`);

const storage = createClient(DST_URL, DST_KEY, { auth: { persistSession: false } }).storage.from(BUCKET);
const dossier = dossierSite(ORG);
const presents = new Map(); // nom → taille
for (let offset = 0; ; offset += 1000) {
  const { data, error } = await storage.list(dossier, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
  if (error) throw new Error(`Liste du Storage : ${error.message}`);
  for (const o of data || []) presents.set(o.name, o.metadata?.size ?? null);
  if (!data || data.length < 1000) break;
}
console.log(`${presents.size} fichiers déjà présents dans ${dossier}`);

const deposes = { images: new Map(), documents: new Map() };
const echecs = [];
const compte = { deposes: 0, deja: 0, octets: 0 };
const nomDe = (chemin) => chemin.slice(dossier.length + 1);

async function deposer(chemin, contenu, mime) {
  const { error } = await storage.upload(chemin, contenu, { contentType: mime, upsert: false });
  if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(error.message);
  presents.set(nomDe(chemin), contenu.length);
  compte.deposes += 1; compte.octets += contenu.length;
}

// 1. Images : l'identifiant de fichier du site est l'identité (une variante = un fichier immuable).
const extsImage = ['webp', 'jpg', 'png'];
await parLots(images, async (img) => {
  try {
    const dejaLa = extsImage.map((e) => cheminImage(ORG, img.fileId, e)).find((c) => presents.has(nomDe(c)));
    if (dejaLa) { deposes.images.set(img.fileId, { path: dejaLa }); compte.deja += 1; return; }
    if (!img.url.startsWith('https://cdn.prod.platform.invicta-group.fr/')) throw new Error(`adresse inattendue ${img.url}`);
    const r = await appel(img.url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const mime = (r.headers.get('content-type') || '').split(';')[0];
    const ext = extensionDepuisMime(mime);
    if (!ext || !mime.startsWith('image/')) throw new Error(`type ${mime} non accepté`);
    const contenu = Buffer.from(await r.arrayBuffer());
    if (!contenu.length || contenu.length > TAILLE_MAX) throw new Error(`taille ${contenu.length}`);
    const chemin = cheminImage(ORG, img.fileId, ext);
    await deposer(chemin, contenu, mime);
    deposes.images.set(img.fileId, { path: chemin });
  } catch (e) { echecs.push(`image ${img.fileId} : ${e.message}`); }
});
console.log(`Images : ${deposes.images.size} / ${images.length} rangées`);

// 2. Documents : HEAD (empreinte, taille, type) puis dépôt du contenu s'il n'est pas déjà là.
const nonPdf = [];
const enCours = new Map(); // clé de contenu → promesse de dépôt (deux documents de même contenu dans le même lot)
await parLots(documents, async (d) => {
  try {
    const url = `${site}/media/documents/${d.fileKey}`;
    const h = await appel(url, { method: 'HEAD' });
    if (h.status === 404 || h.status === 403 || h.status === 410) { deposes.documents.set(d.id, { absent: true }); return; }
    if (!h.ok) throw new Error(`HTTP ${h.status}`);
    const mime = (h.headers.get('content-type') || '').split(';')[0];
    const ext = extensionDepuisMime(mime);
    const cle = cleContenu(h.headers.get('etag'));
    // Le CDN n'annonce pas toujours la taille sur un HEAD (29 cas sur 973 mesurés) : elle est alors lue sur le
    // fichier téléchargé, ou sur l'objet déjà rangé.
    const annoncee = Number(h.headers.get('content-length')) || null;
    // Un document qui n'est pas un PDF (un .docx au relevé du 2026-11-11) n'est pas importé : écarté comme un lien
    // mort, pour ne pas bloquer les autres documents du modèle.
    if (ext !== 'pdf') { deposes.documents.set(d.id, { absent: true }); nonPdf.push(`${d.label} (${mime})`); return; }
    if (!cle) throw new Error('empreinte (ETag) absente');
    if (annoncee && annoncee > TAILLE_MAX) throw new Error(`taille ${annoncee} au-dessus de la limite du bucket`);
    const chemin = cheminDocument(ORG, cle, ext);
    if (!presents.has(nomDe(chemin))) {
      if (!enCours.has(cle)) {
        enCours.set(cle, (async () => {
          const r = await appel(url);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const contenu = Buffer.from(await r.arrayBuffer());
          if (!contenu.length || contenu.length > TAILLE_MAX) throw new Error(`taille ${contenu.length} hors limite`);
          if (annoncee && contenu.length !== annoncee) throw new Error(`taille reçue ${contenu.length} ≠ annoncée ${annoncee}`);
          if (contenu.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('contenu qui n\'est pas un PDF');
          await deposer(chemin, contenu, 'application/pdf');
        })());
      }
      await enCours.get(cle);
    } else compte.deja += 1;
    const taille = annoncee || presents.get(nomDe(chemin));
    if (!(taille > 0)) throw new Error('taille inconnue');
    deposes.documents.set(d.id, { path: chemin, size: taille, mime: 'application/pdf', ext });
  } catch (e) { echecs.push(`document ${d.id} (${d.label}) : ${e.message}`); }
});
const absents = [...deposes.documents.values()].filter((v) => v.absent).length;
console.log(`Documents : ${deposes.documents.size - absents} / ${documents.length} rangés, ${absents} écartés (lien mort ou autre format qu'un PDF)`);
if (nonPdf.length) console.log(`  non importés (pas un PDF) : ${nonPdf.join(' ; ')}`);
console.log(`Storage : ${compte.deposes} fichiers déposés (${Math.round(compte.octets / 1048576)} Mo), ${compte.deja} déjà présents`);

// 3. Écriture en base.
const { fichiers, bilan } = fichiersPourModeles(releve, deposes);
console.table(bilan);
if (SANS_ECRITURE || LIMITE) {
  console.log('Pas d\'écriture en base (--sans-ecriture ou --limite).');
} else {
  const total = { modeles: 0, documents: 0, documents_retires: 0 };
  for (let i = 0; i < fichiers.length; i += TAILLE_LOT) {
    const lot = JSON.stringify(fichiers.slice(i, i + TAILLE_LOT));
    if (lot.includes('$files$')) throw new Error('Balise $files$ présente dans les données');
    const [ligne] = await sql(`select public.equipment_models_set_files(${q(ORG)}, ${q(marque)}, ${q(version)}, $files$${lot}$files$::jsonb) as res`);
    for (const k of Object.keys(total)) total[k] += Number(ligne.res[k] || 0);
  }
  console.log(`Base : ${JSON.stringify(total)}`);
  // Photo des articles du tarif de même référence qu'un modèle (champ humain : posée seulement si elle est vide) —
  // adresse publique du CDN du fabricant, comme les photos des autres relevés de catalogue.
  const photos = releve.appareils.filter((a) => a.photo?.url).map((a) => ({ reference: a.reference, url: a.photo.url }));
  if (photos.length) {
    const corps = JSON.stringify(photos);
    if (corps.includes('$photos$')) throw new Error('Balise $photos$ présente dans les données');
    const [res] = await sql(`
      with ph as (select distinct on (reference) reference, url from jsonb_to_recordset($photos$${corps}$photos$::jsonb) as x(reference text, url text) order by reference),
      lignes as (
        update majordhome.supplier_products p set image_url = ph.url, image_source_url = ${q(site)}, updated_at = now()
        from ph, majordhome.suppliers s
        where s.org_id = ${q(ORG)} and s.name = ${q(NOM)} and p.supplier_id = s.id and p.org_id = s.org_id
          and p.reference = ph.reference and p.category is distinct from 'piece_detachee' and p.image_url is null
        returning p.catalog_item_id, ph.url),
      articles as (
        update majordhome.catalog_items ci set image_url = l.url, updated_at = now()
        from (select distinct on (catalog_item_id) catalog_item_id, url from lignes where catalog_item_id is not null order by catalog_item_id) l
        where ci.id = l.catalog_item_id and ci.image_url is null
        returning ci.id)
      select (select count(*) from lignes) as lignes, (select count(*) from articles) as articles`);
    console.log(`Photos du tarif ${NOM} : ${res.lignes} lignes, ${res.articles} articles`);
  }
}
if (echecs.length) {
  console.warn(`⚠ ${echecs.length} fichier(s) en échec — relancer le script pour compléter :`);
  for (const e of echecs.slice(0, 20)) console.warn(`   ${e}`);
  if (echecs.length > 20) console.warn(`   … et ${echecs.length - 20} autres`);
  process.exitCode = 1;
}
