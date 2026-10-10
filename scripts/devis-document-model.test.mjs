// scripts/devis-document-model.test.mjs
// Tests du paramétrage des devis (src/lib/devisConfig.js) et du modèle de document (src/lib/devisDocumentModel.js).
// Run : node --test scripts/devis-document-model.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS_DEVIS, DEFAULT_FAMILLES, DEFAULT_CONDITIONS, buildDevisConfig, famillesActives, familleDe, sectionsParDefaut,
  categoriePourSection, validerDevisConfig, slugFamille,
} from '../src/lib/devisConfig.js';
import { buildDevisDocumentModel, exempleDevis, chapitres, fmtDateLongue, fmtQte, fmtTaux, ZONES } from '../src/lib/devisDocumentModel.js';

const company = { name: 'Chauffage Test', address: '1 rue du Four', postalCode: '81000', city: 'Albi', phone: '05 00 00 00 00', email: 'contact@test.fr', siret: '123', tvaIntra: 'FR00', logoUrl: 'https://x/logo.png', accentColor: '#112233', rgeCertifications: [] };
const lines = [
  { line_type: 'section_title', designation: 'POÊLE' },
  { line_type: 'product', designation: 'Poêle X', reference: 'PX', quantity: 1, unit_price_ht: 2500, tva_rate: 5.5, total_ht: 2500 },
  { line_type: 'section_title', designation: 'MAIN D\'ŒUVRE' },
  { line_type: 'labor', designation: 'Pose', quantity: 1.5, unit_price_ht: 100, tva_rate: 10 },
];
const totals = { subtotal_ht: 2650, discount_amount: 0, total_ht: 2650, tva_breakdown: [{ rate: 5.5, tva_amount: 137.5 }, { rate: 10, tva_amount: 15 }], total_ttc: 2802.5 };
const quote = { quote_number: 'DEV-1', created_at: '2026-10-06T10:00:00Z', validity_date: '2026-11-05T10:00:00Z', subject: 'Poêle', client_display_name: 'Marie Curie', client_postal_code: '81600', client_city: 'Gaillac', global_discount_percent: 0 };

test('buildDevisConfig : défauts = comportement historique', () => {
  const c = buildDevisConfig(null);
  assert.deepEqual(c.familles.map((f) => f.label), DEFAULT_FAMILLES.map((f) => f.label));
  assert.deepEqual(sectionsParDefaut(c, 'Climatisation'), ['ÉQUIPEMENT', 'ACCESSOIRES', 'MAIN D\'ŒUVRE']);
  assert.equal(c.document.conditions, DEFAULT_CONDITIONS);
  assert.equal(c.document.validite_jours, 30);
  assert.equal(c.paiement.afficher, false);
  assert.equal(c.affichage.detail_lignes, true);
});

test('buildDevisConfig : surcharge org, familles invalides ignorées, clés dédoublonnées, validité bornée', () => {
  const c = buildDevisConfig({ devis: {
    familles: [{ label: 'Pompe à chaleur', categorie: 'chauffage', sections: ['PAC', ' ', 'POSE'] }, { key: 'x', label: '' }, { key: 'pompe_a_chaleur', label: 'Doublon', sections: ['A'] }, 'n importe quoi'],
    document: { titre: ' ', validite_jours: 999, intro: 'Bonjour' },
    affichage: { references: false },
  } });
  assert.equal(c.familles.length, 1);
  assert.deepEqual(c.familles[0], { key: 'pompe_a_chaleur', label: 'Pompe à chaleur', actif: true, categorie: 'chauffage', sections: ['PAC', 'POSE'] });
  assert.equal(c.document.titre, 'DEVIS');
  assert.equal(c.document.validite_jours, 30);
  assert.equal(c.document.intro, 'Bonjour');
  assert.equal(c.affichage.references, false);
  assert.equal(c.affichage.logo, true);
  assert.equal(slugFamille('Poêle à Granulé'), 'poele_a_granule');
});

