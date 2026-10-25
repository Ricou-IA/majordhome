// scripts/catalogue/offre-fournisseur.test.mjs
// Import d'une offre fournisseur (src/lib/catalogue/offreFournisseur.js + offreRapprochement.js) — modules PURS.
// Fixture : l'offre TEREVA n° 0036 du 19/10/2026 (17 lignes, 8 005,15 € HT éco-participations incluses), transcrite
// au format demandé à l'IA (scripts/catalogue/data/offres/tereva-0036-2026-10.json).
// Run : node --test scripts/catalogue/offre-fournisseur.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SCHEMA_OFFRE, construirePromptOffre, nombreFr, dateIso, lireOffre, controlerOffre, uniteDepuisOffre,
  lignesCatalogueDepuisOffre, versionOffre, montantLigne,
} from '../../src/lib/catalogue/offreFournisseur.js';
import {
  fournisseurDeLOffre, rapprocherLigne, choixParDefaut, actionCatalogue, ligneDevisDepuisOffre, insererLignesOffre, planCatalogueDevis,
} from '../../src/lib/catalogue/offreRapprochement.js';

const brut = JSON.parse(readFileSync(new URL('./data/offres/tereva-0036-2026-10.json', import.meta.url), 'utf8'));
const offre = lireOffre(brut);

test('schéma strict : objets fermés, tous les champs requis', () => {
  const verifier = (s, chemin) => {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false, `${chemin} additionalProperties`);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), `${chemin} required`);
      for (const [k, v] of Object.entries(s.properties)) verifier(v, `${chemin}.${k}`);
    }
    if (s.type === 'array') verifier(s.items, `${chemin}[]`);
  };
  verifier(SCHEMA_OFFRE, 'offre');
  // aucun type union : l'API refuse plus de 16 paramètres « valeur ou null » (400 vécu le 2026-10-25 avec 19)
  const texteSchema = JSON.stringify(SCHEMA_OFFRE);
  assert.ok(!texteSchema.includes('anyOf') && !texteSchema.includes('"null"') && !/"type":\[/.test(texteSchema));
  assert.match(construirePromptOffre(), /HORS éco-participation/);
});

test('nombreFr / dateIso : formats français', () => {
  assert.equal(nombreFr('2 093,03'), 2093.03);
  assert.equal(nombreFr('2 093,03'), 2093.03); // espace fine insécable de toLocaleString('fr-FR')
  assert.equal(nombreFr('1.234,5 €'), 1234.5);
  assert.equal(nombreFr('12,5 %'), 12.5);
  assert.equal(nombreFr(10.49), 10.49);
  assert.equal(nombreFr('abc'), null);
  assert.equal(nombreFr(''), null);
  assert.equal(dateIso('19/10/2026'), '2026-10-19');
  assert.equal(dateIso('2026-10-31'), '2026-10-31');
  assert.equal(dateIso('31/02/2026'), null);
  assert.equal(dateIso(null), null);
});

test('lecture de l\'offre TEREVA 0036 : 17 lignes, en-tête, éco-participations', () => {
  assert.equal(offre.erreur, undefined);
  assert.equal(offre.fournisseur.nom, 'TEREVA');
  assert.equal(offre.numero, '0036');
  assert.equal(offre.date, '2026-10-19');
  assert.equal(offre.validite, '2026-10-31');
  assert.equal(offre.lignes.length, 17);
  const tube = offre.lignes.find((l) => l.code === '3384677');
  assert.equal(tube.quantite, 20);
  assert.equal(montantLigne(tube), 209.8);
  assert.equal(offre.lignes.filter((l) => l.nature === 'main').length, 3);
});

test('contrôles : la somme des lignes + éco-participations retombe sur le total imprimé', () => {
  const c = controlerOffre(offre);
  assert.equal(c.somme_lignes, 7970.19);
  assert.equal(c.total_verifie, true);
  assert.deepEqual(c.alertes.map((a) => a.code), []);
});

test('contrôles : total vérifié par les éco-participations des lignes quand l\'IA n\'a lu que la DEEE (lecture réelle 2026-10-25)', () => {
  const c = controlerOffre({ ...offre, eco_total: 34.26 });
  assert.equal(c.total_verifie, true);
  assert.deepEqual(c.alertes.map((a) => a.code), []);
});

