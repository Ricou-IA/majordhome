// node --test scripts/dpe-lien.test.mjs — module pur du lien MonsieurDPE (fiche client).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formaterCandidats, messageErreurDpeLien, etatDuLien, lienObservatoire } from '../src/lib/dpeLien.js';
import { CODES } from '../supabase/functions/dpe-lien/regles.js';

const dpe = (o) => ({
  batiment_groupe_id: 'bdnb-bg-X', identifiant_dpe: '2662E2065219C', date_etablissement_dpe: '2022-03-01',
  etiquette_dpe: 'D', surface_habitable_logement: 96, type_batiment: 'dpe maison individuelle', fiabilite_geocodage: 'fiable', ...o,
});

test('formaterCandidats : dpe vide et adresse nulle ⇒ zéro candidat, bâtiment non trouvé', () => {
  assert.deepEqual(formaterCandidats({ adresse: null, batiment_trouve: false, candidats: [] }),
    { adresseTrouvee: null, batimentTrouve: false, candidats: [], indistinguables: false });
  assert.deepEqual(formaterCandidats(null), { adresseTrouvee: null, batimentTrouve: false, candidats: [], indistinguables: false });
});

test('formaterCandidats : tri du plus récent au plus ancien, aucun marqué choisi', () => {
  const r = formaterCandidats({
    adresse: { cle_ban: '81099_0100_00012', libelle: '12 Rue X 81600 Gaillac' },
    batiment_trouve: true,
    candidats: [
      dpe({ identifiant_dpe: '2181E0000000A', date_etablissement_dpe: '2021-09-10' }),
      dpe({ identifiant_dpe: '2581E0000000C', date_etablissement_dpe: '2025-01-20' }),
      dpe({ identifiant_dpe: '2381E0000000B', date_etablissement_dpe: '2023-05-02' }),
    ],
  });
  assert.equal(r.adresseTrouvee, '12 Rue X 81600 Gaillac');
  assert.equal(r.batimentTrouve, true);
  assert.deepEqual(r.candidats.map((c) => c.numero), ['2581E0000000C', '2381E0000000B', '2181E0000000A']);
  for (const c of r.candidats) assert.equal('choisi' in c, false);
});

test('formaterCandidats : un candidat porte numéro, date, étiquette, surface, type lisible', () => {
  const [c] = formaterCandidats({ adresse: null, batiment_trouve: true, candidats: [dpe({})] }).candidats;
  assert.deepEqual(c, { numero: '2662E2065219C', date: '2022-03-01', etiquette: 'D', surface: 96, type: 'Maison individuelle', fiabilite: 'fiable' });
});

test('formaterCandidats : deux DPE que rien ne distingue hors numéro et date ⇒ indistinguables', () => {
  const pareils = formaterCandidats({ adresse: null, batiment_trouve: true, candidats: [
    dpe({ identifiant_dpe: '2281E0000000A', date_etablissement_dpe: '2022-01-01', type_batiment: 'dpe appartement individuel', surface_habitable_logement: 45 }),
    dpe({ identifiant_dpe: '2281E0000000B', date_etablissement_dpe: '2022-01-02', type_batiment: 'dpe appartement individuel', surface_habitable_logement: 45 }),
  ] });
  assert.equal(pareils.indistinguables, true);
  const distincts = formaterCandidats({ adresse: null, batiment_trouve: true, candidats: [
    dpe({ identifiant_dpe: '2281E0000000A', surface_habitable_logement: 45 }),
    dpe({ identifiant_dpe: '2281E0000000B', surface_habitable_logement: 72 }),
  ] });
  assert.equal(distincts.indistinguables, false);
});

test('formaterCandidats : lignes sans numéro valide ou champs inconnus ⇒ ignorés sans erreur', () => {
  const r = formaterCandidats({ adresse: {}, batiment_trouve: true, candidats: [
    { identifiant_dpe: null }, 'pas un objet', dpe({ champ_futur: 1, etiquette_dpe: null, surface_habitable_logement: null }),
  ] });
  assert.equal(r.candidats.length, 1);
  assert.equal(r.candidats[0].etiquette, null);
  assert.equal(r.candidats[0].surface, null);
  assert.equal(r.adresseTrouvee, null);
});

test('messageErreurDpeLien : chaque code de l\'edge function a un message distinct et non vide', () => {
  const messages = CODES.map((c) => messageErreurDpeLien(c));
  for (const m of messages) assert.ok(typeof m === 'string' && m.length > 10);
  assert.equal(new Set(messages).size, CODES.length);
});

