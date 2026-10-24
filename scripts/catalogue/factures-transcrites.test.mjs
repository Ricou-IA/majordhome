// node --test scripts/catalogue/factures-transcrites.test.mjs
// Les relevés scannés (sans couche texte dans Pennylane) sont transcrits à la main dans
// scripts/catalogue/data/factures-transcrites/*.json : chaque fichier doit retomber sur ses propres totaux,
// comme une lecture de parseur — une faute de frappe sur un prix ou une quantité fait échouer ce test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { centimes } from './pdf-lignes.js';

const dossier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'data', 'factures-transcrites');
const fichiers = readdirSync(dossier).filter((f) => f.endsWith('.json'));

test('au moins une transcription', () => { assert.ok(fichiers.length > 0); });

for (const f of fichiers) {
  test(`${f} : lignes complètes, codes uniques, totaux réconciliés`, () => {
    const doc = JSON.parse(readFileSync(path.join(dossier, f), 'utf8'));
    assert.equal(doc.format, 'transcription');
    assert.equal(doc.type, 'facture');
    assert.match(doc.numero, /^\d{8,}$/);
    assert.match(doc.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof doc.pennylane_id, 'number');
    assert.ok(f.endsWith(`-${doc.numero}.json`), 'le nom du fichier porte le numéro de facture');
    assert.ok(doc.lignes.length > 0);
    const codes = new Set();
    for (const l of doc.lignes) {
      assert.match(l.code, /^\d{6,7}[A-Z]?$/, `code ${l.code}`);
      assert.ok(!codes.has(l.code), `code ${l.code} en double`);
      codes.add(l.code);
      assert.ok(l.designation && l.quantite > 0 && l.prix_unitaire_net != null && l.montant_ht != null, `ligne ${l.code} incomplète`);
      assert.ok(Math.abs(l.quantite * l.prix_unitaire_net - l.montant_ht) <= 0.011, `${l.code} : ${l.quantite} × ${l.prix_unitaire_net} ≠ ${l.montant_ht}`);
      assert.ok([10, 20].includes(l.tva_taux), `${l.code} : TVA ${l.tva_taux}`);
      assert.ok(l.bl?.numero && l.bl?.date, `${l.code} : BL manquant`);
    }
    const marchandises = centimes(doc.lignes.reduce((s, l) => s + l.montant_ht, 0));
    assert.equal(marchandises, doc.totaux.marchandises_ht, 'somme des articles ≠ total marchandises');
    const eco = centimes(doc.lignes.reduce((s, l) => s + (l.eco ?? 0), 0));
    assert.equal(eco, centimes((doc.totaux.frais.DEEE ?? 0) + (doc.totaux.frais.EcoP ?? 0)), 'éco-participations ≠ pied');
    const frais = Object.values(doc.totaux.frais).reduce((s, v) => s + v, 0);
    assert.equal(centimes(marchandises + frais), doc.totaux.total_ht, 'marchandises + frais ≠ total HT');
  });
}