test('contrôles : une ligne oubliée ou un montant mal lu se voit', () => {
  const sansLigne = { ...offre, lignes: offre.lignes.slice(1) };
  assert.ok(controlerOffre(sansLigne).alertes.some((a) => a.code === 'total_incoherent'));
  const malLu = { ...offre, lignes: offre.lignes.map((l) => (l.code === '3518453' ? { ...l, montant_ht: 163.5 } : l)) };
  const codes = controlerOffre(malLu).alertes.map((a) => a.code);
  assert.ok(codes.includes('montant_incoherent'));
  assert.ok(codes.includes('total_incoherent'));
  const vide = controlerOffre(lireOffre({ lignes: [] }));
  assert.ok(vide.alertes.some((a) => a.code === 'aucune_ligne' && a.bloquante));
});

test('lecture tolérante : texte avec bloc json, nombres en texte, ligne sans libellé, réponse illisible', () => {
  const texte = 'Voici :\n```json\n{"fournisseur":"ACME","numero":"12","date":"19/10/26","lignes":[{"designation":"Vanne 1/2","code":"V12","quantite":"2","prix_unitaire_net":"6,04","montant_ht":"12,08","nature":"autre"},{"designation":"  "}],"total_ht":"12,08"}\n```';
  const o = lireOffre(texte);
  assert.equal(o.fournisseur.nom, 'ACME');
  assert.equal(o.date, '2026-10-19');
  assert.equal(o.lignes.length, 1);
  assert.equal(o.ignorees, 1);
  assert.equal(o.lignes[0].prix_unitaire_net, 6.04);
  assert.equal(o.lignes[0].nature, 'accessory');
  assert.equal(controlerOffre(o).total_verifie, true);
  assert.equal(lireOffre('pas de json').erreur, 'reponse_illisible');
});

test('lecture au format strict : "" et 0 valent « absent », quantité et prix nuls signalés', () => {
  const o = lireOffre({
    fournisseur: { nom: 'TEREVA', siret: '' }, numero: '0036', date: '2026-10-19', validite: '', total_ht: 0, eco_total: 0, remarque: '',
    lignes: [
      { rang: '001', code: '4514850', ref_fabricant: '', designation: 'UE', marque: '', quantite: 1, unite: 'PIECE', prix_unitaire_net: 2093.03, prix_brut: 0, remise_pct: 0, montant_ht: 2093.03, eco_participation_unitaire: 0, nature: 'main' },
      { rang: '002', code: 'X', ref_fabricant: '', designation: 'Sans prix', marque: '', quantite: 0, unite: '', prix_unitaire_net: 0, prix_brut: 0, remise_pct: 0, montant_ht: 0, eco_participation_unitaire: 0, nature: 'accessory' },
    ],
  });
  assert.deepEqual([o.fournisseur.siret, o.validite, o.total_ht, o.eco_total, o.remarque], [null, null, null, null, null]);
  const [ue] = o.lignes;
  assert.deepEqual([ue.ref_fabricant, ue.marque, ue.prix_brut, ue.remise_pct, ue.eco_participation_unitaire], [null, null, null, null, null]);
  const codes = controlerOffre(o).alertes.map((a) => a.code);
  assert.ok(codes.includes('prix_absent') && codes.includes('quantite_absente') && codes.includes('total_absent'));
});

test('unités : mètre, lot, pièce par défaut', () => {
  assert.equal(uniteDepuisOffre('METRE'), 'ml');
  assert.equal(uniteDepuisOffre('METRE(S)'), 'ml');
  assert.equal(uniteDepuisOffre('LOT DE 2 PIECES'), 'lot');
  assert.equal(uniteDepuisOffre('PIECE'), 'pièce');
  assert.equal(uniteDepuisOffre('m²'), 'm²');
  assert.equal(uniteDepuisOffre(null), 'pièce');
});

