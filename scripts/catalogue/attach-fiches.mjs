// ============================================================================
// Dépose des fiches techniques PDF sur les produits d'un fournisseur (bucket privé product-documents +
// majordhome.product_documents), exactement comme le ferait l'écran Documents du produit :
//   chemin `${orgId}/${productId}/${uuid}.pdf` (un objet Storage PAR produit : la suppression d'un document
//   depuis l'app efface l'objet, un fichier partagé entre produits casserait les autres).
// Source = la section `fiches` du tarif JSON : { fichier, document_type, nom_document, prefixes[] } → chaque
// article dont la référence commence par un préfixe reçoit la fiche. Idempotent : un produit qui porte déjà un
// document du même nom est sauté.
// Canaux : Storage via supabase-js (clé service_role DST_KEY de .env.local) ; lignes product_documents via
// l'API Management (SUPABASE_ACCESS_TOKEN), service_role n'ayant pas d'INSERT sur majordhome.*.
// Usage : node scripts/catalogue/attach-fiches.mjs --fichier scripts/catalogue/data/ecostal-2026-04.json
//           --dossier "G:/Mon Drive/3. Mayer Energie/Fournisseurs/Ecostal" [--env .env.local] [--org 3c68193e-…]
// ============================================================================
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ORG = opt('--org', '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1');
const REF = opt('--ref', 'ejqqqwudmizqisdkxohw');
const fichier = opt('--fichier');
const dossier = opt('--dossier');
if (!fichier || !dossier) { console.error('--fichier <tarif.json> et --dossier <dossier des PDF> requis'); process.exit(2); }

const env = Object.fromEntries(readFileSync(opt('--env', '.env.local'), 'utf8').split(/\r?\n/)
  .filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const { DST_URL, DST_KEY, SUPABASE_ACCESS_TOKEN } = env;
if (!DST_URL || !DST_KEY || !SUPABASE_ACCESS_TOKEN) { console.error('DST_URL, DST_KEY et SUPABASE_ACCESS_TOKEN requis dans le fichier env'); process.exit(2); }
if (!DST_URL.includes(REF)) { console.error(`DST_URL ne pointe pas sur le projet ${REF}`); process.exit(2); }

const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`SQL HTTP ${r.status} : ${JSON.stringify(body).slice(0, 500)}`);
  return body;
}

const tarif = JSON.parse(readFileSync(fichier, 'utf8'));
const fiches = tarif.fiches || [];
if (!fiches.length) { console.error('Aucune fiche dans le tarif'); process.exit(2); }

const produits = await sql(`SELECT p.id, p.reference, p.name,
    COALESCE((SELECT json_agg(d.file_name) FROM majordhome.product_documents d WHERE d.supplier_product_id = p.id), '[]'::json) AS docs
  FROM majordhome.supplier_products p JOIN majordhome.suppliers s ON s.id = p.supplier_id
  WHERE s.org_id = ${q(ORG)} AND s.name = ${q(tarif.fournisseur.nom)} AND p.is_active`);
if (!produits.length) throw new Error(`Aucun produit actif pour ${tarif.fournisseur.nom} : lancer l'import du tarif d'abord`);

const storage = createClient(DST_URL, DST_KEY, { auth: { persistSession: false } }).storage.from('product-documents');
let deposes = 0; let sautes = 0;
for (const f of fiches) {
  const chemin = path.join(dossier, f.fichier);
  const contenu = readFileSync(chemin);
  const nomDoc = f.nom_document || f.fichier;
  const cibles = produits.filter((p) => f.prefixes.some((pre) => p.reference.startsWith(pre)));
  if (!cibles.length) throw new Error(`Fiche ${f.fichier} : aucun produit ciblé`);
  for (const p of cibles) {
    if (p.docs.includes(nomDoc)) { sautes++; continue; }
    const storagePath = `${ORG}/${p.id}/${randomUUID()}.pdf`;
    const { error } = await storage.upload(storagePath, contenu, { contentType: 'application/pdf', upsert: false });
    if (error) throw new Error(`Upload ${storagePath} : ${error.message}`);
    const rows = await sql(`INSERT INTO majordhome.product_documents (supplier_product_id, org_id, document_type, file_name, storage_path, file_size, mime_type)
      VALUES (${q(p.id)}, ${q(ORG)}, ${q(f.document_type || 'Fiche technique')}, ${q(nomDoc)}, ${q(storagePath)}, ${contenu.length}, 'application/pdf') RETURNING id`);
    if (!rows?.[0]?.id) {
      await storage.remove([storagePath]);
      throw new Error(`INSERT product_documents sans ligne pour ${p.reference}`);
    }
    deposes++;
    console.log(`${p.reference} ← ${nomDoc}`);
  }
}
console.log(`${deposes} fiche(s) déposée(s), ${sautes} déjà présente(s) sur ${produits.length} produits.`);
