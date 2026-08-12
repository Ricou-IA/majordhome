// scripts/dpe-report-model.test.mjs
// Tests du modèle de la synthèse énergétique client (src/lib/dpeReportModel.js).
// Run : node --test scripts/dpe-report-model.test.mjs
// Les libellés de générateur sont ceux réellement renvoyés par l'API ADEME
// (relevés sur le Tarn le 2026-08-12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapDpeRecord } from '../src/lib/dpeApi.js';
import {
  extractGeneratorPeriod,
  isAgingGenerator,
  buildRecommendations,
  buildOutOfScopeNote,
  plainQuality,
  formatDateFrLong,
  buildDpeReportModel,
  AGING_GENERATOR_YEARS,
} from '../src/lib/dpeReportModel.js';

const REF_YEAR = 2026;
const keys = (recs) => recs.map((r) => r.key);

/** Bilan de déperditions réel du client RONCA (DPE 2281E1013231P). */
const RONCA = {
  numero_dpe: '2281E1013231P',
  adresse_ban: '1432 Chemin de la Voie 81380 Lescure-d’Albigeois',
  etiquette_dpe: 'G',
  type_batiment: 'maison',
  surface_habitable_logement: 76,
  type_energie_principale_chauffage: 'Fioul domestique',
  type_ventilation: 'Ventilation par ouverture des fenêtres',
  qualite_isolation_murs: 'insuffisante',
  qualite_isolation_menuiseries: 'insuffisante',
  qualite_isolation_plancher_haut_comble_perdu: 'insuffisante',
  ubat_w_par_m2_k: 1.96,
  cout_total_5_usages: 3450.8,
  cout_chauffage: 3162.9,
  cout_ecs: 162.6,
  deperditions_enveloppe: 659.4,
  deperditions_murs: 406.2,
  deperditions_renouvellement_air: 93.5,
  deperditions_ponts_thermiques: 51.3,
  deperditions_baies_vitrees: 49.2,
  deperditions_portes: 22.6,
  deperditions_planchers_bas: 18.8,
  deperditions_planchers_hauts: 17.8,
  date_etablissement_dpe: '2022-05-11',
};

// --- Lecture de la période d'installation ----------------------------------

test('extractGeneratorPeriod — reconnaît les formes ADEME', () => {
  assert.deepEqual(extractGeneratorPeriod('Chaudière gaz standard 2001-2015'), { from: 2001, to: 2015 });
  assert.deepEqual(extractGeneratorPeriod('Chaudière gaz classique avant 1981'), { from: null, to: 1981 });
  assert.deepEqual(extractGeneratorPeriod('PAC air/air installée à partir de 2015'), { from: 2015, to: null });
  assert.deepEqual(extractGeneratorPeriod('PAC air/air installée entre 2008 et 2014'), { from: 2008, to: 2014 });
  assert.deepEqual(extractGeneratorPeriod('PAC air/eau installée après 2017'), { from: 2017, to: null });
  assert.equal(extractGeneratorPeriod('Convecteur électrique NFC, NF** et NF***'), null);
  assert.equal(extractGeneratorPeriod(null), null);
});

test('isAgingGenerator — raisonne sur la borne haute', () => {
  assert.equal(isAgingGenerator('Chaudière fioul standard 1991-2015', REF_YEAR), false); // 2026-2015 = 11 ans
  assert.equal(isAgingGenerator('Chaudière gaz standard 1991-2000', REF_YEAR), true);
  assert.equal(isAgingGenerator('Chaudière gaz classique avant 1981', REF_YEAR), true);
});

test('isAgingGenerator — ne conclut pas sans borne haute ni sans période', () => {
  // « après 2015 » : on ignore l'âge exact, on ne dit PAS au client que son
  // matériel récent est à changer.
  assert.equal(isAgingGenerator('PAC air/air installée à partir de 2015', REF_YEAR), false);
  assert.equal(isAgingGenerator('Autres émetteurs à effet joule', REF_YEAR), null);
  assert.equal(isAgingGenerator(null, REF_YEAR), null);
});

// --- Recommandations -------------------------------------------------------

test('recommandations — fioul : la PAC passe en tête', () => {
  const recs = buildRecommendations(mapDpeRecord(RONCA), { refYear: REF_YEAR });
  assert.equal(recs[0].key, 'pac_fioul');
  assert.match(recs[0].pourquoi, /énergie de chauffage la plus chère/);
});

test('recommandations — RONCA : le jeu complet attendu', () => {
  const recs = buildRecommendations(mapDpeRecord(RONCA), { refYear: REF_YEAR });
  // fioul → PAC ; pas de froid + étiquette G → clim ; G → aides.
  // Renouvellement d'air = 93,5/659,4 = 14,2 % → SOUS le seuil de 15 %, pas de VMC.
  assert.deepEqual(keys(recs), ['pac_fioul', 'clim', 'aides']);
});

test('recommandations — bois : le ramonage est proposé quelle que soit l’étiquette', () => {
  const recs = buildRecommendations(
    mapDpeRecord({
      etiquette_dpe: 'C',
      type_energie_principale_chauffage: 'Bois – Granulés (pellets) ou briquettes',
      type_generateur_chauffage_principal: 'Poêle à granulés flamme verte installé à partir de 2020',
      periode_installation_generateur_froid: 'après 2015',
    }),
    { refYear: REF_YEAR }
  );
  assert.deepEqual(keys(recs), ['ramonage']);
});

test('recommandations — gaz récent : aucun remplacement proposé', () => {
  const recs = buildRecommendations(
    mapDpeRecord({
      etiquette_dpe: 'C',
      type_energie_principale_chauffage: 'Gaz naturel',
      type_generateur_chauffage_principal: 'Chaudière gaz à condensation après 2015',
      periode_installation_generateur_froid: 'après 2015',
    }),
    { refYear: REF_YEAR }
  );
  assert.deepEqual(keys(recs), []);
});