test('lignes catalogue : contrat de supplier_catalog_upsert, prix net hors éco, rien sur le prix de vente', () => {
  const version = versionOffre(offre, 'TEREVA');
  assert.equal(version, 'offre_tereva_0036_2026-10-19');
  const { lignes, ecartees } = lignesCatalogueDepuisOffre(offre, offre.lignes, { version });
  assert.equal(lignes.length, 17);
  assert.deepEqual(ecartees, []);
  const ue = lignes.find((l) => l.reference === '4514850');
  assert.equal(ue.purchase_price_ht, 2093.03);
  assert.equal(ue.purchase_price_at, '2026-10-19');
  assert.equal(ue.selling_price_ht_defaut, 0);
  assert.equal(ue.product_kind, 'main');
  assert.equal(ue.brand, 'Daikin');
  assert.equal(ue.model_key, 'ERRA08EV37');
  assert.equal(ue.specs.source_version, version);
  assert.equal(ue.specs.canonical.ref_fabricant, 'ERRA08EV37');
  assert.equal(ue.specs.canonical.eco_participation_unitaire, 7.67);
  assert.equal(ue.specs.canonical.derniere_offre.numero, '0036');
  assert.equal(ue.specs.canonical.source, undefined, 'ne remplace pas la source des factures');
  assert.equal(lignes.find((l) => l.reference === '3384677').unit, 'ml');
  // EAN seul (Bolly) : pas de clé modèle
  assert.equal(lignes.find((l) => l.reference === '4039288').model_key, null);
  // somme des prix × quantités = somme des lignes
  const somme = offre.lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_net, 0);
  assert.equal(Math.round(somme * 100) / 100, 7970.19);
});

test('lignes catalogue : sans référence, sans prix, en double ⇒ écartées et rapportées', () => {
  const lignesBrutes = [
    { designation: 'Sans ref', prix_unitaire_net: 10 },
    { designation: 'Offert', code: 'X1', prix_unitaire_net: 0 },
    { designation: 'A', code: 'D1', prix_unitaire_net: 5 },
    { designation: 'A bis', code: 'D1', prix_unitaire_net: 6 },
    { designation: 'Ref fab seule', ref_fabricant: 'ABC123', prix_unitaire_net: '4,5', prix_brut: 9 },
  ];
  const { lignes, ecartees } = lignesCatalogueDepuisOffre({ numero: '1', date: '2026-10-01' }, lignesBrutes, { version: 'v' });
  assert.deepEqual(lignes.map((l) => l.reference), ['D1', 'ABC123']);
  assert.equal(lignes[0].purchase_price_ht, 5);
  assert.equal(lignes[1].tarif_public, 9);
  assert.equal(lignes[1].taux_remise, 50);
  assert.equal(ecartees.length, 3);
  assert.throws(() => lignesCatalogueDepuisOffre({}, [], {}), /version/);
});

test('fournisseur de l\'offre : nom exact, contenu, ambigu ⇒ null', () => {
  const f = [{ id: '1', name: 'TEREVA' }, { id: '2', name: 'SODITELEM' }, { id: '3', name: 'MODINOX / ALTEMA' }, { id: '4', name: 'Vieux', is_active: false }];
  assert.equal(fournisseurDeLOffre('TEREVA', f)?.id, '1');
  assert.equal(fournisseurDeLOffre('Agence TEREVA - ALBI', f)?.id, '1');
  assert.equal(fournisseurDeLOffre('Altema', f)?.id, '3');
  assert.equal(fournisseurDeLOffre('Inconnu SA', f), null);
  assert.equal(fournisseurDeLOffre('Vieux', f), null);
  assert.equal(fournisseurDeLOffre('', f), null);
});

const articleFiltre = { id: 'art-filtre', name: 'FILTRE MAGNETIQUE + VBS 26X34', brand: null, model_key: null, product_kind: 'accessory', selling_price_ht: 140, meilleur_prix_achat: 85.53, unit: 'pièce' };
const articleUE = { id: 'art-ue', name: 'Daikin Altherma 3 R MT unité extérieure 8 kW', brand: 'DAIKIN', model_key: 'ERRA08EV37', product_kind: 'main', selling_price_ht: 3200, meilleur_prix_achat: 2150, unit: 'pièce' };
const articleVoisin = { id: 'art-voisin', name: 'Daikin Altherma 3 R unité extérieure 6 kW', brand: 'DAIKIN', model_key: 'ERRA06EV37', product_kind: 'main', selling_price_ht: 2900, meilleur_prix_achat: 1900, unit: 'pièce' };
const ligneDe = (code) => offre.lignes.find((l) => l.code === code);

test('rapprochement : même référence chez ce fournisseur ⇒ son article', () => {
  const r = rapprocherLigne(ligneDe('4409779'), {
    produits: [{ id: 'p1', reference: '4409779', catalog_item_id: 'art-filtre' }],
    candidats: [{ article: articleFiltre }], articlesParId: new Map([['art-filtre', articleFiltre]]),
  });
  assert.equal(r.statut, 'meme_reference');
  assert.equal(r.article.id, 'art-filtre');
  assert.equal(r.produit.id, 'p1');
  assert.deepEqual(choixParDefaut(r, { peutCreer: true }), { type: 'article', itemId: 'art-filtre' });
});

