// Tests de lots.js (import des articles) : verifierLigneArticle et messageErreurImportArticles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifierLigneArticle, messageErreurImportArticles } from '../../src/lib/importArticles/lots.js';
import { CLES_ROW_ARTICLE, classerArticles, lignesPourEcriture } from '../../src/lib/importArticles/controles.js';
import { cleFournisseur } from '../../src/lib/importArticles/fournisseurs.js';

const UUID = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
const valide = () => ({
  import_line: 2, name: 'Poêle', code: null, brand: null, model_key: null, modele_brut: null, code_ean: null,
  category: null, gamme: null, product_kind: 'main', unit: 'pièce', default_tva_rate: 20, selling_price_ht: 100,
  description: null, ancien_numero: null, fournisseur: null,
});
const avec = (patch) => ({ ...valide(), ...patch });
const four = (patch = {}) => ({ supplier_id: UUID, reference: 'R1', purchase_price_ht: 10, tarif_public: null, purchase_price_at: null, ...patch });

test('ligne valide, fournisseur compris : null', () => {
  assert.equal(verifierLigneArticle(valide()), null);
  assert.equal(verifierLigneArticle(avec({ code_ean: '12345678', fournisseur: four({ purchase_price_at: '2026-03-15' }) })), null);
  assert.equal(verifierLigneArticle(avec({ selling_price_ht: 0, default_tva_rate: 5.5 })), null);
});

test('chaque règle cassée donne sa clé', () => {
  const cas = [
    [avec({ import_line: 0 }), 'import_line'], [avec({ import_line: 1.5 }), 'import_line'], [avec({ import_line: '2' }), 'import_line'],
    [avec({ name: '  ' }), 'name'], [avec({ name: null }), 'name'],
    [avec({ product_kind: 'autre' }), 'product_kind'],
    [avec({ default_tva_rate: 7 }), 'default_tva_rate'],
    [avec({ selling_price_ht: -1 }), 'selling_price_ht'], [avec({ selling_price_ht: '10' }), 'selling_price_ht'],
    [avec({ code_ean: '1234' }), 'code_ean'], [avec({ code_ean: 'abcdefgh' }), 'code_ean'],
    [avec({ fournisseur: four({ supplier_id: 'x' }) }), 'fournisseur'],
    [avec({ fournisseur: four({ reference: ' ' }) }), 'fournisseur'],
    [avec({ fournisseur: four({ purchase_price_ht: 0 }) }), 'fournisseur'],
    [avec({ fournisseur: four({ purchase_price_at: '15/03/2026' }) }), 'fournisseur'],
    [avec({ fournisseur: 'oui' }), 'fournisseur'],
    [null, 'import_line'],
  ];
  for (const [ligne, cle] of cas) assert.equal(verifierLigneArticle(ligne), cle, JSON.stringify(ligne));
});

test("une clé hors de la forme n'est pas refusée", () => {
  assert.equal(verifierLigneArticle(avec({ inconnue: 1 })), null);
});

test('une ligne produite par lignesPourEcriture passe, avec exactement les clés de RowArticle', () => {
  const classees = classerArticles([
    { numero: 2, valeurs: { designation: 'Poêle A', marque: 'Invicta', ean: '3760123456789', prix_vente: '2490', fournisseur: 'Invicta', ref_fournisseur: 'X1', prix_achat: '1650', date_prix: '15/03/2026' } },
    { numero: 3, valeurs: { designation: 'Tuyau' } },
  ], { articles: [], lignes: [] }, { avecFournisseur: true, fournisseursResolus: { [cleFournisseur('Invicta')]: UUID } });
  const lignes = lignesPourEcriture(classees, {}, { [cleFournisseur('Invicta')]: UUID });
  assert.equal(lignes.length, 2);
  assert.ok(lignes[0].fournisseur, 'la ligne fournisseur est bien produite');
  for (const l of lignes) {
    assert.deepEqual(Object.keys(l), CLES_ROW_ARTICLE);
    assert.equal(verifierLigneArticle(l), null);
  }
});

test("chaque code d'erreur a sa phrase, jamais le code brut", () => {
  const codes = ['unauthenticated', 'org_admin_required', 'import_not_found', 'import_closed', 'rows_invalid', 'row_invalid', 'code_pris', 'ligne_fournisseur_existante', 'supplier_not_in_org'];
  for (const code of codes) {
    const m = messageErreurImportArticles({ message: code });
    assert.notEqual(m, code);
    assert.ok(!m.includes('_'), `${code} → ${m}`);
  }
});