test('familleDe / famillesActives / categoriePourSection', () => {
  const c = buildDevisConfig({ devis: { familles: [{ key: 'clim', label: 'Climatisation', categorie: 'climatisation', sections: ['ÉQUIPEMENT'] }, { key: 'vieux', label: 'Ancien', actif: false, sections: ['X'] }] } });
  assert.equal(familleDe(c, 'clim').label, 'Climatisation');
  assert.equal(familleDe(c, 'Climatisation').key, 'clim');
  assert.equal(familleDe(c, 'inconnue'), null);
  assert.deepEqual(famillesActives(c).map((f) => f.key), ['clim']);
  assert.equal(categoriePourSection(c, 'ÉQUIPEMENT', 'Climatisation'), 'climatisation');
  assert.equal(categoriePourSection(c, 'FUMISTERIE', 'Climatisation'), 'fumisterie');
  assert.equal(categoriePourSection(c, 'POÊLE', null), 'poele');
  assert.equal(categoriePourSection(buildDevisConfig(null), 'MATÉRIEL', 'Electricité'), null);
});

test('validerDevisConfig nomme chaque défaut', () => {
  const ok = validerDevisConfig(buildDevisConfig(null));
  assert.equal(ok.ok, true);
  const ko = validerDevisConfig({ familles: [{ key: 'a', label: 'A', actif: true, sections: [] }, { key: 'a', label: 'B', actif: true, sections: ['X'], categorie: 'bidule' }], document: { titre: '', validite_jours: 0 } });
  assert.equal(ko.ok, false);
  assert.ok(ko.erreurs.some((e) => e.includes('A : au moins un chapitre')));
  assert.ok(ko.erreurs.some((e) => e.includes('B : clé en double')));
  assert.ok(ko.erreurs.some((e) => e.includes('B : catégorie produit inconnue')));
  assert.ok(ko.erreurs.some((e) => e.includes('validité')));
  assert.ok(ko.erreurs.some((e) => e.includes('titre')));
});

test('formatters PDF-safe', () => {
  assert.equal(fmtDateLongue('2026-10-06T10:00:00Z'), '6 octobre 2026');
  assert.equal(fmtDateLongue(null), '');
  assert.equal(fmtQte(1.5), '1,50');
  assert.equal(fmtQte(2), '2');
  assert.equal(fmtTaux(5.5), '5,5 %');
  assert.equal(fmtTaux(20), '20 %');
});

test('chapitres : lignes orphelines dans un chapitre sans titre, sous-totaux au centime', () => {
  const c = chapitres([{ line_type: 'product', quantity: 3, unit_price_ht: 10.333 }, ...lines]);
  assert.equal(c.length, 3);
  assert.equal(c[0].titre, '');
  assert.equal(c[0].sous_total_ht, 31);
  assert.equal(c[1].sous_total_ht, 2500);
  assert.equal(c[2].sous_total_ht, 150);
});

test('buildDevisDocumentModel : zones complètes, formats, défauts de conditions', () => {
  const m = buildDevisDocumentModel({ quote, lines, totals, company, config: buildDevisConfig(null), invoicing: { iban: '', bic: '' } });
  assert.equal(m.entete.titre, 'DEVIS');
  assert.equal(m.entete.numero, 'N° DEV-1');
  assert.equal(m.entete.date, 'Date : 6 octobre 2026');
  assert.equal(m.logo.url, 'https://x/logo.png');
  assert.equal(m.emetteur.nom, 'Chauffage Test');
  assert.ok(m.emetteur.lignes.some((l) => l.includes('SIRET : 123')));
  assert.deepEqual(m.client.lignes, ['Marie Curie', '81600 Gaillac']);
  assert.equal(m.tableau.chapitres.length, 2);
  assert.equal(m.tableau.chapitres[0].lignes[0].prix_unitaire, '2 500,00 €');
  assert.equal(m.tableau.chapitres[1].lignes[0].quantite, '1,50');
  assert.equal(m.tableau.chapitres[1].lignes[0].total, '150,00 €');
  assert.equal(m.totaux.lignes.at(-1).valeur, '2 802,50 €');
  assert.equal(m.validite.texte, "Ce devis est valable jusqu'au 5 novembre 2026.");
  assert.equal(m.conditions.lignes.length, 4); // conditions par défaut de la config quand le devis n'en porte pas
  assert.deepEqual(m.commentaire.lignes, []); // pas de commentaire sur ce devis ⇒ zone vide (rien d'imprimé)
  assert.equal(m.paiement.visible, false);
  assert.equal(m.signature.libelle, 'Bon pour accord');
  assert.ok(m.pied_de_page.texte.includes('Chauffage Test'));
  // Aucune espace fine insécable (Helvetica) dans les chaînes du modèle
  const json = JSON.stringify(m);
  assert.equal(json.includes(' '), false);
  assert.equal(json.includes(' '), false);
  for (const z of ZONES) assert.ok(m[z.id], `zone ${z.id} absente du modèle`);
});