test('rapprochement : même référence fabricant chez un autre fournisseur ⇒ suggestion forte, le voisin reste en suggestion', () => {
  const r = rapprocherLigne(ligneDe('4514850'), {
    produits: [], candidats: [{ article: articleVoisin }, { article: articleUE, references: ['ERRA08EV37'] }],
  });
  assert.equal(r.statut, 'reference_fabricant');
  assert.equal(r.article.id, 'art-ue');
  assert.ok(r.suggestions.every((s) => s.article.id !== 'art-ue'));
});

test('rapprochement : rien de sûr ⇒ à créer (admin) ou ligne libre', () => {
  const r = rapprocherLigne(ligneDe('4039288'), { produits: [], candidats: [{ article: articleUE }] });
  assert.equal(r.statut, 'a_creer');
  assert.equal(r.article, null);
  assert.deepEqual(choixParDefaut(r, { peutCreer: true }), { type: 'creer' });
  assert.deepEqual(choixParDefaut(r, { peutCreer: false }), { type: 'libre' });
});

test('rapprochement : un prix au mètre ne pénalise pas l\'article vendu à la couronne (cas réel du bi-tube, prod 2026-10-25)', () => {
  const couronne = (id, dims) => ({ id, name: `Liaison cuivre bi-tube isolée blanche M1 ${dims}, 0,8 mm, couronne 20 m`, brand: null, model_key: null, product_kind: 'main', selling_price_ht: 0, meilleur_prix_achat: 160 });
  const r = rapprocherLigne(ligneDe('3384677'), { produits: [], candidats: [{ article: couronne('a', '1/4-3/8') }, { article: couronne('b', '1/4-5/8') }] });
  assert.equal(r.statut, 'a_creer');
  assert.equal(r.suggestions[0]?.article.id, 'b');
  assert.deepEqual(choixParDefaut(r, { peutCreer: true }), { type: 'creer' }, 'une suggestion n\'est jamais choisie d\'office');
});

test('action catalogue : création, mise à jour, identique, prix connu plus récent', () => {
  const l = ligneDe('4409779');
  assert.equal(actionCatalogue(l, null, '2026-10-19').action, 'creer');
  const maj = actionCatalogue(l, { purchase_price_ht: '85.53', purchase_price_at: '2026-09-02T00:00:00Z' }, '2026-10-19');
  assert.deepEqual([maj.action, maj.coche, maj.ancien, maj.nouveau], ['maj', true, 85.53, 88.9]);
  const recent = actionCatalogue(l, { purchase_price_ht: 85.53, purchase_price_at: '2026-10-24' }, '2026-10-19');
  assert.equal(recent.coche, false);
  assert.match(recent.avertissement, /24\/10\/2026/);
  assert.equal(actionCatalogue(l, { purchase_price_ht: 88.9 }, '2026-10-19').action, 'identique');
});

test('devis → catalogue : le prix d\'achat de l\'offre est enregistré, l\'article choisi gagne l\'offre (retour Eric 2026-10-25)', () => {
  const rows = [
    // reconnue chez le fournisseur, prix changé : écrite, pas rattachée (déjà sur son article)
    { ligne: ligneDe('4409779'), rap: { statut: 'meme_reference', produit: { id: 'p1', purchase_price_ht: 85.53, purchase_price_at: '2026-09-02' }, article: articleFiltre, suggestions: [] }, choix: { type: 'article', itemId: 'art-filtre' }, nature: 'accessory' },
    // même référence fabricant ailleurs : écrite chez ce fournisseur puis rattachée à l'article choisi
    { ligne: ligneDe('4514850'), rap: { statut: 'reference_fabricant', produit: null, article: articleUE, suggestions: [] }, choix: { type: 'article', itemId: 'art-ue' }, nature: 'main' },
    // à créer : écrite, l'article est posé par la base
    { ligne: ligneDe('4039288'), rap: { statut: 'a_creer', produit: null, article: null, suggestions: [] }, choix: { type: 'creer' }, nature: 'main' },
    // ligne libre : hors catalogue
    { ligne: ligneDe('3384677'), rap: { statut: 'a_creer', produit: null, article: null, suggestions: [] }, choix: { type: 'libre' }, nature: 'accessory' },
    // prix connu plus récent que l'offre : pas remplacé
    { ligne: ligneDe('074247F'), rap: { statut: 'meme_reference', produit: { id: 'p2', purchase_price_ht: 14.28, purchase_price_at: '2026-10-24' }, article: null, suggestions: [] }, choix: { type: 'creer' }, nature: 'accessory' },
    // prix identique : rien à écrire
    { ligne: ligneDe('3518453'), rap: { statut: 'meme_reference', produit: { id: 'p3', purchase_price_ht: 163.5 }, article: null, suggestions: [] }, choix: { type: 'creer' }, nature: 'accessory' },
  ];
  const plan = planCatalogueDevis(rows, '2026-10-19');
  assert.deepEqual(plan.aEcrire.map((e) => e.ligne.code), ['4409779', '4514850', '4039288']);
  assert.deepEqual(plan.aRattacher, [{ reference: '4514850', itemId: 'art-ue' }]);
  assert.deepEqual(plan.ignorees.map((i) => [i.ligne.code, i.raison.split(' ')[0]]), [['3384677', 'ligne'], ['074247F', 'prix'], ['3518453', 'prix']]);
});

