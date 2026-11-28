// Préparation de l'envoi (aperçu = envoi) — scripts/import-articles/envoi.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { classerArticles, controlerArticle, bilan } from '../../src/lib/importArticles/controles.js';
import { rapprocherFournisseurs } from '../../src/lib/importArticles/fournisseurs.js';
import { verifierLigneArticle } from '../../src/lib/importArticles/lots.js';
import { NATURE_ECARTER } from '../../src/lib/importArticles/valeurs.js';
import {
  idProvisoire, resolusPrevus, resolusApresOuverture, preparerEcriture, raisonRefus, resumeCorrections,
  resumeSansLigne, optionsDuChamp, tableDesValeurs, appliquerUniteCategorie,
} from '../../src/lib/importArticles/envoi.js';

const MAINTENANT = new Date(2026, 10, 28);
const vide = { articles: [], lignes: [] };
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const ligne = (numero, designation, fournisseur, ref, achat = '10') => ({
  numero, valeurs: { designation, fournisseur, ref_fournisseur: ref, prix_achat: achat },
});
const classer = (candidats, resolus = {}) => classerArticles(candidats, vide, { avecFournisseur: true, maintenant: MAINTENANT, fournisseursResolus: resolus });
const avecFournisseur = (lignes) => lignes.filter((l) => l.fournisseur).length;

test('idProvisoire : UUID valide, distinct par fournisseur', () => {
  const ids = [0, 1, 2, 41].map(idProvisoire);
  assert.equal(new Set(ids).size, 4);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});

test('deux nouveaux fournisseurs, même référence : aperçu = envoi', () => {
  const candidats = [ligne(2, 'Tube A', 'Alpha', '1001'), ligne(3, 'Tube B', 'Beta', '1001')];
  const rap = rapprocherFournisseurs(['Alpha', 'Beta'], []);
  assert.deepEqual(rap.map((r) => r.aCreer), [true, true]);
  const classees = classer(candidats);
  const apercu = preparerEcriture(classees, {}, resolusPrevus(rap, {}));
  assert.equal(apercu.lignes.length, 2);
  assert.equal(avecFournisseur(apercu.lignes), 2, 'chaque fournisseur garde sa ligne à l\'aperçu');
  assert.notEqual(apercu.lignes[0].fournisseur.supplier_id, apercu.lignes[1].fournisseur.supplier_id);
  assert.deepEqual(resumeSansLigne(apercu.classeesFinales, {}, apercu.lignes).non_creee, 0);

  const rendus = [{ nom: 'Alpha', supplier_id: UUID_A, cree: true }, { nom: 'Beta', supplier_id: UUID_B, cree: true }];
  const envoi = preparerEcriture(classees, {}, resolusApresOuverture(rap, rendus, {}));
  assert.equal(envoi.lignes.length, apercu.lignes.length);
  assert.equal(avecFournisseur(envoi.lignes), avecFournisseur(apercu.lignes));
  assert.deepEqual(envoi.lignes.map((l) => l.fournisseur.supplier_id), [UUID_A, UUID_B]);
});

test('resolusPrevus : existants gardés, seuls les fournisseurs à créer reçoivent un provisoire', () => {
  const r = resolusPrevus([{ cle: 'baywa', aCreer: false }, { cle: 'a', aCreer: true }, { cle: 'b', aCreer: true }], { baywa: UUID_A });
  assert.deepEqual(r, { baywa: UUID_A, a: idProvisoire(0), b: idProvisoire(1) });
});

test('resolusApresOuverture : refuse un nombre, un nom ou un identifiant différent', () => {
  const aEnvoyer = [{ cle: 'alpha', nom: 'Alpha' }, { cle: 'beta', nom: 'Beta' }];
  const bons = [{ nom: 'Alpha', supplier_id: UUID_A }, { nom: 'Beta', supplier_id: UUID_B }];
  assert.deepEqual(resolusApresOuverture(aEnvoyer, bons, { x: 'y' }), { x: 'y', alpha: UUID_A, beta: UUID_B });
  assert.throws(() => resolusApresOuverture(aEnvoyer, bons.slice(0, 1), {}), /tous les fournisseurs/);
  assert.throws(() => resolusApresOuverture(aEnvoyer, [bons[1], bons[0]], {}), /tous les fournisseurs/);
  assert.throws(() => resolusApresOuverture(aEnvoyer, [bons[0], { nom: 'Beta', supplier_id: null }], {}), /tous les fournisseurs/);
  assert.throws(() => resolusApresOuverture(aEnvoyer, null, {}), /tous les fournisseurs/);
});

test('une ligne refusée ne prend pas la place (fournisseur + référence) d\'une ligne valide', () => {
  // Même fournisseur + référence : la ligne 3 est un doublon du fichier, reprise à la main. La ligne 2 est rendue
  // invalide (nature hors liste) : elle ne doit pas garder la ligne fournisseur qui revient à la ligne 3.
  const candidats = [ligne(2, 'Tube A', 'Alpha', '1001'), ligne(3, 'Tube A bis', 'Alpha', '1001')];
  const classees = classer(candidats, { alpha: UUID_A });
  const choix = { 3: true };
  const piegees = classees.map((c) => (c.numero === 2 ? { ...c, fiche: { ...c.fiche, product_kind: 'inconnue' } } : c));
  const { classeesFinales, lignes } = preparerEcriture(piegees, choix, { alpha: UUID_A });
  assert.deepEqual(lignes.map((l) => l.import_line), [3]);
  assert.equal(lignes[0].fournisseur?.supplier_id, UUID_A, 'la ligne valide reprend la ligne fournisseur');
  const refusee = classeesFinales.find((c) => c.numero === 2);
  assert.equal(refusee.fiche, null);
  assert.equal(refusee.raison, raisonRefus('product_kind'));
  for (const l of lignes) assert.equal(verifierLigneArticle(l), null);
  const b = bilan(classeesFinales, choix);
  assert.equal(b.lues, b.importees + b.doublons + b.ecartees);
});

