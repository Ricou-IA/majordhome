// scripts/devis-config.test.mjs
// Défauts du paramétrage des devis (src/lib/devisConfig.js) : famille « Batterie » et catégorie `batterie`.
// Run : node --test scripts/devis-config.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES_PRODUIT, DEFAULT_FAMILLES, buildDevisConfig, categoriesPourSection, TYPES_CHAPITRE, TAUX_TVA, typeChapitreDeduit,
  typeChapitre, tvaFamille, validerDevisConfig, tauxTvaLigne, tvaDesLignes, tvaDuDevis, nouvelleFamille,
} from '../src/lib/devisConfig.js';

test('les catégories photovoltaique et borne_recharge font partie des catégories produit du picker', () => {
  assert.ok(CATEGORIES_PRODUIT.includes('photovoltaique'));
  assert.ok(CATEGORIES_PRODUIT.includes('borne_recharge'), 'catégorie posée par le fournisseur ECOSTAL (autre session, 2026-10-24)');
});

test('famille Borne de recharge par défaut : catégorie borne_recharge seule, quatre chapitres d\'Eric, après Photovoltaïque', () => {
  const i = DEFAULT_FAMILLES.findIndex((f) => f.key === 'borne_recharge');
  assert.ok(i >= 0, 'famille borne_recharge absente');
  const f = DEFAULT_FAMILLES[i];
  assert.equal(f.label, 'Borne de recharge');
  assert.equal(f.actif, true);
  assert.deepEqual([...f.categories], ['borne_recharge']);
  assert.deepEqual([...f.sections], ['ÉQUIPEMENT', 'OPTIONS', 'SÉCURITÉ ET ACCESSOIRES', 'POSE ET MISE EN SERVICE']);
  assert.deepEqual(f.chapitres.map((c) => c.type), ['equipement', 'option', 'stock', 'main_oeuvre']);
  assert.equal(DEFAULT_FAMILLES[i - 1].key, 'photovoltaique');
  const config = buildDevisConfig({});
  assert.deepEqual(categoriesPourSection(config, 'ÉQUIPEMENT', 'borne_recharge'), ['borne_recharge']);
});

test('famille Photovoltaïque par défaut : deux catégories (photovoltaique + batterie), cinq chapitres, après Batterie', () => {
  const i = DEFAULT_FAMILLES.findIndex((f) => f.key === 'photovoltaique');
  assert.ok(i >= 0, 'famille photovoltaique absente');
  const f = DEFAULT_FAMILLES[i];
  assert.equal(f.label, 'Photovoltaïque');
  assert.deepEqual([...f.categories], ['photovoltaique', 'batterie']);
  assert.deepEqual([...f.sections], ['PANNEAUX', 'ONDULEUR ET MONITORING', 'FIXATION', 'COFFRETS ET CÂBLAGE', 'MAIN D\'ŒUVRE']);
  assert.equal(DEFAULT_FAMILLES[i - 1].key, 'batterie');
  assert.deepEqual([...DEFAULT_FAMILLES[i - 1].categories], ['batterie', 'photovoltaique']);
});

test('rétro-compatibilité : une famille enregistrée avec `categorie` (texte) ressort en `categories` (tableau)', () => {
  const config = buildDevisConfig({ devis: { familles: [{ key: 'p', label: 'P', actif: true, categorie: 'poele', sections: ['A'] }] } });
  assert.deepEqual(config.familles[0].categories, ['poele']);
  assert.equal('categorie' in config.familles[0], false);
  const libre = buildDevisConfig({ devis: { familles: [{ key: 'x', label: 'X', actif: true, categorie: null, sections: ['A'] }] } });
  assert.deepEqual(libre.familles[0].categories, []);
  const inconnue = buildDevisConfig({ devis: { familles: [{ key: 'y', label: 'Y', actif: true, categories: ['poele', 'inconnue'], sections: ['A'] }] } });
  assert.deepEqual(inconnue.familles[0].categories, ['poele']);
});

