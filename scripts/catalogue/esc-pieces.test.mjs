// Relevé des pièces détachées d'ESC Grossiste : contrôle du relevé et mise en forme des lignes, sur le relevé RÉEL
// (scripts/catalogue/data/esc-pieces-2026-11.json). Module pur, aucun réseau.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { piecesDepuisReleveEsc, controlerReleveEsc, PREFIXE_REFERENCE } from './esc-pieces.js';

const releve = JSON.parse(readFileSync(new URL('./data/esc-pieces-2026-11.json', import.meta.url), 'utf8'));
const VERSION = 'esc-pieces_2026-11-14';

test('le relevé réel est complet : chaque rayon a autant de fiches lues qu\'annoncé', () => {
  assert.deepEqual(controlerReleveEsc(releve), { ok: true, erreurs: [] });
  assert.equal(releve.rayons.length, 576);
  assert.equal(releve.pieces.length, 2172);
});

test('relevé réel : 2 147 pièces retenues, 11 hors périmètre, 14 sans prix, somme des prix pinnée', () => {
  const { lignes, compte, rayons } = piecesDepuisReleveEsc(releve, { version: VERSION });
  assert.deepEqual(compte, { retenues: 2147, hors_perimetre: 11, sans_prix: 14 });
  assert.equal(lignes.length, 2147);
  assert.equal(rayons.length, 575);
  assert.equal(lignes.reduce((s, l) => s + Math.round(l.specs.canonical.prix_public_ttc * 100), 0), 34440547);
  assert.equal(lignes.reduce((s, l) => s + Math.round(l.tarif_public * 100), 0), 28700536);
  assert.equal(new Set(lignes.map((l) => l.reference)).size, 2147);
  assert.ok(lignes.every((l) => l.reference.startsWith(PREFIXE_REFERENCE) && l.category === 'piece_detachee' && l.product_kind === 'accessory'));
  assert.ok(lignes.every((l) => l.purchase_price_ht > 0 && l.brand && l.name && l.specs.canonical.catalogue_pieces === true));
  // aucune pièce n'est rangée sous le seul nom de la racine, et la racine n'apparaît dans aucun chemin
  assert.ok(lignes.every((l) => l.specs.canonical.rayons.length > 0 && !l.specs.canonical.rayons.includes('Pièces détachées')));
});

test('une ligne : référence du site, prix public HT = TTC ÷ 1,2, rayons de la marque, stock non communiqué', () => {
  const l = piecesDepuisReleveEsc(releve, { version: VERSION }).lignes.find((x) => x.reference === 'ESC-47348');
  assert.equal(l.name, 'Grille foyer Bronpi réf 3010-00044');
  assert.equal(l.brand, 'BRONPI');
  assert.equal(l.tarif_public, 118.8);
  assert.equal(l.purchase_price_ht, 118.8);
  assert.equal(l.selling_price_ht_defaut, 118.8);
  assert.equal(l.taux_remise, 0);
  assert.equal(l.specs.source_version, VERSION);
  assert.equal(l.specs.canonical.prix_public_ttc, 142.56);
  assert.deepEqual(l.specs.canonical.rayons, ['Pièces détachées Poêle à bois', 'Pièces détachées Bronpi']);
  assert.deepEqual(l.specs.canonical.stock_releve, { at: releve.fetched_at });
  assert.equal(l.specs.canonical.fiche_produit, 'https://www.esc-grossiste.fr/boutique/pieces-detachees-bronpi/47348-grille-cendre-foyer-bronpi-ref-3010-00044.html');
  assert.equal(l.image_source_url, l.specs.canonical.fiche_produit);
});

test('le modèle de l\'appareil est écrit dans les rayons d\'une pièce rangée par modèle', () => {
  const { lignes } = piecesDepuisReleveEsc(releve, { version: VERSION });
  assert.ok(lignes.some((l) => l.specs.canonical.rayons.some((r) => /BLUEHELIX 25K50/i.test(r))));
  assert.ok(lignes.some((l) => l.specs.canonical.rayons.length > 20), 'une pièce commune à beaucoup de modèles garde tous ses rayons');
});

