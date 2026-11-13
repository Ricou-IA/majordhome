// scripts/catalogue/woocommerce-pieces.test.mjs
// Adaptateur de pièces détachées WooCommerce (src/lib/catalogue/woocommercePieces.js — Energies Bois Distribution)
// sur un EXTRAIT RÉEL du flux public : scripts/catalogue/data/ebd-pieces-2026-11.json (102 catégories, 118 fiches du
// rayon « Pièces détachées Freepoint », 1 fiche à variantes réelle, + 4 fiches fabriquées marquées `_fabrique`).
// Les nombres épinglés ci-dessous sont ceux de cet extrait.
// Run : node --test scripts/catalogue/woocommerce-pieces.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MARQUE_RELEVE, DESCRIPTION_MAX, texteDepuisHtml, rayonsDePieces, marqueDeLaFiche, piecesDepuisReleveWoocommerce,
} from '../../src/lib/catalogue/woocommercePieces.js';
import { configCataloguePieces, accordValide } from '../../src/lib/catalogue/cataloguePieces.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const releve = JSON.parse(readFileSync(path.join(racine, 'scripts', 'catalogue', 'data', 'ebd-pieces-2026-11.json'), 'utf8'));
const OPTIONS = { version: 'woocommerce_2026-11-12', releveLe: '2026-11-12T04:00:00Z' };
const categoriesParId = new Map(releve.categories.map((c) => [c.id, c]));
const item = (sku) => releve.items.find((i) => i.sku === sku);

test('constantes', () => {
  assert.equal(MARQUE_RELEVE, 'CATALOGUE');
  assert.equal(DESCRIPTION_MAX, 20000);
});

test('l’extrait est cohérent : total = nombre de fiches, 102 catégories', () => {
  assert.equal(releve.total, releve.items.length);
  assert.equal(releve.items.length, 123);
  assert.equal(releve.categories.length, 102);
  assert.equal(releve.items.filter((i) => i._fabrique).length, 4);
});

test('rayonsDePieces : la racine et ses descendants, rien d’autre', () => {
  const ids = rayonsDePieces(releve.categories);
  assert.ok(ids instanceof Set);
  assert.equal(ids.size, 60);
  for (const id of [9165, 9179, 9198, 9190, 9274, 9268]) assert.ok(ids.has(id), `rayon ${id} attendu (« Pièces détachées », « … MCZ », « Joints MCZ », « … Freepoint »)`);
  for (const id of [9163, 9578, 9183, 9196, 9241, 9195]) assert.ok(!ids.has(id), `rayon ${id} attendu hors pièces (conduits, poêles, chaudières)`);
  assert.deepEqual([...rayonsDePieces(undefined)], []);
  // un rayon dont le parent est lui-même, ou une boucle, ne fait pas planter
  assert.deepEqual([...rayonsDePieces([{ id: 1, name: 'Pièces détachées', parent: 0 }, { id: 2, name: 'A', parent: 3 }, { id: 3, name: 'B', parent: 2 }])], [1]);
});

test('texteDepuisHtml', () => {
  assert.equal(texteDepuisHtml('<p>Compatible&nbsp;: <b>Globe</b> / Globe Airtight</p><script>alert(1)</script>'), 'Compatible : Globe / Globe Airtight');
  assert.equal(texteDepuisHtml('x'.repeat(50000)).length, 20000);
  for (const v of [null, undefined, 42]) assert.equal(texteDepuisHtml(v), '');
  assert.equal(texteDepuisHtml('<style>p{color:red}</style><div>a</div><div>b</div>a<br>c<br/>d'), 'a b a c d');
  assert.equal(texteDepuisHtml('d&#8217;allumage &eacute;lectrique &amp; &lt;b&gt; &quot;x&quot; &#039;y&#039; &#x41; &inconnue;'), 'd’allumage électrique & <b> "x" \'y\' A &inconnue;');
  assert.equal(texteDepuisHtml('  <ul>\n<li>un</li>\n<li>deux</li></ul> \n\t fin '), 'un deux fin');
  assert.equal(texteDepuisHtml('Globe</b>Airtight'), 'GlobeAirtight');
});