test('categoriesPourSection : les catégories de la famille, ou celle du nom de section, ou aucune (tous)', () => {
  const config = buildDevisConfig({});
  assert.deepEqual(categoriesPourSection(config, 'PANNEAUX', 'photovoltaique'), ['photovoltaique', 'batterie']);
  assert.deepEqual(categoriesPourSection(config, 'FUMISTERIE', 'poele_granules'), ['fumisterie']);
  assert.deepEqual(categoriesPourSection(config, 'MAIN D\'ŒUVRE', 'autre'), []);
});

test('la catégorie batterie fait partie des catégories produit du picker', () => {
  assert.ok(CATEGORIES_PRODUIT.includes('batterie'));
});

test('la famille Batterie par défaut : catégorie batterie, quatre chapitres d\'Eric, juste après Chauffage/PAC', () => {
  const i = DEFAULT_FAMILLES.findIndex((f) => f.key === 'batterie');
  assert.ok(i >= 0, 'famille batterie absente');
  const f = DEFAULT_FAMILLES[i];
  assert.equal(f.label, 'Batterie');
  assert.equal(f.categories[0], 'batterie');
  assert.equal(f.actif, true);
  assert.deepEqual([...f.sections], ['ÉQUIPEMENT', 'OPTIONS', 'SÉCURITÉ ET ACCESSOIRES', 'POSE ET MISE EN SERVICE']);
  assert.equal(DEFAULT_FAMILLES[i - 1].key, 'chauffage_pac');
});

test('une org sans réglage reçoit la famille Batterie', () => {
  const config = buildDevisConfig({});
  assert.ok(config.familles.some((f) => f.key === 'batterie'));
});

test('une liste de familles enregistrée prime : la famille Batterie ne s\'y ajoute pas toute seule', () => {
  const config = buildDevisConfig({ devis: { familles: [{ key: 'x', label: 'X', actif: true, categorie: null, sections: ['A'] }] } });
  assert.deepEqual(config.familles.map((f) => f.key), ['x']);
});

// --- Chapitres typés et TVA de famille (2026-10-25, décisions d'Eric) ---

test('types de chapitre et taux de TVA proposés', () => {
  assert.deepEqual([...TYPES_CHAPITRE], ['equipement', 'option', 'stock', 'main_oeuvre', 'libre', 'fumisterie']);
  assert.deepEqual([...TAUX_TVA], [20, 10, 5.5, 0]);
});

test('typeChapitreDeduit : le titre d\'un chapitre saisi avant ce chantier donne son type', () => {
  assert.equal(typeChapitreDeduit('SÉCURITÉ ET ACCESSOIRES'), 'stock', 'sécurité avant accessoire');
  assert.equal(typeChapitreDeduit('ÉLÉMENTS SÉCURITÉ'), 'stock');
  assert.equal(typeChapitreDeduit('MATÉRIEL'), 'stock');
  assert.equal(typeChapitreDeduit('COFFRETS ET CÂBLAGE'), 'stock');
  assert.equal(typeChapitreDeduit('MAIN D\'ŒUVRE'), 'main_oeuvre');
  assert.equal(typeChapitreDeduit('Main d’oeuvre'), 'main_oeuvre');
  assert.equal(typeChapitreDeduit('POSE ET MISE EN SERVICE'), 'main_oeuvre');
  assert.equal(typeChapitreDeduit('FUMISTERIE'), 'fumisterie');
  assert.equal(typeChapitreDeduit('ACCESSOIRES'), 'option');
  assert.equal(typeChapitreDeduit('OPTIONS'), 'option');
  assert.equal(typeChapitreDeduit('PRESTATIONS'), 'libre');
  assert.equal(typeChapitreDeduit('AUTRE'), 'libre');
  assert.equal(typeChapitreDeduit('PANNEAUX'), 'equipement');
  assert.equal(typeChapitreDeduit(''), 'equipement');
});

