// scripts/cerfa16702.test.mjs
// Tests du field map CERFA 16702*03 (src/apps/solaire/lib/cerfa16702.js — pur, sans pdf-lib).
// Noms de champs issus de l'énumération AcroForm réelle du PDF officiel (386 champs, reco 2026-07-11).
// Run : node --test scripts/cerfa16702.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toJJMMAAAA,
  splitEmail,
  sanitizeWinAnsi,
  cleanPhone10,
  buildCerfaDescription,
  buildCerfaFields,
} from '../src/apps/solaire/lib/cerfa16702.js';

test('toJJMMAAAA — ISO → 8 chars sans séparateur (format natif des champs date du CERFA)', () => {
  assert.equal(toJJMMAAAA('1980-03-07'), '07031980');
  assert.equal(toJJMMAAAA('2026-07-11'), '11072026');
  assert.equal(toJJMMAAAA(''), '');
  assert.equal(toJJMMAAAA(null), '');
  assert.equal(toJJMMAAAA('pas-une-date'), '');
});

test('splitEmail — scindé sur le premier @ (le CERFA imprime le @ entre 2 champs)', () => {
  assert.deepEqual(splitEmail('eric@confer-sas.fr'), ['eric', 'confer-sas.fr']);
  assert.deepEqual(splitEmail('sans-arobase'), ['sans-arobase', '']);
  assert.deepEqual(splitEmail(''), ['', '']);
});

test('sanitizeWinAnsi — espaces/tirets/apostrophes Unicode → équivalents CP1252-sûrs', () => {
  assert.equal(sanitizeWinAnsi('1 000 m²'), '1 000 m²');
  assert.equal(sanitizeWinAnsi('− 15 – 20'), '- 15 - 20');
  assert.equal(sanitizeWinAnsi('l’angle'), "l'angle");
  assert.equal(sanitizeWinAnsi('été à Gaillac ç'), 'été à Gaillac ç'); // accents FR conservés
  assert.equal(sanitizeWinAnsi(null), '');
});

test('cleanPhone10 — formats FR courants → 10 chiffres (maxLen du champ)', () => {
  assert.equal(cleanPhone10('06 12 34 56 78'), '0612345678');
  assert.equal(cleanPhone10('+33 6 12 34 56 78'), '0612345678');
  assert.equal(cleanPhone10('05.63.57.00.00'), '0563570000');
  assert.equal(cleanPhone10(''), '');
});

test('buildCerfaDescription — kWc, nb modules, surimposition, matériel si connu', () => {
  const desc = buildCerfaDescription({
    kwc: 6, panels: 12, marque: 'DualSun', modele: 'Flash 500', aspect: 'full_black',
  });
  assert.match(desc, /12 modules/);
  assert.match(desc, /6 kWc/);
  assert.match(desc, /surimposition/);
  assert.match(desc, /DualSun Flash 500/);
  assert.match(desc, /noir uniforme/i);
  assert.match(desc, /Aucune création de surface de plancher/);
  // sans matériel ni aspect standard → texte générique, pas de « undefined »
  const bare = buildCerfaDescription({ kwc: 3, panels: 6, marque: '', modele: '', aspect: 'standard' });
  assert.match(bare, /6 modules photovolta/);
  assert.doesNotMatch(bare, /undefined|null/);
  assert.doesNotMatch(bare, /noir uniforme/i);
});

const DECLARANT = {
  civilite: 'M.',
  nom: 'Pudebat',
  prenom: 'Eric',
  date_naissance: '1980-03-07',
  naissance_commune: 'Albi',
  naissance_departement: '81',
  naissance_pays: 'France',
  telephone: '06 12 34 56 78',
  email: 'eric@confer-sas.fr',
  notif_electronique: true,
  adresse: { numero: '12', voie: 'rue de la République', lieudit: '', code_postal: '81600', localite: 'Gaillac' },
};
const TERRAIN = { numero: '12', voie: 'rue de la République', lieudit: '', code_postal: '81600', localite: 'Gaillac' };
const PARCELLES = [
  { prefixe: '000', section: 'BS', numero: '0632', superficie_m2: 4308 },
  { prefixe: '000', section: 'BS', numero: '0633', superficie_m2: 120 },
];