test('marqueDeLaFiche : la marque de la fiche, sinon le rayon « Pièces détachées X », sinon DIVERS', () => {
  assert.equal(marqueDeLaFiche(item('4D145181040'), categoriesParId), 'CADEL');
  assert.equal(marqueDeLaFiche({ brands: [{ name: '  mcz ' }], categories: [] }, categoriesParId), 'MCZ');
  // sans marque : rayon le plus profond dont le nom commence par « Pièces détachées », « divers » retiré, premier du flux à égalité
  assert.equal(marqueDeLaFiche(item('COLREF70'), categoriesParId), 'BRISACH');
  assert.equal(marqueDeLaFiche(item('480022'), categoriesParId), 'ECOFOREST');
  assert.equal(marqueDeLaFiche(item('4160239'), categoriesParId), 'CADEL');
  assert.equal(marqueDeLaFiche(item('60389.1'), categoriesParId), 'ECOFOREST');
  // le rayon racine seul ne donne pas de marque
  assert.equal(marqueDeLaFiche({ categories: [{ id: 9165, name: 'Pièces détachées' }] }, categoriesParId), 'DIVERS');
  assert.equal(marqueDeLaFiche({ categories: [{ id: 9163, name: 'Conduits de fumées' }] }, categoriesParId), 'DIVERS');
  assert.equal(marqueDeLaFiche({}, categoriesParId), 'DIVERS');
  assert.equal(marqueDeLaFiche(null, null), 'DIVERS');
});

test('les quatre bougies du rayon Freepoint', () => {
  const { lignes } = piecesDepuisReleveWoocommerce(releve, OPTIONS);
  const par = Object.fromEntries(lignes.map((l) => [l.reference, l]));
  assert.equal(par['4D145181040'].specs.canonical.prix_public_ttc, 47.7);
  assert.equal(par['4D145181040'].tarif_public, 39.75);
  assert.equal(par['4D145181040'].purchase_price_ht, 39.75);
  assert.equal(par['4D145181040'].brand, 'CADEL');
  assert.ok(par['4D145181040'].specs.canonical.rayons.some((r) => /freepoint/i.test(r)));
  assert.match(par['4D145181040'].specs.canonical.description_marchand, /Globe Airtight/);
  assert.ok(par['4D14513002'] && par['41451308101'] && par['41450905000']);
  assert.match(par['4D14513002'].specs.canonical.description_marchand, /Globe/);
  for (const l of lignes) { assert.equal(l.category, 'piece_detachee'); assert.equal(l.specs.canonical.catalogue_pieces, true); }
});