test('messageErreurDpeLien : un code inconnu, une erreur ou rien ⇒ message générique', () => {
  const generique = messageErreurDpeLien('code_du_futur');
  assert.ok(generique.length > 10);
  assert.equal(messageErreurDpeLien(new Error('boom')), generique);
  assert.equal(messageErreurDpeLien(null), generique);
  assert.equal(messageErreurDpeLien({ message: 'numero_absent' }), messageErreurDpeLien('numero_absent'));
});

test('messageErreurDpeLien : numero_absent ne dit jamais « introuvable »', () => {
  assert.equal(/introuvable/i.test(messageErreurDpeLien('numero_absent')), false);
});

test('etatDuLien : sans numéro / mal formé / à vérifier / absent du corpus / prêt / émis', () => {
  assert.equal(etatDuLien({ dpeNumber: '', verification: undefined, acces: null }), 'sans_numero');
  assert.equal(etatDuLien({ dpeNumber: '  ', verification: undefined, acces: null }), 'sans_numero');
  assert.equal(etatDuLien({ dpeNumber: '1234', verification: undefined, acces: null }), 'mal_forme');
  assert.equal(etatDuLien({ dpeNumber: '2662E2065219C', verification: undefined, acces: null }), 'a_verifier');
  assert.equal(etatDuLien({ dpeNumber: '2662E2065219C', verification: { present: false }, acces: null }), 'absent_du_corpus');
  assert.equal(etatDuLien({ dpeNumber: '2662E2065219C', verification: { present: true }, acces: null }), 'pret');
  assert.equal(etatDuLien({ dpeNumber: '2662E2065219C', verification: { present: true, rapport_complet: true }, acces: null }), 'pret');
  // Présent dans le corpus mais sans rapport complet possible : aucun lien à proposer.
  assert.equal(etatDuLien({ dpeNumber: '2662E2065219C', verification: { present: true, rapport_complet: false }, acces: null }), 'sans_rapport_complet');
  // Un accès déjà émis prime : le lien existe, la vérification n'a plus rien à dire.
  assert.equal(etatDuLien({ dpeNumber: '2662E2065219C', verification: undefined, acces: { report_url: 'https://x' } }), 'emis');
});

test('lienObservatoire : lien profond ADEME pour un numéro valide, null sinon', () => {
  assert.equal(lienObservatoire('2662E2065219C'), 'https://observatoire-dpe-audit.ademe.fr/afficher-dpe/2662E2065219C');
  assert.equal(lienObservatoire('a b'), null);
});

// --- Refonte 2026-11-12 : décision à l'ouverture de la fiche, disponibilité de l'envoi -----------------------
import { actionALouverture, adresseNormalisee, disponibiliteEnvoi } from '../src/lib/dpeLien.js';
import { VERSION_CARTE } from '../src/lib/dpeCorpus.js';

const FICHE = { address: '423 Chemin de Caroulet', postal_code: '31340', city: 'VACQUIERS' };
const ADR = adresseNormalisee(FICHE);
const LIGNE = { dpe_number: '2631E0482288Y', origine: 'auto', etat: 'rattache', adresse_tentee: ADR, carte: {}, version_carte: VERSION_CARTE };
const ouvrir = (o) => actionALouverture({ adresseFiche: ADR, dpeNumberFiche: '2631E0482288Y', peutModifier: true, clientDpe: LIGNE, ...o });

test('adresseNormalisee : casse, accents et espaces neutralisés ; adresse incomplète ⇒ null', () => {
  assert.equal(adresseNormalisee({ address: ' 423  Chemin de Caroulet ', postal_code: '31340', city: 'Vacquiers' }), ADR);
  assert.equal(adresseNormalisee({ address: '1 rue Été', postal_code: '', city: 'Gaillac' }), '1 rue ete gaillac');
  assert.equal(adresseNormalisee({ address: '', postal_code: '31340', city: 'X' }), null);
  assert.equal(adresseNormalisee({ address: '1 rue X', postal_code: '', city: '' }), null);
  assert.equal(adresseNormalisee(null), null);
});

test('actionALouverture : première ouverture sans numéro ⇒ rattacher ; avec numéro tapé ⇒ actualiser', () => {
  assert.equal(ouvrir({ clientDpe: null, dpeNumberFiche: '' }), 'rattacher');
  assert.equal(ouvrir({ clientDpe: null }), 'actualiser');
});

