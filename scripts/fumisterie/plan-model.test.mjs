// Modèle du plan du conduit annexé au devis (src/lib/fumisterie/planModel.js) : met en forme le métré
// ENREGISTRÉ, ne recalcule rien, n'expose jamais un prix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPlanModel, texteSurPdf } from '../../src/lib/fumisterie/planModel.js';

const lire = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const ancien = lire('./fixtures/metre-g1-ancien.json');
const gabarit = lire('./data/gabarit-g1.json');
const metre = { ...ancien, id: 'm1', created_by: 'u1' };
const configuration = { code: 'CFG-24', titre: 'Créer un conduit intérieur vertical avec la gamme de conduit isolé PTR 30 sur un appareil à bois bûche', gabarit_code: 'G1' };
const company = { name: 'Entreprise Test', address: '1 rue du Four', postalCode: '81000', city: 'Albi', phone: '05 00 00 00 00', email: 'contact@test.fr', rgeCertifications: ['Qualibois'], logoUrl: '' };
const devis = { quote_number: 'DEV-2026-0042', client_display_name: 'Mme Exemple', client_address: '3 chemin des Vignes', client_postal_code: '81600', client_city: 'Gaillac' };
const base = { metre, configuration, gabarit, company, devis, auteurNom: 'Philippe', fournisseurNom: 'MODINOX / ALTEMA' };

test('aucun prix, dans les deux variantes', () => {
  for (const variante of ['offre', 'chantier']) {
    const json = JSON.stringify(buildPlanModel({ ...base, variante }));
    for (const interdit of ['prix', '€', 'vente', 'achat', 'marge']) assert.ok(!json.includes(interdit), `${variante} : « ${interdit} »`);
  }
});

test('référence fournisseur seulement sur la fiche chantier', () => {
  const offre = buildPlanModel({ ...base, variante: 'offre' });
  const chantier = buildPlanModel({ ...base, variante: 'chantier' });
  assert.ok(offre.pieces.lignes.every((l) => !('reference' in l)));
  assert.equal(chantier.pieces.lignes[0].reference, '2PTICHARN180NO');
  assert.equal(offre.chantier, null);
  assert.ok(chantier.chantier);
});

test('liste de pièces : celle du métré, titrée par sa date, quantités formatées', () => {
  const m = buildPlanModel({ ...base, variante: 'offre' });
  assert.equal(m.pieces.titre, 'Pièces selon le métré du 27/11/2026');
  assert.equal(m.pieces.lignes.length, 16);
  assert.deepEqual(m.pieces.lignes.map((l) => l.repere).slice(0, 3), [1, 2, 2]);
  assert.equal(m.pieces.lignes[4].quantite, '3');
  const flex = buildPlanModel({ ...base, variante: 'offre', metre: { ...metre, resultat: { ...metre.resultat, lignes: [{ repere: 3, libelle: 'Flexible', quantite: 6.5, unite: 'ml' }] } } });
  assert.equal(flex.pieces.lignes[0].quantite, '6,5');
});

test('cartouche : entreprise depuis les réglages, client du devis, installation, relevé', () => {
  const m = buildPlanModel({ ...base, variante: 'offre' });
  const c = m.cartouche;
  assert.equal(c.entreprise.nom, 'Entreprise Test');
  assert.ok(c.entreprise.lignes.some((l) => l.includes('81000 Albi')));
  assert.equal(c.entreprise.rge, 'RGE : Qualibois');
  assert.ok(!JSON.stringify(m).includes('Mayer'));
  assert.equal(c.client.nom, 'Mme Exemple');
  assert.deepEqual(c.client.lignes, ['3 chemin des Vignes', '81600 Gaillac']);
  assert.equal(c.devis.mention, 'Annexe au devis N° DEV-2026-0042');
  assert.equal(c.installation.diametre, 'Ø 180');
  assert.equal(c.installation.finition, 'Noir');
  assert.equal(c.installation.gabarit, 'G1');
  assert.equal(c.installation.fabricant, 'MODINOX / ALTEMA');
  assert.equal(c.releve.date, '27/11/2026');
  assert.equal(c.releve.auteur, 'Philippe');
  assert.deepEqual(c.mentions, ['Cotes en m', 'Hors échelle']);
  assert.equal(buildPlanModel({ ...base, variante: 'offre', auteurNom: null }).cartouche.releve.auteur, '—');
});

test('métré ancien : géométrie et relevé ENREGISTRÉS repris tels quels', () => {
  const m = buildPlanModel({ ...base, variante: 'offre' });
  assert.equal(m.geometrie, metre.resultat.geometrie);
  assert.equal(m.releve, metre.releve);
  assert.equal(m.gabaritCode, 'G1');
  assert.equal(m.titre, 'Plan du conduit');
});

test('fiche chantier : relevé saisi (paramètres visibles), alertes acceptées', () => {
  const m = buildPlanModel({ ...base, variante: 'chantier' });
  assert.equal(m.titre, 'Fiche chantier — conduit de fumée');
  const saisi = Object.fromEntries(m.chantier.releveSaisi.map((l) => [l.libelle, l.valeur]));
  assert.equal(saisi['Diamètre conduit'], 'Ø 180');
  assert.equal(saisi['Hauteur de buse'], '1,05 m');
  assert.ok(Object.keys(saisi).length >= 12);
  assert.deepEqual(m.chantier.alertes, []); // ce métré n'avait aucune alerte « à vérifier »
  const avecAlerte = buildPlanModel({ ...base, variante: 'chantier', metre: { ...metre, resultat: { ...metre.resultat, alertes: [
    { niveau: 'warn', code: 'zone1', message: 'Sortie trop basse (toit ≤ 15°) → reprendre' },
    { niveau: 'warn', code: 'article_manquant', message: 'Solin : aucun article' },
    { niveau: 'info', code: 'x', message: 'info' },
  ] } } });
  assert.deepEqual(avecAlerte.chantier.alertes, ['Sortie trop basse (toit au plus 15°) - reprendre']);
});

test('texteSurPdf : rien hors cp1252', () => {
  assert.equal(texteSurPdf('Pente ≤ 15° → ✓ ok'), 'Pente au plus 15° - ok');
  assert.equal(texteSurPdf('≥ 1 m'), 'au moins 1 m');
  assert.equal(texteSurPdf('Ø 150 — « noir »'), 'Ø 150 — « noir »');
  assert.equal(texteSurPdf(null), '');
});