test('buildDevisDocumentModel : options d\'affichage, paiement, remise, conditions du devis', () => {
  const config = buildDevisConfig({ devis: {
    document: { intro: 'Merci de votre confiance.\n\nVoici notre proposition.', acompte: 'Acompte de 30 % à la commande.', mention_speciale: 'Éligible MaPrimeRénov’', pied_de_page: 'Mon pied', signature: 'Lu et approuvé' },
    paiement: { afficher: true, etablissement: 'Crédit Mutuel' },
    affichage: { logo: false, references: false, prix_unitaires: false, tva_par_ligne: false, detail_lignes: false },
  } });
  const m = buildDevisDocumentModel({ quote: { ...quote, global_discount_percent: 10, conditions: 'Mes conditions', commentaire: 'Accès par le portail.\n\nLivraison sous 3 semaines.' }, lines, totals: { ...totals, discount_amount: 265 }, company, config, invoicing: { iban: 'FR76 1234', bic: 'CMCIFR2A' } });
  assert.deepEqual(m.intro.lignes, ['Merci de votre confiance.', 'Voici notre proposition.']);
  assert.deepEqual(m.acompte.lignes, ['Acompte de 30 % à la commande.']);
  assert.equal(m.logo.url, null);
  assert.equal(m.tableau.colonnes.detail, false);
  assert.equal(m.tableau.chapitres[0].lignes.length, 0);
  assert.equal(m.tableau.chapitres[0].sous_total, '2 500,00 €');
  assert.ok(m.totaux.lignes.some((l) => l.libelle === 'Remise (10 %)' && l.valeur === '-265,00 €'));
  assert.deepEqual(m.conditions.lignes, ['Mes conditions']);
  assert.deepEqual(m.commentaire.lignes, ['Accès par le portail.', 'Livraison sous 3 semaines.']); // commentaire du devis, visible par le client
  assert.deepEqual(m.mention_speciale.lignes, ['Éligible MaPrimeRénov’']);
  assert.equal(m.paiement.visible, true);
  assert.equal(m.paiement.etablissement, 'Crédit Mutuel');
  assert.equal(m.paiement.bic, 'CMCIFR2A');
  assert.equal(m.signature.libelle, 'Lu et approuvé');
  assert.equal(m.pied_de_page.texte, 'Mon pied');
  // Paiement demandé mais pas d'IBAN en Facturation : non visible, signalé
  const sans = buildDevisDocumentModel({ quote, lines, totals, company, config, invoicing: { iban: '' } });
  assert.equal(sans.paiement.visible, false);
  assert.equal(sans.paiement.sans_iban, true);
});

test('exempleDevis : chapitres de la première famille active, lignes d\'exemple', () => {
  const config = buildDevisConfig({ devis: { familles: [{ key: 'a', label: 'Inactive', actif: false, sections: ['X'] }, { key: 'b', label: 'Clim', sections: ['ÉQUIPEMENT', 'POSE'] }] } });
  const ex = exempleDevis(config, { aujourdhui: new Date('2026-10-06T00:00:00Z') });
  assert.deepEqual(ex.lines.filter((l) => l.line_type === 'section_title').map((l) => l.designation), ['ÉQUIPEMENT', 'POSE']);
  assert.equal(ex.lines.filter((l) => l.line_type !== 'section_title').length, 3);
  assert.equal(ex.quote.subject, 'Clim — exemple');
  assert.equal(fmtDateLongue(ex.quote.validity_date), '5 novembre 2026');
  const d = exempleDevis(DEFAULTS_DEVIS);
  assert.equal(d.lines[0].designation, 'POÊLE');
});