test('buildCerfaFields — mapping déclarant + terrain + parcelles + engagement', () => {
  const { text, checks, overflowParcelles } = buildCerfaFields({
    declarant: DECLARANT,
    terrain: TERRAIN,
    parcelles: PARCELLES,
    abf: { secteur_protege: true, protections: [{ suptype: 'ac1' }, { suptype: 'ac4' }] },
    description: 'Installation de 12 modules…',
    todayIso: '2026-07-11',
  });
  // 1. identité
  assert.equal(text.D1N_nom, 'Pudebat');
  assert.equal(text.D1P_prenom, 'Eric');
  assert.equal(text.D1A_naissance, '07031980');
  assert.equal(text.D1C_commune, 'Albi');
  assert.equal(text.D1D_dept, '81');
  assert.equal(text.D1E_pays, 'France');
  // 2. coordonnées
  assert.equal(text.D3N_numero, '12');
  assert.equal(text.D3V_voie, 'rue de la République');
  assert.equal(text.D3L_localite, 'Gaillac');
  assert.equal(text.D3C_code, '81600');
  assert.equal(text.D3T_telephone, '0612345678');
  assert.equal(text.D5GE1_email, 'eric');
  assert.equal(text.D5GE2_email, 'confer-sas.fr');
  // 3.1 terrain + cadastre
  assert.equal(text.T2Q_numero, '12');
  assert.equal(text.T2V_voie, 'rue de la République');
  assert.equal(text.T2L_localite, 'Gaillac');
  assert.equal(text.T2C_code, '81600');
  assert.equal(text.T2F_prefixe, '000');
  assert.equal(text.T2S_section, 'BS');
  assert.equal(text.T2N_numero, '0632');
  assert.equal(text.T2T_superficie, '4308');
  assert.equal(text.T2FP2_prefixe, '000');
  assert.equal(text.T2SP2_section, 'BS');
  assert.equal(text.T2NP2_numero, '0633');
  assert.equal(text.T2TP2_superficie, '120');
  assert.equal(text.D5T_total, '4428'); // superficie totale du terrain = somme
  assert.equal(overflowParcelles, false);
  // 4. nature + description + emprise
  assert.ok(checks.includes('C2ZB1_existante'));
  assert.equal(text.C2ZD1_description, 'Installation de 12 modules…');
  assert.equal(text.W3ES2_creee, '0');
  assert.equal(text.W3ES3_supprimee, '0');
  // 5. périmètres protégés depuis le bloc ABF (GPU)
  assert.ok(checks.includes('X2H_historique')); // ac1
  assert.ok(checks.includes('X2R_remarquable')); // ac4
  assert.ok(!checks.includes('X2C_classe')); // pas d'ac2
  // notification électronique acceptée
  assert.ok(checks.includes('D5A_acceptation'));
  // 7. engagement
  assert.equal(text.E1L_lieu, 'Gaillac');
  assert.equal(text.E1D_date, '11072026');
  // la rubrique PV AU SOL ne doit jamais être remplie pour du PV toiture
  assert.equal(text.C2ZP1_crete, undefined);
});

test('buildCerfaFields — 4 parcelles → 3 remplies + overflow, total = somme des 4', () => {
  const four = [
    ...PARCELLES,
    { prefixe: '000', section: 'BT', numero: '0001', superficie_m2: 50 },
    { prefixe: '000', section: 'BT', numero: '0002', superficie_m2: 30 },
  ];
  const { text, overflowParcelles } = buildCerfaFields({
    declarant: DECLARANT, terrain: TERRAIN, parcelles: four, abf: null,
    description: 'x', todayIso: '2026-07-11',
  });
  assert.equal(text.T2NP3_numero, '0001');
  assert.equal(text.T2NP4_numero, undefined); // pas de 4e slot
  assert.equal(overflowParcelles, true);
  assert.equal(text.D5T_total, '4508');
});

test('buildCerfaFields — sans ABF, sans email, sans opt-in → pas de cases légales ni D5A', () => {
  const { text, checks } = buildCerfaFields({
    declarant: { ...DECLARANT, email: '', notif_electronique: false },
    terrain: TERRAIN, parcelles: [PARCELLES[0]], abf: null,
    description: 'x', todayIso: '2026-07-11',
  });
  assert.ok(!checks.includes('D5A_acceptation'));
  assert.ok(!checks.includes('X2H_historique'));
  assert.equal(text.D5GE1_email, undefined); // champ vide non envoyé (pas de setText(''))
  // superficie manquante → champ absent, pas « null »
  const { text: t2 } = buildCerfaFields({
    declarant: DECLARANT, terrain: TERRAIN,
    parcelles: [{ prefixe: '000', section: 'BS', numero: '0632', superficie_m2: null }],
    abf: null, description: 'x', todayIso: '2026-07-11',
  });
  assert.equal(t2.T2T_superficie, undefined);
  assert.equal(t2.D5T_total, undefined); // total inconnu si une superficie manque
});

test('buildCerfaFields — signedAtIso + signatureLieu pilotent E1D_date / E1L_lieu (cadre 7)', () => {
  const { text } = buildCerfaFields({
    declarant: DECLARANT, terrain: TERRAIN, parcelles: [PARCELLES[0]], abf: null,
    description: 'x', todayIso: '2026-07-11',
    signedAtIso: '2026-07-09T10:00:00.000Z', signatureLieu: 'Rebigue',
  });
  assert.equal(text.E1D_date, '09072026'); // date de signature, pas aujourd'hui
  assert.equal(text.E1L_lieu, 'Rebigue');  // lieu de signature
});

test('buildCerfaFields — sans signature → fallback aujourd\'hui + localité déclarant', () => {
  const { text } = buildCerfaFields({
    declarant: DECLARANT, terrain: TERRAIN, parcelles: [PARCELLES[0]], abf: null,
    description: 'x', todayIso: '2026-07-11',
  });
  assert.equal(text.E1D_date, '11072026');
  assert.equal(text.E1L_lieu, 'Gaillac'); // adresse déclarant
});
