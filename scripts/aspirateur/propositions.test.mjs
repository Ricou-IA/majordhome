// scripts/aspirateur/propositions.test.mjs — produits lus → propositions (src/lib/aspirateur/propositions.js).
// Run : node --test scripts/aspirateur/propositions.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filtrerParMarques, prixAchatHt, construirePropositions } from '../../src/lib/aspirateur/propositions.js';

const lu = (over = {}) => ({
  url: 'https://pro.invicta-group.fr/p/1', reference_fabricant: 'P613744', nom: 'Châtel', marque: 'Invicta', ean: null,
  prix: null, photo_url: null, documents: [], valeurs: {}, provenance: 'compte', lu_le: '2026-12-01T10:00:00.000Z', ...over,
});
const existant = (over = {}) => ({
  reference: 'P613744', catalog_item_id: 'ci-1', specs_canonical: {}, purchase_price_ht: null, purchase_price_at: null, documents_types: [], ...over,
});
const genres = (r) => r.propositions.map((p) => `${p.genre}:${p.cle ?? ''}:${p.cochee}`);

test('prixAchatHt : public TTC avec remise, net HT, public HT sans remise', () => {
  assert.deepEqual(prixAchatHt(1200, 'public_ttc', 30), { achat_ht: 700, public_ht: 1000 });
  assert.deepEqual(prixAchatHt(850.5, 'net_ht', null), { achat_ht: 850.5, public_ht: null });
  assert.deepEqual(prixAchatHt(1000, 'public_ht', null), { achat_ht: null, public_ht: 1000 });
  assert.deepEqual(prixAchatHt(999.999, 'public_ht', 10), { achat_ht: 900, public_ht: 1000 });
  assert.deepEqual(prixAchatHt(null, 'net_ht', null), { achat_ht: null, public_ht: null });
  assert.deepEqual(prixAchatHt(100, 'inconnue', null), { achat_ht: null, public_ht: null });
});

test('filtrerParMarques : sans accents ni casse ; liste vide = tout', () => {
  const produits = [lu({ marque: 'DÉVILLE' }), lu({ marque: 'Invicta' }), lu({ marque: null })];
  assert.equal(filtrerParMarques(produits, ['deville']).length, 1);
  assert.equal(filtrerParMarques(produits, []).length, 3);
  assert.equal(filtrerParMarques(produits, undefined).length, 3);
});

test('sans référence fabricant : échec, jamais rattaché par le nom', () => {
  const r = construirePropositions({ produits: [lu({ reference_fabricant: null })], existants: [existant()], naturePrix: 'net_ht', remisePct: null });
  assert.deepEqual(r.propositions, []);
  assert.deepEqual(r.echecs, [{ url: 'https://pro.invicta-group.fr/p/1', raison: 'reference_introuvable' }]);
});

test('référence inconnue : nouvel article coché, ses caractéristiques et documents rattachés à la référence', () => {
  const r = construirePropositions({
    produits: [lu({ reference_fabricant: 'C07768-06', nom: 'Toron', valeurs: { etas_pct: 67 }, documents: [{ type: 'fiche_technique', storage_path: 'x/a.pdf', empreinte: 'a' }] })],
    existants: [existant()], naturePrix: 'net_ht', remisePct: null,
  });
  assert.deepEqual(genres(r), ['nouvel_article::true', 'caracteristique:etas_pct:true', 'document:fiche_technique:true']);
  assert.ok(r.propositions.every((p) => p.reference === 'C07768-06' && p.catalog_item_id === null));
  assert.deepEqual(r.propositions[0].valeur, { nom: 'Toron', marque: 'Invicta', ean: null });
});

test('référence comparée sans casse ni espaces', () => {
  const r = construirePropositions({ produits: [lu({ reference_fabricant: ' p613744 ', valeurs: { etas_pct: 70 } })], existants: [existant()], naturePrix: 'net_ht', remisePct: null });
  assert.deepEqual(genres(r), ['caracteristique:etas_pct:true']);
  assert.equal(r.propositions[0].catalog_item_id, 'ci-1');
});

test('caractéristique : vide ⇒ cochée ; différente ⇒ décochée avec ancienne valeur ; identique ⇒ rien', () => {
  const r = construirePropositions({
    produits: [lu({ valeurs: { etas_pct: 67, pm_mg_nm3: 30, nox_mg_nm3: 160 } })],
    existants: [existant({ specs_canonical: { pm_mg_nm3: 25, nox_mg_nm3: 160 } })], naturePrix: 'net_ht', remisePct: null,
  });
  assert.deepEqual(genres(r), ['caracteristique:etas_pct:true', 'caracteristique:pm_mg_nm3:false']);
  assert.equal(r.propositions[1].ancienne_valeur, 25);
});

test('document d’un type déjà présent : rien ; photo seulement si aucune', () => {
  const r = construirePropositions({
    produits: [lu({ photo_url: 'https://cdn.invicta-group.fr/x.jpg', documents: [{ type: 'fiche_technique', storage_path: 'x/a.pdf', empreinte: 'a' }, { type: 'notice', storage_path: 'x/b.pdf', empreinte: 'b' }] })],
    existants: [existant({ documents_types: ['fiche_technique'], a_photo: true })], naturePrix: 'net_ht', remisePct: null,
  });
  assert.deepEqual(genres(r), ['document:notice:true']);
});

test('prix : ancien nul ⇒ coché ; plus récent connu ⇒ rien ; différent et plus ancien ⇒ décoché', () => {
  const base = { naturePrix: 'net_ht', remisePct: null };
  const nul = construirePropositions({ ...base, produits: [lu({ prix: 800 })], existants: [existant()] });
  assert.deepEqual(genres(nul), ['prix_achat::true']);
  assert.deepEqual(nul.propositions[0].valeur, { achat_ht: 800, public_ht: null });
  const recent = construirePropositions({ ...base, produits: [lu({ prix: 800 })], existants: [existant({ purchase_price_ht: 790, purchase_price_at: '2026-12-02T00:00:00Z' })] });
  assert.deepEqual(recent.propositions, []);
  const ancien = construirePropositions({ ...base, produits: [lu({ prix: 800 })], existants: [existant({ purchase_price_ht: 790, purchase_price_at: '2026-10-01T00:00:00Z' })] });
  assert.deepEqual(genres(ancien), ['prix_achat::false']);
  const pareil = construirePropositions({ ...base, produits: [lu({ prix: 790 })], existants: [existant({ purchase_price_ht: 790, purchase_price_at: '2026-10-01T00:00:00Z' })] });
  assert.deepEqual(pareil.propositions, []);
});

test('provenance et source reportées sur chaque proposition', () => {
  const r = construirePropositions({ produits: [lu({ provenance: 'public', valeurs: { etas_pct: 67 } })], existants: [existant()], naturePrix: 'net_ht', remisePct: null });
  assert.equal(r.propositions[0].provenance, 'public');
  assert.equal(r.propositions[0].source_url, 'https://pro.invicta-group.fr/p/1');
});

test('types de document ↔ libellés des documents d’article', async () => {
  const { libelleDocument, typeDocument } = await import('../../src/lib/aspirateur/propositions.js');
  assert.equal(libelleDocument('fiche_technique'), 'Fiche technique');
  assert.equal(libelleDocument('declaration_performance'), 'Déclaration de performance');
  assert.equal(typeDocument('Fiche technique'), 'fiche_technique');
  assert.equal(typeDocument('fiche TECHNIQUE'), 'fiche_technique');
  assert.equal(typeDocument('Notice'), 'notice');
  assert.equal(typeDocument('Photo'), null);
});