test('raisonRefus : libellé du champ', () => {
  assert.equal(raisonRefus('default_tva_rate'), 'Valeur « Taux de TVA » refusée au contrôle avant envoi');
  assert.match(raisonRefus('fournisseur'), /Ligne fournisseur/);
});

test('défaut choisi explicitement : reconnu, jamais compté corrigé', () => {
  const nature = optionsDuChamp('nature', [{ value: 'main', label: 'Équipement' }, { value: 'main_oeuvre', label: 'Main d’œuvre' }]);
  assert.deepEqual(nature.find((o) => o.value === 'main'), { value: 'main', label: 'Équipement (par défaut)' });
  assert.equal(nature.find((o) => o.value === '').disabled, true);
  assert.ok(nature.some((o) => o.value === NATURE_ECARTER));
  const unite = optionsDuChamp('unite', [{ value: 'pièce', label: 'Pièce' }, { value: 'ml', label: 'Mètre linéaire' }]);
  assert.equal(unite.find((o) => o.value === 'pièce').label, 'Pièce (par défaut)');
  assert.equal(unite.find((o) => o.value === '').disabled, true);
  assert.equal(optionsDuChamp('categorie', [])[0].value, '');

  const { table, explicites } = tableDesValeurs(['Truc', 'Zut', 'Fourniture'], { Truc: '', Zut: '', Fourniture: 'main' }, { Truc: 'main' });
  assert.deepEqual(table, { Truc: 'main', Zut: '', Fourniture: 'main' });
  assert.deepEqual([...explicites], ['Truc']);
  const unites = tableDesValeurs(['Zut'], { Zut: '' }, { Zut: 'pièce' }).table;
  const r = controlerArticle({ designation: 'X', nature: 'Truc', unite: 'Zut' }, { valeursInterpretees: { nature: table, unite: unites }, maintenant: MAINTENANT });
  assert.deepEqual(r.corrections, []);
  assert.equal(r.fiche.product_kind, 'main');
  assert.equal(r.fiche.unit, 'pièce');
  const nonChoisie = controlerArticle({ designation: 'X', nature: 'Zut' }, { valeursInterpretees: { nature: table }, maintenant: MAINTENANT });
  assert.deepEqual(nonChoisie.corrections, ['nature']);
});

test('resumeCorrections et resumeSansLigne : sur les lignes importées seulement', () => {
  const candidats = [
    { numero: 2, valeurs: { designation: 'A', tva: '33' } },
    { numero: 3, valeurs: { designation: 'B', fournisseur: 'Alpha', ref_fournisseur: 'R', prix_achat: '' } },
    { numero: 4, valeurs: { designation: 'C', fournisseur: 'Beta', ref_fournisseur: 'R', prix_achat: '5' } },
  ];
  const classees = classer(candidats);
  const { classeesFinales, lignes } = preparerEcriture(classees, {}, {});
  assert.deepEqual(resumeCorrections(classeesFinales, {}), [{ cle: 'tva', nombre: 1 }]);
  const s = resumeSansLigne(classeesFinales, {}, lignes);
  assert.equal(s.sans_prix, 1);
  assert.equal(s.non_creee, 1, 'Beta non résolu (décoché) : article sans ligne fournisseur');
});

test('appliquerUniteCategorie : même résultat que le classement complet', () => {
  const interp = {
    nature: { Fourniture: 'main', MO: 'main_oeuvre' },
    unite: { u: 'pièce', ml: 'ml', Zut: '' },
    categorie: { Poêle: 'poele', Zzz: '' },
  };
  const candidats = [
    { numero: 2, valeurs: { designation: 'A', nature: 'Fourniture', unite: 'ml', categorie: 'Poêle', tva: '33' } },
    { numero: 3, valeurs: { designation: 'B', nature: 'MO', unite: 'Zut', categorie: 'Zzz' } },
    { numero: 4, valeurs: { designation: 'C', unite: 'u' } },
    { numero: 5, valeurs: { designation: '' } },
    { numero: 6, valeurs: { designation: 'A', nature: 'Fourniture', unite: 'u' } },
  ];
  const opts = { avecFournisseur: false, maintenant: MAINTENANT };
  const complet = classerArticles(candidats, vide, { ...opts, valeursInterpretees: interp });
  const partiel = classerArticles(candidats, vide, { ...opts, valeursInterpretees: { nature: interp.nature } });
  const refait = appliquerUniteCategorie(partiel, candidats, { unite: interp.unite, categorie: interp.categorie });
  const forme = (l) => l.map((c) => ({ ...c, corrections: [...c.corrections].sort() }));
  assert.deepEqual(forme(refait), forme(complet));
});
