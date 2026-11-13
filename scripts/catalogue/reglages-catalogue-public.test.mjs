// Réglages d'un catalogue de pièces public sur la fiche du fournisseur : fusion de `connector_config`,
// état de l'accord, compte rendu du dernier relevé. Modules purs, aucun réseau.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectorConfigFusionne, etatAccord, compteRenduPieces, raisonRelevePublicBloque,
  adresseBoutiquePubliqueValide, RAISON_ADRESSE_HTTPS, messageErreurFournisseur, MESSAGE_CONNECTEUR_ADMIN,
} from '../../src/lib/catalogue/reglagesCataloguePublic.js';
import { libelleCodeErreur } from '../../src/lib/catalogue/syncResult.js';

const AUJOURDHUI = '2026-11-12';
const EXISTANT = {
  public: true,
  catalogue_pieces: true,
  accord: { contact: 'M. Dupont', date: '2026-11-01' },
  pieces: { remise_pct: 30, autre: 'x' },
  sca_path: '/a',
  cle_inconnue: { profonde: [1, 2] },
};

test('un enregistrement sans changement laisse toutes les clés, y compris inconnues', () => {
  assert.deepEqual(connectorConfigFusionne(EXISTANT, {}), EXISTANT);
  assert.notEqual(connectorConfigFusionne(EXISTANT, {}), EXISTANT);
});

test('ne modifier que la remise garde public, catalogue_pieces, accord et clés inconnues', () => {
  const out = connectorConfigFusionne(EXISTANT, { remisePieces: '25' });
  assert.deepEqual(out, { ...EXISTANT, pieces: { remise_pct: 25, autre: 'x' } });
});

test('une remise invalide ou vide laisse la remise existante', () => {
  assert.deepEqual(connectorConfigFusionne(EXISTANT, { remisePieces: 'abc' }).pieces, EXISTANT.pieces);
  assert.deepEqual(connectorConfigFusionne(EXISTANT, { remisePieces: '' }).pieces, EXISTANT.pieces);
});

test('une remise saisie sans réglage de pièces existant crée la clé pieces', () => {
  assert.deepEqual(connectorConfigFusionne({ public: true }, { remisePieces: '30' }), { public: true, pieces: { remise_pct: 30 } });
  assert.deepEqual(connectorConfigFusionne({ public: true }, { remisePieces: '' }), { public: true });
});

test('décocher « Boutique publique » remet public à false, décoche les pièces et conserve l\'accord', () => {
  const out = connectorConfigFusionne(EXISTANT, { public: false });
  assert.equal(out.public, false);
  assert.equal(out.catalogue_pieces, false);
  assert.deepEqual(out.accord, EXISTANT.accord);
  assert.deepEqual(out.pieces, EXISTANT.pieces);
  assert.deepEqual(out.cle_inconnue, EXISTANT.cle_inconnue);
});

test('« Catalogue de pièces » ne se coche pas sans boutique publique', () => {
  assert.equal(connectorConfigFusionne({}, { cataloguePieces: true }).catalogue_pieces, false);
  assert.equal(connectorConfigFusionne({}, { public: true, cataloguePieces: true }).catalogue_pieces, true);
  assert.equal(connectorConfigFusionne({ public: true, catalogue_pieces: true }, { cataloguePieces: false }).catalogue_pieces, false);
});

test('l\'accord saisi est rogné ; vide des deux côtés = retiré', () => {
  assert.deepEqual(connectorConfigFusionne({}, { accord: { contact: '  Mme X ', date: ' 2026-11-10 ' } }).accord, { contact: 'Mme X', date: '2026-11-10' });
  assert.equal('accord' in connectorConfigFusionne(EXISTANT, { accord: { contact: ' ', date: '' } }), false);
});

test('la boutique (sca_path…) se fusionne sans effacer le reste', () => {
  const out = connectorConfigFusionne({ public: true, x: 1 }, { boutique: { sca_path: '/b', site_id: '2' } });
  assert.deepEqual(out, { public: true, x: 1, sca_path: '/b', site_id: '2' });
});

test('config absente ou invalide = objet neuf', () => {
  assert.deepEqual(connectorConfigFusionne(null, { public: true }), { public: true });
  assert.deepEqual(connectorConfigFusionne([1], {}), {});
});

