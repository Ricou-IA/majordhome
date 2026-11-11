// node --test scripts/dpe-lien-edge.test.mjs — règles pures de l'edge function dpe-lien.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numeroValide, adresseDeRecherche, codeDepuisCorpus, resumeDossier, rapportCompletPossible, projeterCandidat, CODES } from '../supabase/functions/dpe-lien/regles.js';

test('numeroValide : 13 alphanumériques oui, 12 non, espace non, non-chaîne non', () => {
  assert.equal(numeroValide('2662E2065219C'), true);
  assert.equal(numeroValide('2662E2065219'), false);
  assert.equal(numeroValide('2662E 065219C'), false);
  assert.equal(numeroValide('2662E2065219C '), false);
  assert.equal(numeroValide(null), false);
  assert.equal(numeroValide(2662), false);
});

test('adresseDeRecherche : rue + CP + ville, espaces normalisés', () => {
  assert.equal(adresseDeRecherche({ address: ' 12  rue X ', postal_code: '81600', city: 'Gaillac' }), '12 rue X 81600 Gaillac');
});

test('adresseDeRecherche : rue + ville sans CP reste cherchable', () => {
  assert.equal(adresseDeRecherche({ address: '12 rue X', postal_code: null, city: 'Gaillac' }), '12 rue X Gaillac');
});

test('adresseDeRecherche : ville seule, rue seule ou client absent ⇒ null', () => {
  assert.equal(adresseDeRecherche({ address: '', postal_code: '81600', city: 'Gaillac' }), null);
  assert.equal(adresseDeRecherche({ address: '12 rue X', postal_code: '', city: '  ' }), null);
  assert.equal(adresseDeRecherche(null), null);
});

test('codeDepuisCorpus : 503 et 401 ⇒ indisponible, 404 ⇒ absent, 400 ⇒ mal formé, 200 ⇒ null', () => {
  assert.equal(codeDepuisCorpus(503, 'base dossier en cours de construction'), 'corpus_indisponible');
  assert.equal(codeDepuisCorpus(401, 'secret absent ou invalide'), 'corpus_indisponible');
  assert.equal(codeDepuisCorpus(404, 'dossier absent de la vue'), 'numero_absent');
  assert.equal(codeDepuisCorpus(400, 'numero mal forme'), 'numero_mal_forme');
  assert.equal(codeDepuisCorpus(200, null), null);
  assert.equal(codeDepuisCorpus(200, 'erreur dans un 200'), 'corpus_indisponible');
});

test('codeDepuisCorpus ne rend que des codes connus', () => {
  for (const statut of [200, 400, 401, 404, 500, 503]) {
    const code = codeDepuisCorpus(statut, 'x');
    assert.ok(code === null || CODES.includes(code));
  }
});

test('resumeDossier : champs lus, champs absents ⇒ null et jamais undefined', () => {
  assert.deepEqual(
    resumeDossier({ classe_bilan_dpe: 'D', date_etablissement_dpe: '2023-04-02', surface_habitable_logement: 96, type_bien: 'maison' }),
    { etiquette: 'D', date: '2023-04-02', surface: 96, type: 'maison' },
  );
  assert.deepEqual(resumeDossier({}), { etiquette: null, date: null, surface: null, type: null });
  assert.deepEqual(resumeDossier(null), { etiquette: null, date: null, surface: null, type: null });
});

test("rapportCompletPossible : faux sans composant, faux pour un appartement dérivé de l'immeuble, vrai sinon", () => {
  assert.equal(rapportCompletPossible({ dossier: { methode_application_dpe: 'dpe maison individuelle' }, composants: [{}] }), true);
  assert.equal(rapportCompletPossible({ dossier: { methode_application_dpe: 'dpe maison individuelle' }, composants: [] }), false);
  assert.equal(rapportCompletPossible({ dossier: { methode_application_dpe: 'DPE appartement généré à partir des données DPE immeuble' }, composants: [{}] }), false);
  assert.equal(rapportCompletPossible({ dossier: {}, composants: [{}] }), true);
  assert.equal(rapportCompletPossible(null), false);
});

test("projeterCandidat : ne laisse passer que les champs lus par l'écran", () => {
  assert.deepEqual(
    projeterCandidat({ identifiant_dpe: '2662E2065219C', date_etablissement_dpe: '2022-03-01', etiquette_dpe: 'D',
      surface_habitable_logement: 96, type_batiment: 'dpe maison individuelle', fiabilite_geocodage: 'fiable',
      batiment_groupe_id: 'bdnb-bg-X', champ_futur: 'secret' }),
    { identifiant_dpe: '2662E2065219C', date_etablissement_dpe: '2022-03-01', etiquette_dpe: 'D',
      surface_habitable_logement: 96, type_batiment: 'dpe maison individuelle', fiabilite_geocodage: 'fiable' },
  );
  assert.deepEqual(projeterCandidat('pas un objet'), null);
});

// --- Refonte 2026-11-12 : décision de rattachement automatique ------------------------------------------------
import { decisionRattachement, SCORE_GEOCODAGE_MIN, TYPES_GEOCODAGE_ACCEPTES, FIABILITES_BDNB_ACCEPTEES, RATTACHEMENT_AUTO_ACTIF } from '../supabase/functions/dpe-lien/regles.js';

