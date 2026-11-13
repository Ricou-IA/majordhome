// scripts/catalogue/sync-result.test.mjs
// Libellés du dernier relevé fournisseur (src/lib/catalogue/syncResult.js) — module PUR.
// Run : node --test scripts/catalogue/sync-result.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libelleResultat, libelleCodeErreur, CODES_ERREUR } from '../../src/lib/catalogue/syncResult.js';

const at = '2026-10-24T04:00:12.000Z';

test('relevé réussi : date, articles, nouveaux, désactivés', () => {
  const s = libelleResultat({ ok: true, at, total: 87, inseres: 2, mis_a_jour: 85, desactives: 1 });
  assert.match(s, /^Relevé du 24\/10\/2026/);
  assert.match(s, /87 articles/);
  assert.match(s, /2 nouveaux/);
  assert.match(s, /1 désactivé$/);
});

test('relevé réussi sans mouvement : pas de « 0 nouveau »', () => {
  const s = libelleResultat({ ok: true, at, total: 52, inseres: 0, mis_a_jour: 52, desactives: 0 });
  assert.match(s, /52 articles/);
  assert.doesNotMatch(s, /nouveau|désactivé/);
});

test('échec : chaque code a un libellé français et le libellé commence par « Échec »', () => {
  for (const code of CODES_ERREUR) {
    assert.ok(libelleCodeErreur(code).length > 10, code);
    assert.match(libelleResultat({ ok: false, code, at }), /^Échec du relevé du 24\/10\/2026 : /);
  }
  assert.match(libelleResultat({ ok: false, code: 'acces_bloque', at }), /site du fournisseur a refusé la connexion serveur/);
  assert.match(libelleResultat({ ok: false, code: 'identifiants_absents', at }), /identifiant/);
  assert.match(libelleResultat({ ok: false, code: 'code_inconnu_xyz', at }), /code_inconnu_xyz/);
});

test('une erreur non métier de l\'edge (réseau, réponse illisible) a son code et son libellé', () => {
  assert.ok(CODES_ERREUR.includes('erreur_inattendue'));
  assert.match(libelleCodeErreur('erreur_inattendue'), /inattendue|réessayer/i);
  assert.ok(CODES_ERREUR.includes('releve_instable'));
});

test('codes de la connexion générique et des documents : libellés français, sans « BayWa » en dur', () => {
  for (const code of ['site_absent', 'document_absent', 'document_illisible', 'document_existant']) {
    assert.ok(CODES_ERREUR.includes(code), code);
    assert.doesNotMatch(libelleCodeErreur(code), /^erreur /);
  }
  assert.doesNotMatch(libelleCodeErreur('acces_bloque'), /BayWa/);
  assert.match(libelleCodeErreur('acces_bloque'), /fournisseur|site/);
});

test('jamais relevé', () => {
  assert.equal(libelleResultat(null), 'Jamais relevé');
  assert.equal(libelleResultat(undefined), 'Jamais relevé');
  assert.equal(libelleResultat({}), 'Jamais relevé');
});

test('import_catalogue_pieces : code connu, libellé français explicite', () => {
  assert.ok(CODES_ERREUR.includes('import_catalogue_pieces'));
  assert.equal(libelleCodeErreur('import_catalogue_pieces'), "Ce fournisseur est relevé automatiquement depuis sa boutique : l'import d'un fichier n'est pas disponible.");
});

test('relevé de PIÈCES : « pièces » et non « articles », désactivées lues dans pieces_desactivees (desactives vaut 0)', () => {
  // forme réelle : supplier_pieces_upsert (20261111_2) ajoute releve / pieces_desactivees au résultat de
  // supplier_catalog_upsert (appelé avec desactiver_absents = false, donc desactives = 0) ; l'edge ajoute compte.
  const base = { ok: true, at, version: 'woocommerce_2026-10-24', inseres: 3, mis_a_jour: 116, desactives: 0, total: 121,
    releve: 'pieces', marque: 'CATALOGUE', prix_suivis: 2, prix_ajustes_non_suivis: 0, pieces_desactivees: 2 };
  const s = libelleResultat({ ...base, compte: { retenues: 119, variantes: 2, sans_prix: 1, sans_reference: 1, hors_rayon: 0 } });
  assert.equal(s, 'Relevé du 24/10/2026 : 119 pièces, 3 nouvelles, 2 pièces désactivées');
  assert.doesNotMatch(s, /article/);
  // sans compte de l'edge : le total de la RPC
  assert.equal(libelleResultat(base), 'Relevé du 24/10/2026 : 121 pièces, 3 nouvelles, 2 pièces désactivées');
  // une seule pièce désactivée, aucune nouvelle
  assert.equal(libelleResultat({ ...base, inseres: 0, pieces_desactivees: 1, compte: { retenues: 1 } }), 'Relevé du 24/10/2026 : 1 pièce, 1 pièce désactivée');
  // aucune désactivée : rien n'est dit
  assert.doesNotMatch(libelleResultat({ ...base, pieces_desactivees: 0 }), /désactiv/);
  // relevé de tarif : inchangé
  assert.match(libelleResultat({ ok: true, at, total: 87, inseres: 2, desactives: 1, pieces_desactivees: 5 }), /87 articles, 2 nouveaux, 1 désactivé$/);
});

test('codes du relevé public : https, adresse publique, redirection — libellés français', () => {
  for (const code of ['site_non_https', 'site_invalide', 'site_redirige']) {
    assert.ok(CODES_ERREUR.includes(code), code);
    assert.doesNotMatch(libelleCodeErreur(code), /^erreur /);
  }
  assert.equal(libelleCodeErreur('site_non_https'), "l'adresse du site doit commencer par https://");
  assert.match(libelleCodeErreur('site_redirige'), /corrigez l'adresse du site/);
  // même forme que les autres libellés : ils suivent « Échec du relevé du … : » (minuscule, sans point final)
  for (const code of ['site_non_https', 'site_invalide', 'site_redirige']) {
    assert.match(libelleCodeErreur(code), /^[a-zàâéèêîôûç']/, code);
    assert.doesNotMatch(libelleCodeErreur(code), /\.$/, code);
  }
  assert.equal(libelleResultat({ ok: false, code: 'site_non_https', at }), "Échec du relevé du 24/10/2026 : l'adresse du site doit commencer par https://");
});
