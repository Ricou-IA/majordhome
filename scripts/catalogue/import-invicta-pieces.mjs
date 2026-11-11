// ============================================================================
// Import d'un relevé de PIÈCES DÉTACHÉES du groupe Invicta (pièces + modèles d'appareil + nomenclature).
// scripts/catalogue/data/invicta-pieces-AAAA-MM-JJ.json → SQL REJOUABLE dans scripts/catalogue/out/, qui appelle :
//   1. public.supplier_pieces_upsert   — SEUL écrivain d'un relevé de pièces (le tarif du fournisseur n'est jamais
//      désactivé ni réécrit ; le prix de vente suit le prix public sauf ajustement manuel) ;
//   2. public.equipment_models_upsert  — modèles + nomenclature, par lots de 60 modèles ;
//   3. public.equipment_models_close   — désactive les modèles absents, rattache les équipements dont le modèle
//      saisi est exactement une référence fabricant.
// La transformation est l'adaptateur PUR scripts/catalogue/invicta-pieces.js (testé sur le relevé réel).
//
// MISE À JOUR (quelques minutes) :
//   1. navigateur connecté à https://pieces-detachees.invicta-group.fr → coller
//      scripts/catalogue/dump-invicta-pieces.browser.js dans la console → fichier téléchargé, à déposer dans data/ ;
//   2. node scripts/catalogue/import-invicta-pieces.mjs --fichier scripts/catalogue/data/invicta-pieces-AAAA-MM-JJ.json
//   3. node scripts/fumisterie/apply-sql.mjs --env .env.local --ref ejqqqwudmizqisdkxohw --dir scripts/catalogue/out --match invicta-pieces_AAAA-MM-JJ
//
// Options : --fournisseur "INVICTA" (défaut) · --org <uuid> · --env .env.local · --remise <pourcent> (seulement si la
// remise n'est pas encore réglée sur la fiche fournisseur : elle y est alors inscrite).
// Prix : le prix HT du site est le PRIX PUBLIC ; achat = public − remise du compte (30 % chez Mayer, 2026-11-11).
// ============================================================================
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { piecesDepuisReleveInvicta, lotsParModele } from './invicta-pieces.js';
import { controlerReleve } from './invicta-pieces-releve.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };

const PROJET = 'ejqqqwudmizqisdkxohw';
const TAILLE_LOT = 60;
const MAX_PIECES_OCTETS = 4 * 1024 * 1024;

const fichier = opt('--fichier');
if (!fichier) { console.error('--fichier <relevé JSON> requis'); process.exit(2); }
const nom = opt('--fournisseur', 'INVICTA');
const ORG = opt('--org', '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1');