const GEO = { score: Math.max(SCORE_GEOCODAGE_MIN, 0.95), type: TYPES_GEOCODAGE_ACCEPTES[0], cle_ban: '31570_0080_00423' };
const CAND = (o = {}) => ({ identifiant_dpe: '2631E0482288Y', date_etablissement_dpe: '2026-02-18', etiquette_dpe: 'A',
  surface_habitable_logement: 114, type_batiment: 'dpe maison individuelle', fiabilite_geocodage: FIABILITES_BDNB_ACCEPTEES[0], ...o });
const MAISON = { dossier: { methode_application_dpe: 'dpe maison individuelle' }, composants: [{}] };
const decide = (o) => decisionRattachement({ geocodage: GEO, candidats: [CAND()], dossierUnique: MAISON, ecartes: [], autoActif: true, ...o });

test('decisionRattachement : automatique coupé ⇒ le DPE unique et sûr est PROPOSÉ, pas rattaché', () => {
  const d = decide({ autoActif: false });
  assert.equal(d.etat, 'candidats');
  assert.equal(d.numero, undefined);
  assert.equal(d.candidats.length, 1);
});

test('decisionRattachement : sans option, la constante RATTACHEMENT_AUTO_ACTIF décide', () => {
  const d = decisionRattachement({ geocodage: GEO, candidats: [CAND()], dossierUnique: MAISON, ecartes: [] });
  assert.equal(d.etat, RATTACHEMENT_AUTO_ACTIF ? 'rattache' : 'candidats');
});

test('decisionRattachement : un seul DPE, tout est sûr ⇒ rattaché automatiquement', () => {
  assert.deepEqual(decide({}), { etat: 'rattache', numero: '2631E0482288Y', candidats: [projeterCandidat(CAND())] });
});

test('decisionRattachement : adresse non géocodée ⇒ adresse_non_trouvee ; aucun DPE ⇒ aucun_dpe', () => {
  assert.equal(decide({ geocodage: null }).etat, 'adresse_non_trouvee');
  assert.equal(decide({ candidats: [] }).etat, 'aucun_dpe');
});

test('decisionRattachement : plusieurs DPE ⇒ candidats, jamais de choix machine', () => {
  const d = decide({ candidats: [CAND(), CAND({ identifiant_dpe: '2481E2082752C' })] });
  assert.equal(d.etat, 'candidats');
  assert.equal(d.numero, undefined);
  assert.equal(d.candidats.length, 2);
});

test('decisionRattachement : chaque critère douteux suffit à refuser l\'automatique', () => {
  assert.equal(decide({ geocodage: { ...GEO, score: SCORE_GEOCODAGE_MIN - 0.01 } }).etat, 'candidats');
  assert.equal(decide({ geocodage: { ...GEO, type: 'street' } }).etat, 'candidats');
  assert.equal(decide({ candidats: [CAND({ fiabilite_geocodage: 'peu fiable' })] }).etat, 'candidats');
  assert.equal(decide({ candidats: [CAND({ fiabilite_geocodage: null })] }).etat, 'candidats');
  assert.equal(decide({ dossierUnique: null }).etat, 'candidats');
  assert.equal(decide({ dossierUnique: { dossier: { methode_application_dpe: 'dpe appartement généré à partir des données DPE immeuble' } } }).etat, 'candidats');
});

test('decisionRattachement : un numéro écarté (« Ce n\'est pas le bon ») n\'est plus proposé', () => {
  assert.equal(decide({ ecartes: ['2631E0482288Y'] }).etat, 'aucun_dpe');
  const d = decide({ candidats: [CAND(), CAND({ identifiant_dpe: '2481E2082752C' })], ecartes: ['2631E0482288Y'] });
  assert.equal(d.etat, 'rattache');
  assert.equal(d.numero, '2481E2082752C');
});

test('decisionRattachement : les candidats ne portent que les champs lus par l\'écran', () => {
  const d = decide({ candidats: [CAND({ batiment_groupe_id: 'x' }), CAND({ identifiant_dpe: '2481E2082752C', batiment_groupe_id: 'y' })] });
  for (const c of d.candidats) assert.equal('batiment_groupe_id' in c, false);
});

// --- Corrections de la revue finale (2026-11-12) -----------------------------------------------------------
import { controleNumero } from '../supabase/functions/dpe-lien/regles.js';

test('controleNumero : le numéro de la fiche doit être celui de la ligne (casse et espaces neutralisés)', () => {
  const ligne = { dpe_number: '2631E0482288Y', rapport_complet: true };
  assert.equal(controleNumero({ numeroFiche: ' 2631e0482288y ', ligne }), null);
  assert.equal(controleNumero({ numeroFiche: '2481E2082752C', ligne }), 'numero_desynchronise');
  assert.equal(controleNumero({ numeroFiche: '', ligne }), 'client_sans_numero');
  assert.equal(controleNumero({ numeroFiche: '2631E0482288Y', ligne: null }), 'numero_desynchronise');
});

test('controleNumero avec exigence de rapport : rapport_complet doit être VRAI, NULL compris refusé', () => {
  const avec = (rc) => controleNumero({ numeroFiche: '2631E0482288Y', ligne: { dpe_number: '2631E0482288Y', rapport_complet: rc }, rapportRequis: true });
  assert.equal(avec(true), null);
  assert.equal(avec(false), 'sans_rapport_complet');
  assert.equal(avec(null), 'sans_rapport_complet');
  assert.equal(avec(undefined), 'sans_rapport_complet');
});