test('forme d’une ligne : les clés lues par supplier_pieces_upsert, rien de plus', () => {
  const { lignes } = piecesDepuisReleveWoocommerce(releve, OPTIONS);
  const l = lignes.find((x) => x.reference === '4D145181040');
  assert.deepEqual(Object.keys(l).sort(), [
    'brand', 'category', 'default_tva_rate', 'image_source_url', 'image_url', 'name', 'product_kind', 'purchase_price_ht',
    'reference', 'selling_price_ht_defaut', 'specs', 'tarif_public', 'taux_remise', 'unit',
  ]);
  assert.equal(l.name, 'Bougie d’allumage CADEL / FREEPOINT réf. 4D145181040');
  assert.equal(l.default_tva_rate, 20);
  assert.equal(l.unit, 'pièce');
  assert.equal(l.product_kind, 'accessory');
  assert.equal(l.taux_remise, 0);
  assert.equal(l.selling_price_ht_defaut, 39.75, 'le prix de vente par défaut suit le prix public HT');
  assert.equal(l.image_source_url, 'https://energies-bois-distribution.com/produit/bougie-dallumage-cadel-freepoint-ref-4d145181040/');
  assert.match(l.image_url, /^https:\/\/energies-bois-distribution\.com\/wp-content\/uploads\//);
  assert.equal(l.specs.source_version, 'woocommerce_2026-11-12');
  assert.deepEqual(Object.keys(l.specs.canonical).sort(), ['catalogue_pieces', 'description_marchand', 'fiche_produit', 'prix_public_ttc', 'rayons', 'stock_releve']);
  assert.equal(l.specs.canonical.fiche_produit, l.image_source_url);
  assert.deepEqual(l.specs.canonical.stock_releve, { en_stock: true, at: '2026-11-12T04:00:00Z' });
  assert.ok(l.specs.canonical.rayons.includes('Pièces détachées Freepoint'));
  assert.ok(l.specs.canonical.rayons.includes('Bougies d\'allumage CADEL'), 'noms de rayons décodés');
  assert.ok(!l.specs.canonical.rayons.includes('Solde d\'été 2026'), 'seuls les rayons de pièces sont gardés');
  // un nom du flux avec entité HTML est décodé
  const mcz = lignes.find((x) => x.reference === '41451308101');
  assert.ok(!/&#?\w+;/.test(mcz.name), mcz.name);
  // aucune description ne contient de balise ni d’entité numérique, et toutes sont bornées
  for (const x of lignes) {
    assert.ok(x.specs.canonical.description_marchand.length <= DESCRIPTION_MAX);
    assert.ok(!/<\/?[a-z][^>]*>/i.test(x.specs.canonical.description_marchand), x.reference);
    assert.ok(!/&#\d+;/.test(x.specs.canonical.description_marchand), x.reference);
  }
});

test('descriptions réelles longues : la liste des modèles compatibles n’est pas coupée', () => {
  const { lignes } = piecesDepuisReleveWoocommerce(releve, OPTIONS);
  const d = lignes.find((l) => l.reference === '41451308101').specs.canonical.description_marchand;
  assert.equal(d.length, 13091);
  assert.ok(d.indexOf('Suite Comfort Air 14 M2') > 8000, 'un modèle cité après le 8 000e caractère est gardé');
  assert.ok(d.endsWith('du lundi au vendredi'), 'la fin de la fiche est gardée');
  assert.equal(Math.max(...lignes.map((l) => l.specs.canonical.description_marchand.length)), 13091);
  assert.equal(lignes.filter((l) => l.specs.canonical.description_marchand.length >= DESCRIPTION_MAX).length, 0, 'aucune des 119 lignes n’est tronquée');
});

test('référence : entités HTML décodées', () => {
  const base = item('4D145181040');
  const un = (sku) => piecesDepuisReleveWoocommerce(
    { total: 1, categories: releve.categories, items: [{ ...base, sku }] }, { version: 'v', releveLe: 'x' },
  ).lignes[0].reference;
  assert.equal(un('68866 &#8211; 68867'), '68866 – 68867');
  assert.equal(un('  A&amp;B  '), 'A&B');
});

test('remise', () => {
  const { lignes } = piecesDepuisReleveWoocommerce(releve, { ...OPTIONS, remisePct: 20 });
  const l = lignes.find((x) => x.reference === '4D145181040');
  assert.equal(l.purchase_price_ht, 31.8);
  assert.equal(l.taux_remise, 20);
  assert.equal(l.tarif_public, 39.75);
  assert.equal(l.selling_price_ht_defaut, 39.75);
  // remise invalide : traitée comme 0
  for (const remisePct of [-5, 100, 'abc', NaN]) {
    const r = piecesDepuisReleveWoocommerce(releve, { ...OPTIONS, remisePct }).lignes.find((x) => x.reference === '4D145181040');
    assert.equal(r.purchase_price_ht, 39.75);
    assert.equal(r.taux_remise, 0);
  }
  // remise décimale, arrondie au centime
  const d = piecesDepuisReleveWoocommerce(releve, { ...OPTIONS, remisePct: 12.5 }).lignes.find((x) => x.reference === '4D145181040');
  assert.equal(d.purchase_price_ht, 34.78); // 39,75 × 0,875 = 34,78125
  assert.equal(d.taux_remise, 12.5);
});

test('prix : TTC → HT arrondi au centime, sans erreur de virgule flottante', () => {
  const base = item('4D145181040');
  const rel = (prix, extra = {}) => ({
    total: 1, fetched_at: 'x', categories: releve.categories,
    items: [{ ...base, sku: 'P', prices: { price: String(prix), currency_minor_unit: 2 }, ...extra }],
  });
  const ht = (prix) => piecesDepuisReleveWoocommerce(rel(prix), { version: 'v', releveLe: 'x' }).lignes[0];
  assert.equal(ht(4500).tarif_public, 37.5);
  assert.equal(ht(1).tarif_public, 0.01); // 0,00833 → 0,01
  assert.equal(ht(7).tarif_public, 0.06); // 7 / 1,2 = 5,83 centimes → 6
  assert.equal(ht(3).tarif_public, 0.03); // 0,025 pile → arrondi au-dessus
  assert.equal(ht(11990).tarif_public, 99.92); // 119,90 / 1,2 = 99,9166
  assert.equal(ht(11990).specs.canonical.prix_public_ttc, 119.9);
  // unité mineure absente : 2 par défaut
  const sans = piecesDepuisReleveWoocommerce({ ...rel(4770), items: [{ ...base, sku: 'P', prices: { price: '4770' } }] }, { version: 'v', releveLe: 'x' }).lignes[0];
  assert.equal(sans.specs.canonical.prix_public_ttc, 47.7);
});

test('exclusions comptées : une fiche dans un seul compteur', () => {
  const { lignes, compte, rayons } = piecesDepuisReleveWoocommerce(releve, OPTIONS);
  assert.deepEqual(compte, { retenues: 119, variantes: 1, sans_prix: 1, sans_reference: 1, hors_rayon: 1 });
  assert.equal(lignes.length, 119);
  assert.equal(compte.retenues + compte.variantes + compte.sans_prix + compte.sans_reference + compte.hors_rayon, releve.items.length);
  // la fiche à variantes réelle (Display CPU Ecoforest) et les fiches fabriquées ne sont pas des lignes
  assert.ok(!lignes.some((l) => l.reference === 'TEST-HORS-RAYON' || l.reference === 'TEST-SANS-PRIX'));
  assert.ok(!lignes.some((l) => /68866/.test(l.reference)));
  // la fiche en rupture EST retenue, avec son stock à faux
  const rupture = lignes.find((l) => l.reference === 'TEST-RUPTURE');
  assert.ok(rupture);
  assert.equal(rupture.specs.canonical.stock_releve.en_stock, false);
  assert.equal(lignes.filter((l) => l.specs.canonical.stock_releve.en_stock).length, 118);
  // les rayons du compte rendu : noms de rayons de pièces seulement, sans doublon
  assert.ok(Array.isArray(rayons));
  assert.ok(rayons.includes('Pièces détachées Freepoint'));
  assert.equal(new Set(rayons).size, rayons.length);
  assert.ok(!rayons.some((r) => /conduit|solde/i.test(r)));
  // références uniques
  assert.equal(new Set(lignes.map((l) => l.reference)).size, lignes.length);
});

test('une fiche non achetable mais sans autre défaut reste retenue', () => {
  const rupture = piecesDepuisReleveWoocommerce(releve, OPTIONS).lignes.find((l) => l.reference === 'TEST-RUPTURE');
  assert.equal(item('TEST-RUPTURE').is_purchasable, false);
  assert.equal(rupture.purchase_price_ht, 39.75);
});

test('relevé tronqué refusé', () => {
  assert.throws(() => piecesDepuisReleveWoocommerce({ ...releve, total: releve.items.length + 1 }, { version: 'v', releveLe: 'x' }), /releve_incomplet/);
  assert.throws(() => piecesDepuisReleveWoocommerce({ ...releve, items: [] }, { version: 'v', releveLe: 'x' }), /releve_incomplet/);
  assert.throws(() => piecesDepuisReleveWoocommerce(null, { version: 'v', releveLe: 'x' }), /releve_incomplet/);
});

test('aucune ligne retenue : refusé', () => {
  const seulementHors = { ...releve, total: 1, items: [item('TEST-HORS-RAYON')] };
  assert.throws(() => piecesDepuisReleveWoocommerce(seulementHors, { version: 'v', releveLe: 'x' }), /releve_incomplet/);
});

test('référence en double refusée', () => {
  const a = item('4D145181040');
  assert.throws(
    () => piecesDepuisReleveWoocommerce({ ...releve, total: 2, items: [a, { ...a, id: 1 }] }, { version: 'v', releveLe: 'x' }),
    /reference_en_double: 4D145181040/,
  );
});

test('version et date du relevé requises', () => {
  assert.throws(() => piecesDepuisReleveWoocommerce(releve, { releveLe: 'x' }), /version/);
  assert.throws(() => piecesDepuisReleveWoocommerce(releve, { version: 'v' }), /releveLe/);
});

test('description : la longue, sinon la courte', () => {
  const base = item('4D145181040');
  const un = (extra) => piecesDepuisReleveWoocommerce(
    { total: 1, categories: releve.categories, items: [{ ...base, sku: 'D', ...extra }] },
    { version: 'v', releveLe: 'x' },
  ).lignes[0].specs.canonical.description_marchand;
  assert.equal(un({ description: '', short_description: '<p>Courte</p>' }), 'Courte');
  assert.equal(un({ description: '<p>Longue</p>', short_description: '<p>Courte</p>' }), 'Longue');
  assert.equal(un({ description: undefined, short_description: undefined }), '');
});


// Garde-fou : l’extrait est versé au dépôt ; il ne doit contenir AUCUNE coordonnée réelle du marchand. On lit le JSON
// brut ET sa forme sérialisée (espaces insécables, échappés ou non, « &nbsp; » compris).
const SEP = String.raw`(?:[\s\u00a0\u202f.\-–]|&nbsp;|&#160;|&#xa0;)*`;
const RE_TEL_FR = new RegExp(String.raw`(?:(?:\+|00)33${SEP}\(?0?\)?${SEP}|(?<!\d)0)[1-9](?:${SEP}\d{2}){4}(?!\d)`, 'g');
const RE_EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

test('l’extrait ne contient aucune coordonnée réelle (téléphone français, e-mail)', () => {
  const brut = readFileSync(path.join(racine, 'scripts', 'catalogue', 'data', 'ebd-pieces-2026-11.json'), 'utf8');
  for (const texte of [brut, JSON.stringify(JSON.parse(brut))]) {
    assert.deepEqual([...texte.matchAll(RE_TEL_FR)].map((m) => m[0]), [], 'numéro de téléphone français');
    const autres = [...texte.matchAll(RE_EMAIL)].map((m) => m[0]).filter((e) => e !== 'contact@exemple.invalid');
    assert.deepEqual(autres, [], 'adresse e-mail autre que la valeur neutre');
    assert.doesNotMatch(texte, /mailto:(?!contact@exemple\.invalid)/i);
    assert.doesNotMatch(texte, /tel:(?!\+33000000000)/i);
    assert.doesNotMatch(texte, /whatsapp|wa\.me/i);
  }
  // le garde-fou détecte bien ce qu’il doit détecter
  const faux = [
    '06 52 17 11 91', '06\u00a052\u00a017\u00a011\u00a091', '06&nbsp;52&nbsp;17&nbsp;11&nbsp;91', '06.52.17.11.91', '06-52-17-11-91',
    '0652171191', '+33 6 52 17 11 91', '+33652171191', '0033 6 52 17 11 91', '+33 (0)6 52 17 11 91', '01 23 45 67 89',
  ];
  for (const v of faux) assert.equal([...v.matchAll(RE_TEL_FR)].length, 1, v);
  for (const ok of ['00 00 00 00 00', 'tel:+33000000000', 'S/N 1902126010015', 'réf. 4D145181040']) assert.equal([...ok.matchAll(RE_TEL_FR)].length, 0, ok);
  assert.ok(brut.includes('00 00 00 00 00') && brut.includes('tel:+33000000000') && brut.includes('contact@exemple.invalid'));
});


// --- Configuration du fournisseur : accord du marchand et mode « boutique publique, catalogue de pièces » ------------------
const ACCORD = { contact: 'M. X', date: '2026-11-12' };

test('configCataloguePieces : lit public, catalogue_pieces, accord et remise ; tout est inactif par défaut', () => {
  assert.deepEqual(configCataloguePieces({ public: true, catalogue_pieces: true, accord: ACCORD, pieces: { remise_pct: 30 } }),
    { public: true, pieces: true, accord: ACCORD, remisePct: 30 });
  const neutre = { public: false, pieces: false, accord: null, remisePct: 0 };
  for (const v of [null, undefined, 'x', 42, [], {}, { public: 'oui', catalogue_pieces: 1, accord: 'M. X', pieces: 'x' }]) {
    assert.deepEqual(configCataloguePieces(v), neutre, JSON.stringify(v));
  }
  // public sans pièces (et l’inverse) : chaque drapeau reste indépendant
  assert.deepEqual(configCataloguePieces({ public: true }), { public: true, pieces: false, accord: null, remisePct: 0 });
  assert.deepEqual(configCataloguePieces({ catalogue_pieces: true }), { public: false, pieces: true, accord: null, remisePct: 0 });
});

test('configCataloguePieces : remise dans [0 ; 100[, sinon 0 ; accord mal formé = null', () => {
  const remise = (v) => configCataloguePieces({ pieces: { remise_pct: v } }).remisePct;
  assert.equal(remise(12.5), 12.5);
  assert.equal(remise(-5), 0);
  assert.equal(remise(250), 0);
  assert.equal(remise(100), 0);
  assert.equal(remise(99.99), 99.99);
  assert.equal(remise('abc'), 0);
  assert.equal(remise(NaN), 0);
  assert.equal(remise(undefined), 0);
  assert.equal(configCataloguePieces({ accord: { contact: 'M. X' } }).accord, null);
  assert.equal(configCataloguePieces({ accord: { date: '2026-11-12' } }).accord, null);
  assert.equal(configCataloguePieces({ accord: [ACCORD] }).accord, null);
});

test('accordValide : contact non vide ET date AAAA-MM-JJ réelle, non future', () => {
  const T = '2026-11-12';
  assert.equal(accordValide({ accord: ACCORD }, T), true);
  assert.equal(accordValide({ accord: { contact: 'M. X', date: '2026-11-11' } }, T), true);
  for (const accord of [
    { contact: '', date: '2026-11-12' }, { contact: '   ', date: '2026-11-12' }, { contact: 'M. X' }, { contact: 'M. X', date: '' },
    { contact: 'M. X', date: '2026-11-13' }, { contact: 'M. X', date: '2027-01-01' },
    { contact: 'M. X', date: '12/11/2026' }, { contact: 'M. X', date: '2026-1-2' }, { contact: 'M. X', date: '2026-02-30' },
    { contact: 'M. X', date: '2026-13-01' }, { contact: 'M. X', date: '2026-11-12T10:00:00Z' }, { contact: 12, date: '2026-11-12' },
  ]) assert.equal(accordValide({ accord }, T), false, JSON.stringify(accord));
  for (const v of [null, undefined, {}, 'x', { accord: null }, { accord: 'M. X' }]) assert.equal(accordValide(v, T), false);
  // sans date du jour fournie : la date du jour UTC fait foi
  const jour = new Date().toISOString().slice(0, 10);
  assert.equal(accordValide({ accord: { contact: 'M. X', date: jour } }), true);
  assert.equal(accordValide({ accord: { contact: 'M. X', date: '2099-01-01' } }), false);
});

test('remise : UNE seule règle pour la configuration et l’adaptateur (0 ≤ r < 100, sinon 0)', () => {
  const cas = [[0, 0], [12.5, 12.5], ['30', 30], [99.99, 99.99], [100, 0], [100.5, 0], [250, 0], [-5, 0], ['abc', 0], [NaN, 0], [Infinity, 0], [undefined, 0]];
  for (const [entree, attendu] of cas) {
    const lue = configCataloguePieces({ pieces: { remise_pct: entree } }).remisePct;
    assert.equal(lue, attendu, `configCataloguePieces(${String(entree)})`);
    const ligne = piecesDepuisReleveWoocommerce(releve, { ...OPTIONS, remisePct: entree }).lignes[0];
    assert.equal(ligne.taux_remise, attendu, `adaptateur(${String(entree)})`);
  }
});

test('texteDepuisHtml : temps LINÉAIRE sur du HTML mal formé (une fiche abîmée ne tue pas le relevé)', () => {
  const pathologiques = {
    'balises <a x sans chevron fermant (400 Ko)': '<a x'.repeat(100_000),
    'guillemet d’attribut jamais fermé (400 Ko)': `<p class="${'a '.repeat(200_000)}`,
    "<p class=' répétés (300 Ko)": "<p class='".repeat(30_000),
    'commentaires et scripts jamais fermés (400 Ko)': '<!--<script><style>'.repeat(21_000),
  };
  for (const [nom, html] of Object.entries(pathologiques)) {
    const t0 = performance.now();
    const sortie = texteDepuisHtml(html);
    const ms = performance.now() - t0;
    // ancien nettoyage : plus de 77 s pour ces entrées ; 1 500 ms laisse de la marge à une machine chargée
    assert.ok(ms < 1500, `${nom} : ${ms.toFixed(0)} ms`);
    assert.ok(sortie.length <= 20000, nom);
  }
});

test('texteDepuisHtml : une balise sans « > » est du texte ; chevrons dans un attribut tolérés', () => {
  assert.equal(texteDepuisHtml('prix < 10 € et <b>gras</b>'), 'prix < 10 € et gras');
  assert.equal(texteDepuisHtml('fin <a href="x'), 'fin <a href="x');
  assert.equal(texteDepuisHtml('<a title="a > b">lien</a>'), 'lien');
  assert.equal(texteDepuisHtml('a<!-- commentaire -->b'), 'a b');
  assert.equal(texteDepuisHtml('a<SCRIPT type="x">var s = "</p>";</SCRIPT >b'), 'a b');
  assert.equal(texteDepuisHtml('a<script>jamais fermé'), 'a');
  assert.equal(texteDepuisHtml('<!DOCTYPE html><p>x</p>'), 'x');
  assert.equal(texteDepuisHtml('1 <2 et 3> 2'), '1 <2 et 3> 2');
});