test('ligne de devis : prix d\'achat de l\'offre, vente de l\'article, libre sans article', () => {
  const avec = ligneDevisDepuisOffre(ligneDe('4409779'), { article: articleFiltre, produit: { id: 'p1' }, fournisseur: { id: 's1', name: 'TEREVA' }, tva: 5.5 });
  assert.equal(avec.catalog_item_id, 'art-filtre');
  assert.equal(avec.is_freeform, false);
  assert.equal(avec.purchase_price_ht, 88.9);
  assert.equal(avec.unit_price_ht, 140);
  assert.equal(avec.designation, 'FILTRE MAGNETIQUE + VBS 26X34');
  assert.equal(avec.supplier_product_id, 'p1');
  assert.equal(avec.tva_rate, 5.5);
  const libre = ligneDevisDepuisOffre(ligneDe('3384677'), { tva: 10 });
  assert.equal(libre.is_freeform, true);
  assert.equal(libre.catalog_item_id, null);
  assert.equal(libre.quantity, 20);
  assert.equal(libre.unit, 'ml');
  assert.equal(libre.unit_price_ht, 0);
  assert.equal(libre.reference, '3384677');
});

test('chapitres : équipements dans ÉQUIPEMENT, accessoires dans OPTIONS, ordre de l\'offre, lignes existantes intactes', () => {
  const typeDe = (t) => ({ 'POMPE A CHALEUR': 'equipement', ACCESSOIRES: 'option', 'MAIN D\'OEUVRE': 'main_oeuvre' }[t] || 'libre');
  const existantes = [
    { line_type: 'section_title', designation: 'POMPE A CHALEUR' },
    { line_type: 'product', designation: 'déjà là' },
    { line_type: 'section_title', designation: 'ACCESSOIRES' },
    { line_type: 'section_title', designation: 'MAIN D\'OEUVRE' },
    { line_type: 'labor', designation: 'Pose' },
  ];
  const nouvelles = [
    { line: { designation: 'UE' }, nature: 'main' },
    { line: { designation: 'Filtre' }, nature: 'accessory' },
    { line: { designation: 'UI' }, nature: 'main' },
    { line: { designation: 'Tube' }, nature: 'consumable' },
  ];
  const r = insererLignesOffre(existantes, nouvelles, { typeDe, titreSecours: 'FOURNITURES TEREVA' });
  assert.deepEqual(r.map((l) => l.designation), ['POMPE A CHALEUR', 'déjà là', 'UE', 'UI', 'ACCESSOIRES', 'Filtre', 'Tube', 'MAIN D\'OEUVRE', 'Pose']);
});

test('chapitres : sans chapitre acceptable ⇒ un chapitre de secours en fin de devis', () => {
  const typeDe = () => 'main_oeuvre';
  const r = insererLignesOffre([{ line_type: 'section_title', designation: 'MO' }], [{ line: { designation: 'UE' }, nature: 'main' }], { typeDe, titreSecours: 'FOURNITURES TEREVA' });
  assert.deepEqual(r.map((l) => l.designation), ['MO', 'FOURNITURES TEREVA', 'UE']);
  assert.equal(r[1].line_type, 'section_title');
  const vide = insererLignesOffre([], [{ line: { designation: 'UE' }, nature: 'main' }], { typeDe, titreSecours: 'FOURNITURES' });
  assert.deepEqual(vide.map((l) => l.designation), ['FOURNITURES', 'UE']);
});