test('actionALouverture : rien sans droit, sans adresse, ou quand tout est à jour', () => {
  assert.equal(ouvrir({ peutModifier: false, clientDpe: null, dpeNumberFiche: '' }), 'rien');
  assert.equal(ouvrir({ adresseFiche: null, clientDpe: null, dpeNumberFiche: '' }), 'rien');
  assert.equal(ouvrir({}), 'rien');
});

test('actionALouverture : numéro de la fiche différent de la ligne (saisi à la main) ⇒ actualiser', () => {
  assert.equal(ouvrir({ dpeNumberFiche: '2481E2082752C' }), 'actualiser');
  assert.equal(ouvrir({ dpeNumberFiche: '' }), 'actualiser');
});

test('actionALouverture : carte absente ou d\'une version antérieure ⇒ actualiser', () => {
  assert.equal(ouvrir({ clientDpe: { ...LIGNE, origine: 'choisi', carte: null } }), 'actualiser');
  assert.equal(ouvrir({ clientDpe: { ...LIGNE, version_carte: 0 } }), 'actualiser');
});

test('actionALouverture : adresse changée — auto ⇒ rattacher, choisi / saisi ⇒ signaler', () => {
  const autre = adresseNormalisee({ ...FICHE, address: '12 Rue Neuve' });
  assert.equal(ouvrir({ adresseFiche: autre }), 'rattacher');
  assert.equal(ouvrir({ adresseFiche: autre, clientDpe: { ...LIGNE, origine: 'choisi' } }), 'signaler_adresse');
  assert.equal(ouvrir({ adresseFiche: autre, clientDpe: { ...LIGNE, origine: 'saisi' } }), 'signaler_adresse');
  // Adresse de tentative inconnue (reprise de l'existant) : ce n'est pas un changement.
  assert.equal(ouvrir({ clientDpe: { ...LIGNE, origine: 'choisi', adresse_tentee: null } }), 'rien');
});

test('actionALouverture : tentative sans DPE — même adresse ⇒ rien, adresse changée ⇒ rattacher', () => {
  const sans = { dpe_number: null, origine: null, etat: 'aucun_dpe', adresse_tentee: ADR, carte: null, version_carte: null };
  assert.equal(ouvrir({ clientDpe: sans, dpeNumberFiche: '' }), 'rien');
  assert.equal(ouvrir({ clientDpe: { ...sans, etat: 'candidats' }, dpeNumberFiche: '' }), 'rien');
  // Une panne (géocodeur, corpus) se retente après une heure, pas avant ; jamais si la date manque.
  const maintenant = new Date('2026-11-12T12:00:00Z');
  assert.equal(ouvrir({ clientDpe: { ...sans, etat: 'erreur', tente_le: '2026-11-12T11:30:00Z' }, dpeNumberFiche: '', maintenant }), 'rien');
  assert.equal(ouvrir({ clientDpe: { ...sans, etat: 'erreur', tente_le: '2026-11-12T10:30:00Z' }, dpeNumberFiche: '', maintenant }), 'rattacher');
  assert.equal(ouvrir({ clientDpe: { ...sans, etat: 'erreur', tente_le: null }, dpeNumberFiche: '', maintenant }), 'rattacher');
  assert.equal(ouvrir({ clientDpe: sans, dpeNumberFiche: '', adresseFiche: '1 rue neuve 81600 gaillac' }), 'rattacher');
});

test('disponibiliteEnvoi : invisible sans module Communication ou sans droit ; raisons sinon', () => {
  const base = { communicationActive: true, peutModifier: true, emailClient: 'a@b.fr', rapportComplet: true, expediteurConfigure: true };
  assert.deepEqual(disponibiliteEnvoi(base), { visible: true, actif: true, raison: null });
  assert.equal(disponibiliteEnvoi({ ...base, communicationActive: false }).visible, false);
  assert.equal(disponibiliteEnvoi({ ...base, peutModifier: false }).visible, false);
  for (const [cle, val] of [['emailClient', '  '], ['rapportComplet', false], ['expediteurConfigure', false]]) {
    const d = disponibiliteEnvoi({ ...base, [cle]: val });
    assert.equal(d.visible, true);
    assert.equal(d.actif, false);
    assert.ok(d.raison && d.raison.length > 10, cle);
  }
});
