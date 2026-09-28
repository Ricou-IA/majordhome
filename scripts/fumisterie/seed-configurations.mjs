// ============================================================================
// Bibliothèque MODINOX (docs/devis-fumisterie/bibliotheque_configurations_modinox_v1.json)
// + gabarit G1 + nomenclature/mapping CFG-24 (scripts/fumisterie/data/*.json)
// → SQL idempotent (upsert sur code) : scripts/fumisterie/out/seed_configurations.sql.
// Le JSON fait foi pour les 19 configurations (critères, règles, guide, appareils) ;
// les composants avec repère/règle de quantité ne sont posés QUE pour les configurations
// décrites dans data/ (tranche 1 : CFG-24). Les autres gardent leur nomenclature brute.
// Usage : node scripts/fumisterie/seed-configurations.mjs [--org <uuid>]
// ============================================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const ORG = args[args.indexOf('--org') + 1] || '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
const lire = (p) => JSON.parse(readFileSync(p, 'utf8'));
const biblio = lire(path.join(racine, 'docs', 'devis-fumisterie', 'bibliotheque_configurations_modinox_v1.json'));
const g1 = lire(path.join(racine, 'scripts', 'fumisterie', 'data', 'gabarit-g1.json'));
const cfg24 = lire(path.join(racine, 'scripts', 'fumisterie', 'data', 'cfg24-composants.json'));
const map24 = lire(path.join(racine, 'scripts', 'fumisterie', 'data', 'cfg24-mapping.json'));
const VERSION = 'modinox_2026';
const GABARIT_PAR_CODE = { 'CFG-24': 'G1' };
const COMPOSANTS_PAR_CODE = { 'CFG-24': cfg24 };

const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const arr = (a) => `ARRAY[${(a || []).map(q).join(',')}]::text[]`;
const code = (c) => c.id.split('-').slice(0, 2).join('-'); // CFG-24-CREATION-... → CFG-24
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const sql = [`-- Seed configurations ${VERSION} (généré par scripts/fumisterie/seed-configurations.mjs). Idempotent.
DO $$
DECLARE v_org uuid := '${ORG}'; v_sup uuid; v_g uuid; v_c uuid; v_r uuid;
BEGIN
  SELECT id INTO v_sup FROM majordhome.suppliers WHERE org_id = v_org AND name = 'MODINOX / ALTEMA';
  IF v_sup IS NULL THEN RAISE EXCEPTION 'Fournisseur MODINOX / ALTEMA absent : lancer l''import du tarif d''abord'; END IF;`];

// Gabarit G1
sql.push(`  INSERT INTO majordhome.fum_gabarits (org_id, code, libelle, description, troncons) VALUES (v_org, ${q(g1.code)}, ${q(g1.libelle)}, ${q(g1.description)}, ${q(JSON.stringify(g1.troncons))}::jsonb)
  ON CONFLICT (org_id, code) DO UPDATE SET libelle = EXCLUDED.libelle, description = EXCLUDED.description, troncons = EXCLUDED.troncons, updated_at = now();`);

// Règles
for (const r of biblio.regles_techniques) {
  sql.push(`  INSERT INTO majordhome.fum_regles (org_id, code, gamme, page, statut, texte, reference, consequence_devis, bloquante)
  VALUES (v_org, ${q(r.id)}, ${q(r.gamme)}, ${r.page ?? 'NULL'}, ${q(r.statut)}, ${q(r.regle)}, ${q(r.reference)}, ${q(r.consequence_devis)}, ${r.consequence_devis ? 'true' : 'false'})
  ON CONFLICT (org_id, code) DO UPDATE SET texte = EXCLUDED.texte, consequence_devis = EXCLUDED.consequence_devis, bloquante = EXCLUDED.bloquante;`);
}