test('la remise du fournisseur ne touche que le prix d\'achat', () => {
  const l = piecesDepuisReleveEsc(releve, { version: VERSION, remisePct: '30' }).lignes.find((x) => x.reference === 'ESC-47348');
  assert.equal(l.tarif_public, 118.8);
  assert.equal(l.purchase_price_ht, 83.16);
  assert.equal(l.selling_price_ht_defaut, 118.8);
  assert.equal(l.taux_remise, 30);
  for (const invalide of [null, '', 'abc', -5, 100, 250]) {
    assert.equal(piecesDepuisReleveEsc(releve, { version: VERSION, remisePct: invalide }).lignes[0].taux_remise, 0, String(invalide));
  }
});

const mini = (surcharge = {}) => ({
  fetched_at: '2026-11-14T10:00:00Z',
  racine: '1',
  rayons: [
    { id: '1', nom: 'Pièces détachées', parent: null, annonce: 2, lues: 2 },
    { id: '2', nom: 'Chaudières X', parent: '1', annonce: 1, lues: 1 },
    { id: '3', nom: 'X Modèle 24', parent: '2', annonce: 1, lues: 1 },
  ],
  pieces: [
    { id: '10', url: 'https://exemple.test/10-a.html', nom: '  Sonde   X ', marque: 'x', prix_ttc: 12, image: null, rayons: ['1', '2', '3'] },
    { id: '11', url: 'https://exemple.test/11-b.html', nom: 'Jet de spa', marque: 'Spa', prix_ttc: 5, image: null, rayons: ['1'] },
  ],
  ...surcharge,
});

test('pièce rangée seulement à la racine : écartée et comptée', () => {
  const { lignes, compte } = piecesDepuisReleveEsc(mini(), { version: 'v' });
  assert.deepEqual(compte, { retenues: 1, hors_perimetre: 1, sans_prix: 0 });
  assert.equal(lignes[0].reference, 'ESC-10');
  assert.equal(lignes[0].name, 'Sonde X');
  assert.equal(lignes[0].brand, 'X');
  assert.deepEqual(lignes[0].specs.canonical.rayons, ['Chaudières X', 'X Modèle 24']);
  assert.equal(lignes[0].tarif_public, 10);
});

test('pièce sans prix ou à prix nul : écartée et comptée', () => {
  const r = mini();
  r.pieces[0].prix_ttc = null;
  r.pieces.push({ id: '12', url: 'u', nom: 'Joint', marque: '', prix_ttc: 0, image: null, rayons: ['2'] }, { id: '13', url: 'u', nom: 'Vis', marque: '', prix_ttc: 2.4, image: null, rayons: ['2'] });
  const { lignes, compte } = piecesDepuisReleveEsc(r, { version: 'v' });
  assert.deepEqual(compte, { retenues: 1, hors_perimetre: 1, sans_prix: 2 });
  assert.equal(lignes[0].brand, 'DIVERS');
});

test('relevé incomplet ou vide : refusé, rien n\'est produit', () => {
  const incomplet = mini();
  incomplet.rayons[1].lues = 0;
  assert.equal(controlerReleveEsc(incomplet).ok, false);
  assert.throws(() => piecesDepuisReleveEsc(incomplet, { version: 'v' }), /releve_incomplet: rayon 2/);
  assert.throws(() => piecesDepuisReleveEsc(mini({ pieces: [] }), { version: 'v' }), /releve_incomplet/);
  assert.throws(() => piecesDepuisReleveEsc(mini({ fetched_at: '' }), { version: 'v' }), /releve_incomplet/);
  assert.throws(() => piecesDepuisReleveEsc(mini({ pieces: [mini().pieces[1]] }), { version: 'v' }), /aucune pièce retenue/);
  assert.throws(() => piecesDepuisReleveEsc(mini(), { version: '' }), /version/);
  assert.equal(controlerReleveEsc(null).ok, false);
});

test('identifiant en double dans le relevé : refusé', () => {
  const r = mini();
  r.pieces.push({ ...r.pieces[0] });
  assert.throws(() => piecesDepuisReleveEsc(r, { version: 'v' }), /reference_en_double: ESC-10/);
});