test('détails : ligne et colonne, ligne seule', () => {
  assert.match(messageErreurImportArticles({ message: 'row_invalid', details: 'ligne 12 : default_tva_rate' }), /Ligne 12 .*TVA/);
  assert.match(messageErreurImportArticles({ message: 'row_invalid', details: 'ligne 3 : selling_price_ht' }), /Ligne 3 .*Prix de vente HT/);
  assert.match(messageErreurImportArticles({ message: 'row_invalid', details: 'ligne 3 : zzz' }), /Ligne 3 .*zzz/);
  assert.match(messageErreurImportArticles({ message: 'code_pris', details: 'ligne 7' }), /Ligne 7/);
  assert.match(messageErreurImportArticles({ message: 'ligne_fournisseur_existante', details: 'ligne 9' }), /Ligne 9/);
  assert.match(messageErreurImportArticles({ message: 'code_pris' }), /référence interne/i);
});

test('délais, doublon de lot, réseau, inconnu', () => {
  assert.match(messageErreurImportArticles({ code: '57014', message: 'x' }), /trop de temps/);
  assert.match(messageErreurImportArticles({ code: '55P03', message: 'x' }), /trop de temps/);
  assert.match(messageErreurImportArticles({ code: '23505', message: 'dup', details: 'Key (import_id, import_line) … catalog_items_import_line_key' }), /déjà en cours/);
  assert.match(messageErreurImportArticles(new TypeError('Failed to fetch')), /Connexion interrompue/);
  assert.equal(messageErreurImportArticles(null), 'Erreur inconnue');
  assert.equal(messageErreurImportArticles({ message: 'autre chose' }), 'autre chose');
});

test('revue 1 : règles alignées sur catalog_items_import_batch', () => {
  const cas = [
    // clés texte : ni chaîne ni nombre ⇒ refus de la clé
    ...['code', 'brand', 'model_key', 'modele_brut', 'category', 'gamme', 'unit', 'description', 'ancien_numero']
      .flatMap((k) => [[avec({ [k]: { a: 1 } }), k], [avec({ [k]: ['x'] }), k], [avec({ [k]: true }), k]]),
    // prix au-delà de numeric(10,2)
    [avec({ selling_price_ht: 100000000 }), 'selling_price_ht'],
    [avec({ fournisseur: four({ purchase_price_ht: 100000000 }) }), 'fournisseur'],
    [avec({ fournisseur: four({ tarif_public: 100000000 }) }), 'fournisseur'],
    // prix d'achat qui s'arrondirait à 0,00
    [avec({ fournisseur: four({ purchase_price_ht: 0.004 }) }), 'fournisseur'],
    // prix public non numérique ou négatif
    [avec({ fournisseur: four({ tarif_public: '12' }) }), 'fournisseur'],
    [avec({ fournisseur: four({ tarif_public: -1 }) }), 'fournisseur'],
    // date inexistante
    [avec({ fournisseur: four({ purchase_price_at: '2026-02-30' }) }), 'fournisseur'],
    [avec({ fournisseur: four({ purchase_price_at: '2026-13-01' }) }), 'fournisseur'],
    // numéro de ligne au-delà de 9 chiffres
    [avec({ import_line: 1000000000 }), 'import_line'],
  ];
  for (const [ligne, cle] of cas) assert.equal(verifierLigneArticle(ligne), cle, JSON.stringify(ligne));
  // bornes admises
  const passent = [
    avec({ code: 1234, brand: 'X', unit: null, description: undefined }),
    avec({ selling_price_ht: 99999999.99, import_line: 999999999 }),
    avec({ fournisseur: four({ purchase_price_ht: 0.005, tarif_public: 0, purchase_price_at: '2024-02-29' }) }),
    avec({ fournisseur: four({ purchase_price_ht: 99999999.99, tarif_public: 99999999.99 }) }),
  ];
  for (const l of passent) assert.equal(verifierLigneArticle(l), null, JSON.stringify(l));
});

test('revue 1 : file_name_required et rattachement_incomplet traduits', () => {
  for (const code of ['file_name_required', 'rattachement_incomplet']) {
    const m = messageErreurImportArticles({ message: code });
    assert.notEqual(m, code);
    assert.ok(!m.includes('_'), `${code} → ${m}`);
  }
  assert.match(messageErreurImportArticles({ message: 'row_invalid', details: 'ligne 4 : modele_brut' }), /Ligne 4 .*Modèle/);
});

test('retrait : removal_incomplete traduit, même avec son DETAIL', () => {
  const m = messageErreurImportArticles({ message: 'removal_incomplete', details: 'articles : 99 supprimés sur 100' });
  assert.notEqual(m, 'removal_incomplete');
  assert.ok(!m.includes('_'), m);
  assert.match(m, /retrait/i);
});