test('recommandations — gaz ancien : remplacement, avec le libellé cité', () => {
  const recs = buildRecommendations(
    mapDpeRecord({
      etiquette_dpe: 'D',
      type_energie_principale_chauffage: 'Gaz naturel',
      type_generateur_chauffage_principal: 'Chaudière gaz classique avant 1981',
      periode_installation_generateur_froid: 'après 2015',
    }),
    { refYear: REF_YEAR }
  );
  assert.equal(recs[0].key, 'pac_gaz');
  assert.match(recs[0].pourquoi, /avant 1981/);
  assert.match(recs[0].pourquoi, new RegExp(String(AGING_GENERATOR_YEARS)));
});

test('recommandations — VMC dès que le renouvellement d’air dépasse 15 %', () => {
  const recs = buildRecommendations(
    mapDpeRecord({
      etiquette_dpe: 'D',
      type_energie_principale_chauffage: 'Électricité',
      periode_installation_generateur_froid: 'après 2015',
      deperditions_enveloppe: 1000,
      deperditions_murs: 700,
      deperditions_renouvellement_air: 300,
    }),
    { refYear: REF_YEAR }
  );
  assert.deepEqual(keys(recs), ['vmc']);
  assert.match(recs[0].pourquoi, /30 %/);
});

test('recommandations — jamais de proposition isolation ou menuiseries', () => {
  // Mayer ne vend ni l'un ni l'autre : aucune reco ne doit les mentionner.
  const recs = buildRecommendations(mapDpeRecord(RONCA), { refYear: REF_YEAR });
  for (const r of recs) {
    assert.doesNotMatch(r.prestation, /isolation|menuiserie|fenêtre/i, `« ${r.prestation} »`);
  }
});

test('recommandations — tolère un record vide', () => {
  assert.deepEqual(buildRecommendations(null), []);
  assert.deepEqual(buildRecommendations(mapDpeRecord({})), []);
});

// --- Hors périmètre --------------------------------------------------------

test('buildOutOfScopeNote — remonte les murs, tait les postes marginaux', () => {
  const note = buildOutOfScopeNote(mapDpeRecord(RONCA));
  // Forme AVEC article : la phrase du PDF est rédigée, « ce sont murs » fait amateur
  assert.deepEqual(note.libelles, ['les murs']); // baies 7 %, portes 3 % → sous le seuil
  assert.equal(note.sharePct, 62);
});

test('buildOutOfScopeNote — null quand rien de significatif', () => {
  const note = buildOutOfScopeNote(
    mapDpeRecord({ deperditions_enveloppe: 100, deperditions_renouvellement_air: 100 })
  );
  assert.equal(note, null);
});

// --- Traduction en langage client ------------------------------------------

test('plainQuality — traduit les libellés ADEME, ignore les inconnus', () => {
  assert.equal(plainQuality('insuffisante'), 'laisse passer beaucoup de chaleur');
  assert.equal(plainQuality('TRÈS BONNE'), 'est performante');
  assert.equal(plainQuality('bizarre'), null);
  assert.equal(plainQuality(null), null);
});

// --- Date en toutes lettres ------------------------------------------------

test('formatDateFrLong — ISO vers date française lisible', () => {
  assert.equal(formatDateFrLong('2022-05-11'), '11 mai 2022');
  assert.equal(formatDateFrLong('2026-01-09'), '9 janvier 2026'); // pas « 09 »
  assert.equal(formatDateFrLong('2024-08-31'), '31 août 2024');
});

test('formatDateFrLong — null plutôt qu’une date bancale', () => {
  assert.equal(formatDateFrLong(null), null);
  assert.equal(formatDateFrLong(''), null);
  assert.equal(formatDateFrLong('pas une date'), null);
  assert.equal(formatDateFrLong('2022-13-11'), null); // mois inexistant
});

// --- Modèle complet --------------------------------------------------------

test('buildDpeReportModel — assemble un document exploitable', () => {
  const m = buildDpeReportModel(mapDpeRecord(RONCA), { display_name: 'RONCA VINCENT' }, {
    dateLabel: '12 août 2026',
    refYear: REF_YEAR,
  });

  assert.equal(m.client.nom, 'RONCA VINCENT');
  assert.equal(m.source.numeroDpe, '2281E1013231P');
  assert.match(m.source.mention, /n’est pas un diagnostic réglementaire/);
  assert.equal(m.logement.etiquette, 'G');
  assert.equal(m.logement.ubat, 1.96);
  assert.equal(m.chaleur.dominant.label, 'Murs');
  assert.equal(m.chaleur.phrase, '62 % de la chaleur que vous payez s’échappe par les murs.');
  assert.equal(m.source.dateDpeLabel, '11 mai 2022');
  assert.equal(m.argent.total, 3450.8);
  assert.equal(m.argent.postes[0].label, 'Chauffage');
  assert.equal(m.installation.isolation.length, 3);
  assert.equal(m.installation.isolation[0].plain, 'laisse passer beaucoup de chaleur');
  assert.equal(m.horsPerimetre.sharePct, 62);
});

test('buildDpeReportModel — ne plante pas sur un DPE quasi vide', () => {
  const m = buildDpeReportModel(mapDpeRecord({}), null, { dateLabel: '12 août 2026' });
  assert.equal(m.client.nom, '');
  assert.equal(m.chaleur.dominant, null);
  assert.equal(m.chaleur.phrase, null);
  assert.deepEqual(m.recommandations, []);
  assert.equal(m.horsPerimetre, null);
});