test('famille enregistrée avec des titres seuls : chapitres déduits, titres conservés', () => {
  const config = buildDevisConfig({ devis: { familles: [{ key: 'c', label: 'C', actif: true, categories: ['climatisation'], sections: ['ÉQUIPEMENT', 'ACCESSOIRES', 'MAIN D\'ŒUVRE'] }] } });
  const f = config.familles[0];
  assert.deepEqual(f.sections, ['ÉQUIPEMENT', 'ACCESSOIRES', 'MAIN D\'ŒUVRE']);
  assert.deepEqual(f.chapitres, [{ titre: 'ÉQUIPEMENT', type: 'equipement' }, { titre: 'ACCESSOIRES', type: 'option' }, { titre: 'MAIN D\'ŒUVRE', type: 'main_oeuvre' }]);
});

test('famille enregistrée avec des chapitres typés : le type saisi prime, un type inconnu est déduit', () => {
  const config = buildDevisConfig({ devis: { familles: [{ key: 'b', label: 'B', actif: true, categories: [], chapitres: [{ titre: 'ACCESSOIRES', type: 'stock' }, { titre: 'MAIN D\'ŒUVRE', type: 'bidule' }, { titre: '  ', type: 'option' }] }] } });
  assert.deepEqual(config.familles[0].chapitres, [{ titre: 'ACCESSOIRES', type: 'stock' }, { titre: 'MAIN D\'ŒUVRE', type: 'main_oeuvre' }]);
  assert.deepEqual(config.familles[0].sections, ['ACCESSOIRES', 'MAIN D\'ŒUVRE']);
});

test('typeChapitre : type du chapitre de la famille (insensible à la casse), sinon déduit du titre', () => {
  const config = buildDevisConfig({ devis: { familles: [{ key: 'b', label: 'Borne', actif: true, categories: [], tva: 10, chapitres: [{ titre: 'Accessoires', type: 'stock' }] }] } });
  assert.equal(typeChapitre(config, 'Borne', 'ACCESSOIRES'), 'stock');
  assert.equal(typeChapitre(config, 'b', 'accessoires '), 'stock');
  assert.equal(typeChapitre(config, 'Borne', 'POSE'), 'main_oeuvre', 'chapitre ajouté à la main dans le devis');
  assert.equal(typeChapitre(config, 'inconnue', 'OPTIONS'), 'option');
});

test('TVA de famille : défaut 5,5 % poêles et PAC, 10 % sinon ; valeur enregistrée hors liste ⇒ défaut', () => {
  const config = buildDevisConfig({});
  assert.equal(tvaFamille(config, 'poele_granules'), 5.5);
  assert.equal(tvaFamille(config, 'Chauffage/PAC'), 5.5);
  assert.equal(tvaFamille(config, 'borne_recharge'), 10);
  assert.equal(tvaFamille(config, 'inconnue'), 10);
  const saisie = buildDevisConfig({ devis: { familles: [
    { key: 'b', label: 'B', actif: true, categories: [], sections: ['A'], tva: 20 },
    { key: 'c', label: 'C', actif: true, categories: [], sections: ['A'], tva: 7 },
    { key: 'poele_bois', label: 'Poêle à Bois', actif: true, categories: [], sections: ['A'], tva: '5.5' },
  ] } });
  assert.equal(tvaFamille(saisie, 'b'), 20);
  assert.equal(tvaFamille(saisie, 'c'), 10, 'taux inconnu ⇒ défaut');
  assert.equal(tvaFamille(saisie, 'poele_bois'), 5.5, 'chaîne acceptée');
});

test('validation : type de chapitre inconnu et TVA hors liste refusés', () => {
  const base = buildDevisConfig({});
  const mauvais = { ...base, familles: [{ key: 'x', label: 'X', actif: true, categories: [], tva: 7, chapitres: [{ titre: 'A', type: 'bidule' }], sections: ['A'] }] };
  const r = validerDevisConfig(mauvais);
  assert.equal(r.ok, false);
  assert.ok(r.erreurs.some((e) => /type de chapitre/.test(e)), r.erreurs.join(' ; '));
  assert.ok(r.erreurs.some((e) => /TVA/.test(e)), r.erreurs.join(' ; '));
  assert.equal(validerDevisConfig(base).ok, true, 'les défauts sont valides');
});

