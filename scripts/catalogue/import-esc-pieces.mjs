// ============================================================================
// Import du relevé des PIÈCES DÉTACHÉES d'ESC Grossiste (chaudières, poêles, chauffe-eaux).
// scripts/catalogue/data/esc-pieces-AAAA-MM.json → SQL REJOUABLE dans scripts/catalogue/out/, qui appelle
// public.supplier_pieces_upsert — SEUL écrivain d'un relevé de pièces, en UN appel (une pièce absente de l'appel est
// désactivée), marque de relevé CATALOGUE (les lignes sont lues par la vue majordhome_pieces_catalogue, donc par
// « Trouver une pièce »). Écriture par l'API de management : pas de limite de 8 s (≈ 3 à 7 ms par pièce nouvelle).
// La transformation est l'adaptateur PUR scripts/catalogue/esc-pieces.js (testé sur le relevé réel).
//
// ESC Grossiste est une boutique PrestaShop sans API publique : pas de connecteur, pas de relevé de nuit. La fiche
// fournisseur est créée par ce SQL si elle n'existe pas ; un fournisseur CONNECTÉ (connector non NULL) est refusé.
//
// MISE À JOUR :
//   1. python -I scripts/catalogue/releve-esc-pieces.py --cache <dossier vide hors dépôt> --sortie scripts/catalogue/data/esc-pieces-AAAA-MM.json
//   2. mettre à jour les chiffres pinnés de scripts/catalogue/esc-pieces.test.mjs (nouveau fichier de relevé)
//   3. node scripts/catalogue/import-esc-pieces.mjs --fichier scripts/catalogue/data/esc-pieces-AAAA-MM.json [--essai]
//   4. node scripts/fumisterie/apply-sql.mjs --env .env.local --ref ejqqqwudmizqisdkxohw --dir scripts/catalogue/out --match esc-pieces_AAAA-MM-JJ
//
// Options : --fournisseur "ESC Grossiste" (défaut) · --org <uuid> · --env .env.local · --essai (même bloc, ANNULÉ à la
// fin : l'erreur « ESSAI_ANNULE » porte la durée et le résultat, rien n'est conservé).
// Prix : le prix du site est le PRIX PUBLIC TTC ; public HT = TTC ÷ 1,2 ; achat = public HT − remise de la fiche
// fournisseur (connector_config.pieces.remise_pct, 0 % tant qu'elle n'est pas réglée).
// ============================================================================
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { piecesDepuisReleveEsc } from './esc-pieces.js';
import { MARQUE_RELEVE } from '../../src/lib/catalogue/woocommercePieces.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };

const PROJET = 'ejqqqwudmizqisdkxohw';
const MAX_PIECES_OCTETS = 4 * 1024 * 1024;
const SITE = 'https://www.esc-grossiste.fr/boutique/';

const fichier = opt('--fichier');
if (!fichier) { console.error('--fichier <relevé JSON> requis'); process.exit(2); }
const nom = opt('--fournisseur', 'ESC Grossiste');
const ORG = opt('--org', '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1');
const essai = args.includes('--essai');

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
const [fournisseur] = await requete(`select id, connector, connector_config from majordhome.suppliers where org_id = ${q(ORG)} and name = ${q(nom)}`);
if (fournisseur && fournisseur.connector) throw new Error(`« ${nom} » est un fournisseur connecté (${fournisseur.connector}) : son catalogue est relevé par la connexion, pas par ce script`);
const remisePct = fournisseur?.connector_config?.pieces?.remise_pct ?? 0;
const version = `esc-pieces_${String(releve.fetched_at).slice(0, 10)}`;

const { lignes, compte } = piecesDepuisReleveEsc(releve, { version, remisePct });
const rows = JSON.stringify(lignes);
if (Buffer.byteLength(rows) > MAX_PIECES_OCTETS) {
  throw new Error(`Liste des pièces trop lourde pour un appel unique (${Buffer.byteLength(rows)} octets) : la désactivation ciblée exige un seul appel`);
}
const garde = (texte, balise) => { if (texte.includes(balise)) throw new Error(`Balise ${balise} présente dans les données`); return texte; };

const OUT = path.join(racine, 'scripts', 'catalogue', 'out');
mkdirSync(OUT, { recursive: true });
const sortie = path.join(OUT, `${version}_00_pieces${essai ? '_essai' : ''}.sql`);
const notes = 'Pièces détachées relevées par script sur le site (scripts/catalogue/releve-esc-pieces.py), sans relevé automatique.';
const fin = essai
  ? `RAISE EXCEPTION 'ESSAI_ANNULE duree_ms=% resultat=%', round(extract(epoch from clock_timestamp() - t0) * 1000), v_res::text;`
  : `RAISE NOTICE 'supplier_pieces_upsert ${version} : %', v_res;`;
writeFileSync(sortie, `-- Import pièces détachées ${version} — fournisseur « ${nom} »${essai ? ' — ESSAI (annulé à la fin)' : ''}. Rejouable.
-- Généré par scripts/catalogue/import-esc-pieces.mjs ; ne jamais éditer à la main.
DO $esc$
DECLARE v_org uuid := ${q(ORG)}; v_sup uuid; v_connector text; v_res jsonb; t0 timestamptz := clock_timestamp();
BEGIN
  SELECT id, connector INTO v_sup, v_connector FROM majordhome.suppliers WHERE org_id = v_org AND name = ${q(nom)};
  IF v_sup IS NULL THEN
    INSERT INTO majordhome.suppliers (org_id, name, site_url, notes) VALUES (v_org, ${q(nom)}, ${q(SITE)}, ${q(notes)}) RETURNING id INTO v_sup;
  ELSIF v_connector IS NOT NULL THEN
    RAISE EXCEPTION 'fournisseur connecté (%) : relevé par script refusé', v_connector;
  END IF;
  v_res := public.supplier_pieces_upsert(v_org, v_sup, ${q(version)}, ${q(MARQUE_RELEVE)}, $rows$${garde(garde(rows, '$rows$'), '$esc$')}$rows$::jsonb);
  UPDATE majordhome.suppliers
  SET catalog_sync_result = catalog_sync_result || jsonb_build_object('compte', ${q(JSON.stringify(compte))}::jsonb), updated_at = now()
  WHERE id = v_sup AND org_id = v_org;
  ${fin}
END $esc$;
`, 'utf8');

console.log(`${nom} — relevé du ${releve.fetched_at}${fournisseur ? '' : ' (fiche fournisseur absente : créée par le SQL)'}`);
console.table({ ...compte, remise_pct: Number(remisePct), octets: Buffer.byteLength(rows) });
console.log(`SQL → ${path.relative(racine, sortie)}${essai ? ' (ESSAI : annulé à la fin)' : ''}`);