test('etatAccord : incomplet, invalide, futur, ok', () => {
  assert.equal(etatAccord({ contact: '', date: '' }, AUJOURDHUI), 'incomplet');
  assert.equal(etatAccord({ contact: 'M. X', date: '' }, AUJOURDHUI), 'incomplet');
  assert.equal(etatAccord({ contact: '', date: '2026-11-01' }, AUJOURDHUI), 'incomplet');
  assert.equal(etatAccord(null, AUJOURDHUI), 'incomplet');
  assert.equal(etatAccord({ contact: 'M. X', date: '2026-02-30' }, AUJOURDHUI), 'invalide');
  assert.equal(etatAccord({ contact: 'M. X', date: '2026-11-13' }, AUJOURDHUI), 'futur');
  assert.equal(etatAccord({ contact: 'M. X', date: '2026-11-12' }, AUJOURDHUI), 'ok');
  assert.equal(etatAccord({ contact: 'M. X', date: '2026-11-01' }, AUJOURDHUI), 'ok');
});

test('raisonRelevePublicBloque : seulement pour une boutique publique sans accord valable', () => {
  const phrase = 'Renseignez le contact et la date de l\'accord du fournisseur pour activer le relevé.';
  assert.equal(raisonRelevePublicBloque({ public: true, catalogue_pieces: true }, AUJOURDHUI), phrase);
  assert.equal(raisonRelevePublicBloque({ public: true, accord: { contact: 'A', date: '2027-01-01' } }, AUJOURDHUI), phrase);
  assert.equal(raisonRelevePublicBloque(EXISTANT, AUJOURDHUI), null);
  assert.equal(raisonRelevePublicBloque({ sca_path: '/a' }, AUJOURDHUI), null);
  assert.equal(raisonRelevePublicBloque({ public: false, accord: null }, AUJOURDHUI), null);
});

test('compteRenduPieces : rien sans compte', () => {
  assert.equal(compteRenduPieces(null), null);
  assert.equal(compteRenduPieces({ ok: true, total: 4 }), null);
  assert.equal(compteRenduPieces({ ok: true, compte: 'x' }), null);
});

test('compteRenduPieces : retenues, exclues par motif en français, rayons', () => {
  const r = compteRenduPieces({
    ok: true,
    compte: { retenues: 120, variantes: 5, sans_prix: 2, sans_reference: 0, hors_rayon: 30 },
    rayons: ['Joints', 'Vitres'],
  });
  assert.equal(r.retenues, 120);
  assert.deepEqual(r.exclus, [
    { cle: 'variantes', libelle: 'variantes (produits à options)', nombre: 5 },
    { cle: 'sans_prix', libelle: 'sans prix', nombre: 2 },
    { cle: 'hors_rayon', libelle: 'hors rayon de pièces', nombre: 30 },
  ]);
  assert.deepEqual(r.rayons, ['Joints', 'Vitres']);
});

test('compteRenduPieces : un motif inconnu s\'affiche tel quel, rien n\'est avalé', () => {
  const r = compteRenduPieces({ compte: { retenues: 1, en_double: 3, bizarre: 0 } });
  assert.deepEqual(r.exclus, [
    { cle: 'en_double', libelle: 'en_double', nombre: 3 },
    { cle: 'bizarre', libelle: 'bizarre', nombre: 0 },
  ]);
  assert.deepEqual(r.rayons, []);
});

test('accord_absent a son libellé français (relevé en erreur)', () => {
  assert.match(libelleCodeErreur('accord_absent'), /accord du marchand/);
});

test('adresseBoutiquePubliqueValide : https obligatoire, sans espace', () => {
  assert.equal(adresseBoutiquePubliqueValide('https://boutique.example.fr'), true);
  assert.equal(adresseBoutiquePubliqueValide('  HTTPS://boutique.example.fr/pieces '), true);
  for (const v of ['http://boutique.example.fr', 'boutique.example.fr', '', '   ', 'https://', 'https://a b', null, undefined, 3]) assert.equal(adresseBoutiquePubliqueValide(v), false, String(v));
  assert.equal(RAISON_ADRESSE_HTTPS, "L'adresse d'une boutique publique doit commencer par https://.");
});

test('messageErreurFournisseur : jeton de la base traduit, autre erreur inchangée', () => {
  assert.equal(MESSAGE_CONNECTEUR_ADMIN, "Seul un administrateur peut modifier la connexion, le site ou l'accord d'un fournisseur.");
  assert.equal(messageErreurFournisseur(new Error('P0001: connecteur_admin_requis'), 'défaut'), MESSAGE_CONNECTEUR_ADMIN);
  assert.equal(messageErreurFournisseur({ message: 'autre chose' }, 'défaut'), 'autre chose');
  assert.equal(messageErreurFournisseur(null, 'défaut'), 'défaut');
  assert.equal(messageErreurFournisseur({}, 'défaut'), 'défaut');
});