async function requete(query) {
  const envFichier = path.resolve(racine, opt('--env', '.env.local'));
  const env = Object.fromEntries(readFileSync(envFichier, 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
  if (!env.SUPABASE_ACCESS_TOKEN) throw new Error(`SUPABASE_ACCESS_TOKEN absent de ${envFichier}`);
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJET}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const rows = await r.json();
  if (!r.ok || !Array.isArray(rows)) throw new Error(`lecture en base : HTTP ${r.status} ${JSON.stringify(rows).slice(0, 300)}`);
  return rows;
}

const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const releve = JSON.parse(readFileSync(path.resolve(racine, fichier), 'utf8'));
const controle = controlerReleve(releve);
if (!controle.ok) throw new Error(`Relevé incomplet, rien n'est écrit : ${controle.erreurs.slice(0, 8).join(' ; ')}`);

const [fournisseur] = await requete(`select id, connector_config from majordhome.suppliers where org_id = ${q(ORG)} and name = ${q(nom)}`);
if (!fournisseur) throw new Error(`Fournisseur « ${nom} » inconnu en base pour cette organisation`);
const referencesTarif = (await requete(
  `select distinct reference from majordhome.supplier_products where supplier_id = ${q(fournisseur.id)} and org_id = ${q(ORG)} and category is distinct from 'piece_detachee'`,
)).map((r) => r.reference);

const reglee = fournisseur.connector_config?.pieces?.remise_pct;
const remisePct = reglee ?? opt('--remise');
const version = `invicta-pieces_${String(releve.fetched_at).slice(0, 10)}`;
const marque = releve.manufacturer.name;

const { pieces, modeles, nomenclature, compteRendu } = piecesDepuisReleveInvicta(releve, { version, remisePct, referencesTarif });
if (!pieces.length) throw new Error('Aucune pièce à écrire');

const rows = JSON.stringify(pieces);
if (Buffer.byteLength(rows) > MAX_PIECES_OCTETS) {
  throw new Error(`Liste des pièces trop lourde pour un appel unique (${Buffer.byteLength(rows)} octets) : la désactivation ciblée exige un seul appel`);
}
const garde = (texte, balise) => { if (texte.includes(balise)) throw new Error(`Balise ${balise} présente dans les données`); return texte; };

const OUT = path.join(racine, 'scripts', 'catalogue', 'out');
mkdirSync(OUT, { recursive: true });
const sorties = [];
const ecrire = (suffixe, sql) => { const f = path.join(OUT, `${version}_${suffixe}.sql`); writeFileSync(f, sql, 'utf8'); sorties.push(path.relative(racine, f)); };
const entete = `-- Import pièces détachées ${version} — fournisseur « ${nom} », marque du site « ${marque} ». Rejouable.\n-- Généré par scripts/catalogue/import-invicta-pieces.mjs ; ne jamais éditer à la main.\n`;
const fournisseurSql = `SELECT id INTO v_sup FROM majordhome.suppliers WHERE org_id = v_org AND name = ${q(nom)};\n  IF v_sup IS NULL THEN RAISE EXCEPTION 'fournisseur introuvable'; END IF;`;

// 1. Réglage de la remise (inscrit seulement s'il est absent) + pièces.
const reglage = { remise_pct: Number(compteRendu.remise_pct), marque_site: releve.manufacturer.publicId, site: String(releve.source || '').replace(/\/api\/.*$/, '') };
ecrire('00_pieces', `${entete}DO $$
DECLARE v_org uuid := ${q(ORG)}; v_sup uuid; v_res jsonb;
BEGIN
  ${fournisseurSql}
  UPDATE majordhome.suppliers
  SET connector_config = COALESCE(connector_config, '{}'::jsonb) || jsonb_build_object('pieces', ${q(JSON.stringify(reglage))}::jsonb), updated_at = now()
  WHERE id = v_sup AND NOT (COALESCE(connector_config, '{}'::jsonb) ? 'pieces');
  v_res := public.supplier_pieces_upsert(v_org, v_sup, ${q(version)}, ${q(marque)}, $rows$${garde(rows, '$rows$')}$rows$::jsonb);
  RAISE NOTICE 'supplier_pieces_upsert ${version} : %', v_res;
END $$;
`);

// 2. Modèles + nomenclature, par lots (un modèle n'est jamais coupé).
const lots = lotsParModele(modeles, nomenclature, TAILLE_LOT);
lots.forEach((lot, i) => {
  const models = lot.modeles.map((m) => ({
    source_id: m.source.publicId, reference: m.reference, name: m.name, model_name: m.model_name, category: m.category, lifecycle: m.lifecycle,
    source: { site: m.source.site, publicId: m.source.publicId, photo: m.photo, vues_eclatees: m.exploded_views, documents: m.documents },
  }));
  const parts = lot.parts.map((l) => ({
    modele_source_id: l.modele_source_id, position: l.position, repere: l.repere, piece_reference: l.piece_reference,
    quantity: l.quantity, notes: l.notes, prix_public: l.prix_public,
  }));
  ecrire(`${String(i + 1).padStart(2, '0')}_modeles`, `${entete}DO $$
DECLARE v_org uuid := ${q(ORG)}; v_sup uuid; v_res jsonb;
BEGIN
  ${fournisseurSql}
  v_res := public.equipment_models_upsert(v_org, v_sup, ${q(marque)}, ${q(version)},
    $models$${garde(JSON.stringify(models), '$models$')}$models$::jsonb, $parts$${garde(JSON.stringify(parts), '$parts$')}$parts$::jsonb);
  RAISE NOTICE 'equipment_models_upsert ${version} lot ${i + 1}/${lots.length} : %', v_res;
END $$;
`);
});

// 3. Clôture + marque des lignes du tarif (champ humain : posée seulement si elle est vide).
ecrire('99_cloture', `${entete}DO $$
DECLARE v_org uuid := ${q(ORG)}; v_sup uuid; v_res jsonb; v_n int;
BEGIN
  ${fournisseurSql}
  v_res := public.equipment_models_close(v_org, ${q(marque)}, ${q(version)});
  RAISE NOTICE 'equipment_models_close ${version} : %', v_res;
  UPDATE majordhome.catalog_items ci SET brand = ${q(nom)}, updated_at = now()
  FROM majordhome.supplier_products p
  WHERE p.supplier_id = v_sup AND p.org_id = v_org AND p.catalog_item_id = ci.id
    AND p.category IS DISTINCT FROM 'piece_detachee' AND p.brand IS NULL AND ci.brand IS NULL;
  UPDATE majordhome.supplier_products p SET brand = ${q(nom)}, updated_at = now()
  WHERE p.supplier_id = v_sup AND p.org_id = v_org AND p.category IS DISTINCT FROM 'piece_detachee' AND p.brand IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'marque posée sur % lignes du tarif', v_n;
END $$;
`);

const { references_deja_au_tarif: dejaAuTarif, references_sans_piece: sansPiece, ...resume } = compteRendu;
console.log(`${nom} / ${marque} — relevé du ${releve.fetched_at}`);
console.table(resume);
if (dejaAuTarif.length) console.log(`Références déjà au tarif (non réécrites) : ${dejaAuTarif.join(', ')}`);
if (sansPiece.length) console.warn(`⚠ ${sansPiece.length} appareil(s) sans aucune pièce au relevé (nomenclature existante conservée en base) : ${sansPiece.join(', ')}`);
if (reglee == null) console.log(`Remise non réglée sur la fiche fournisseur : ${compteRendu.remise_pct} % inscrits par cet import.`);
for (const a of compteRendu.avertissements) console.warn(`⚠ ${a}`);
console.log(`${sorties.length} fichiers SQL → scripts/catalogue/out/${version}_*.sql (${lots.length} lots de modèles)`);