// Configurations
for (const c of biblio.configurations) {
  const cr = c.criteres;
  const gab = GABARIT_PAR_CODE[code(c)];
  sql.push(`  ${gab ? `SELECT id INTO v_g FROM majordhome.fum_gabarits WHERE org_id = v_org AND code = ${q(gab)};` : 'v_g := NULL;'}
  INSERT INTO majordhome.fum_configurations (org_id, code, titre, page_catalogue, index_image, statut, gabarit_id, gamme_principale, principe, remarques, source_version,
    projets, appareils, combustibles, zones, prise_air, appareil_etanche_requis, conduit_existant, condition_bloquante)
  VALUES (v_org, ${q(code(c))}, ${q(c.titre)}, ${c.page_catalogue}, ${c.index_image}, ${q(c.statut)}, v_g, ${q(c.gamme_principale)}, ${q(c.principe)}, ${q(c.remarques)}, ${q(VERSION)},
    ${arr(cr.projet)}, ${arr(cr.appareils)}, ${arr(cr.combustibles)}, ${arr(cr.zones)}, ${arr(cr.prise_air)}, ${cr.appareil_etanche_requis ? 'true' : 'false'}, ${q(cr.conduit_existant)}, ${q(cr.condition_bloquante)})
  ON CONFLICT (org_id, code) DO UPDATE SET titre = EXCLUDED.titre, statut = EXCLUDED.statut, gabarit_id = EXCLUDED.gabarit_id, gamme_principale = EXCLUDED.gamme_principale,
    principe = EXCLUDED.principe, remarques = EXCLUDED.remarques, projets = EXCLUDED.projets, appareils = EXCLUDED.appareils, combustibles = EXCLUDED.combustibles,
    zones = EXCLUDED.zones, prise_air = EXCLUDED.prise_air, appareil_etanche_requis = EXCLUDED.appareil_etanche_requis, conduit_existant = EXCLUDED.conduit_existant,
    condition_bloquante = EXCLUDED.condition_bloquante, updated_at = now()
  RETURNING id INTO v_c;
  DELETE FROM majordhome.fum_config_composants WHERE configuration_id = v_c;
  DELETE FROM majordhome.fum_config_regles WHERE configuration_id = v_c;`);
  const composants = COMPOSANTS_PAR_CODE[code(c)] || c.nomenclature.map((n) => ({
    ordre: n.ordre, composant_code: slug(n.composant), libelle: n.composant, chapitre: n.chapitre || null,
    gammes: Array.isArray(n.gamme) ? n.gamme : (n.gamme ? [n.gamme] : []), troncon: null, repere: null, statut: 'catalogue',
    groupe_alternative: n.choix ? 'bas_de_conduit' : null, option: n.choix || null, regle_quantite: null, note: n.note || null,
  }));
  for (const k of composants) {
    sql.push(`  INSERT INTO majordhome.fum_config_composants (org_id, configuration_id, ordre, composant_code, libelle, chapitre, gammes, troncon, repere, statut, groupe_alternative, option, regle_quantite, note)
  VALUES (v_org, v_c, ${k.ordre}, ${q(k.composant_code)}, ${q(k.libelle)}, ${q(k.chapitre)}, ${arr(k.gammes)}, ${q(k.troncon)}, ${k.repere ?? 'NULL'}, ${q(k.statut)}, ${q(k.groupe_alternative)}, ${q(k.option)}, ${q(k.regle_quantite)}, ${q(k.note)});`);
  }
  for (const rc of c.regles_associees || []) {
    sql.push(`  SELECT id INTO v_r FROM majordhome.fum_regles WHERE org_id = v_org AND code = ${q(rc)};
  INSERT INTO majordhome.fum_config_regles (org_id, configuration_id, regle_id) VALUES (v_org, v_c, v_r) ON CONFLICT DO NOTHING;`);
  }
  for (const [marque, modeles] of Object.entries(c.modeles_preconises || {})) {
    for (const m of modeles) sql.push(`  INSERT INTO majordhome.fum_appareils_valides (org_id, gamme, marque, modele, configuration_id, source) VALUES (v_org, ${q(c.gamme_principale)}, ${q(marque)}, ${q(m)}, v_c, 'catalogue p.48') ON CONFLICT (org_id, gamme, marque, modele) DO UPDATE SET configuration_id = EXCLUDED.configuration_id;`);
  }
}

// Guide de choix
for (const [ligne, cols] of Object.entries(biblio.guide_de_choix_gammes.lignes)) {
  for (const [colonne, gammes] of Object.entries(cols)) {
    sql.push(`  INSERT INTO majordhome.fum_guide_choix (org_id, ligne, colonne, gammes, page) VALUES (v_org, ${q(ligne)}, ${q(colonne)}, ${arr(gammes)}, ${biblio.guide_de_choix_gammes.page}) ON CONFLICT (org_id, ligne, colonne) DO UPDATE SET gammes = EXCLUDED.gammes;`);
  }
}

// Mapping CFG-24 (fournisseur MODINOX)
sql.push(`  DELETE FROM majordhome.fum_composant_mapping WHERE org_id = v_org AND supplier_id = v_sup AND composant_code IN (${[...new Set(map24.map((m) => q(m.composant_code)))].join(',')});`);
for (const m of map24) {
  sql.push(`  INSERT INTO majordhome.fum_composant_mapping (org_id, supplier_id, composant_code, gamme_catalogue, finition, gamme_tarif, type_piece, quantite_par_unite, motif_code, statut)
  VALUES (v_org, v_sup, ${q(m.composant_code)}, ${q(m.gamme_catalogue)}, ${q(m.finition)}, ${q(m.gamme_tarif)}, ${q(m.type_piece)}, ${m.quantite_par_unite ?? 1}, ${q(m.motif_code)}, ${q(m.statut || 'catalogue')});`);
}
sql.push('END $$;');
mkdirSync(path.join(racine, 'scripts', 'fumisterie', 'out'), { recursive: true });
writeFileSync(path.join(racine, 'scripts', 'fumisterie', 'out', 'seed_configurations.sql'), sql.join('\n'), 'utf8');
console.log(`seed : ${biblio.configurations.length} configurations, ${biblio.regles_techniques.length} règles, ${map24.length} lignes de mapping`);