test('défauts : chaque famille a des chapitres typés alignés sur ses titres et une TVA de la liste', () => {
  for (const f of DEFAULT_FAMILLES) {
    assert.equal(f.chapitres.length, f.sections.length, f.key);
    f.chapitres.forEach((c, i) => { assert.equal(c.titre, f.sections[i], f.key); assert.ok(TYPES_CHAPITRE.includes(c.type), f.key); });
    assert.ok(TAUX_TVA.includes(f.tva), f.key);
  }
  const poele = DEFAULT_FAMILLES.find((f) => f.key === 'poele_granules');
  assert.deepEqual(poele.chapitres.map((c) => c.type), ['equipement', 'option', 'fumisterie', 'stock', 'main_oeuvre']);
  const pv = DEFAULT_FAMILLES.find((f) => f.key === 'photovoltaique');
  assert.deepEqual(pv.chapitres.map((c) => c.type), ['equipement', 'equipement', 'equipement', 'stock', 'main_oeuvre']);
});

test("tauxTvaLigne : 0 % reste 0 % (autoliquidation), illisible ⇒ 20 %", () => {
  assert.equal(tauxTvaLigne(0), 0);
  assert.equal(tauxTvaLigne("0"), 0);
  assert.equal(tauxTvaLigne("5.5"), 5.5);
  assert.equal(tauxTvaLigne(10), 10);
  assert.equal(tauxTvaLigne(""), 20);
  assert.equal(tauxTvaLigne(null), 20);
  assert.equal(tauxTvaLigne("abc"), 20);
  assert.equal(tauxTvaLigne(-5), 20);
});

test("tvaDuDevis : taux majoritaire des lignes (0 compris), sinon choix fait sur un devis vide, sinon celui de la famille", () => {
  const config = buildDevisConfig({});
  const lignes = [{ line_type: "section_title", tva_rate: 0 }, { tva_rate: 20 }, { tva_rate: 20 }, { tva_rate: 5.5 }];
  assert.equal(tvaDesLignes(lignes), 20);
  assert.equal(tvaDesLignes([{ tva_rate: 0 }]), 0);
  assert.equal(tvaDesLignes([{ line_type: "section_title" }]), null);
  assert.equal(tvaDuDevis({ forcee: 10, lines: [], config, famille: "poele_granules" }), 10, "choix fait avant la première ligne");
  assert.equal(tvaDuDevis({ forcee: 5.5, lines: lignes, config, famille: "poele_granules" }), 20, "choix d'avant le devis type : les lignes chargées font foi");
  assert.equal(tvaDuDevis({ forcee: null, lines: lignes, config, famille: "poele_granules" }), 20, "devis type à 20 % chargé : le sélecteur suit les lignes");
  assert.equal(tvaDuDevis({ forcee: null, lines: [], config, famille: "poele_granules" }), 5.5);
});

test("nouvelleFamille : chapitres typés et TVA posés, la configuration est valide sans autre geste", () => {
  const f = nouvelleFamille(11);
  assert.equal(f.label, "Nouvelle famille 11");
  assert.ok(/^famille_/.test(f.key));
  assert.deepEqual(f.chapitres.map((c) => c.type), ["libre", "main_oeuvre"]);
  assert.deepEqual(f.sections, f.chapitres.map((c) => c.titre));
  assert.equal(f.tva, 10);
  const familles = [...DEFAULT_FAMILLES.map((x) => ({ ...x, chapitres: x.chapitres.map((c) => ({ ...c })) })), f];
  const v = validerDevisConfig({ familles });
  assert.deepEqual(v.erreurs.filter((e) => e.startsWith("Nouvelle famille 11")), []);
});
