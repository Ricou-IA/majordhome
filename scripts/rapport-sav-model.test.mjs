// Rapport d'intervention SAV : contenu proposé, validation, lettre, trace, gabarit d'e-mail.
// Lancer : node --test scripts/rapport-sav-model.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pdfSafe, passageDuRapport, contenuInitial, validerContenu, memeContenu, traceRapport, traceEnvoi,
  buildRapportSav, clePiece,
} from '../src/lib/rapportSavModel.js';
import {
  peutFaireRapportSav, rapportDeCarte, RAPPORT_SAV_CODES, messageErreurRapportSav,
  DEFAULT_RAPPORT_SAV_EMAIL, RAPPORT_SAV_EMAIL_PLACEHOLDERS, dateInterventionFr, appareilPourEmail,
} from '../src/lib/rapportSav.js';

const AUJOURDHUI = '2026-11-19';
const CLIENT = { name: 'M. Paul MARTIN', address: '3 rue des Lilas', postal_code: '81600', city: 'Gaillac' };
const COMPANY = { name: 'Mayer Énergie', legalName: 'Mayer Énergie SAS', city: 'Gaillac', signatoryName: 'Eric P.', signatoryRole: 'Gérant' };
const APPAREIL = { id: 'eq-1', libelle: 'Poêle à granulés', marque: 'Edilkamin', modele: 'Lena', numeroSerie: 'SN42' };
const MEMBRES = [{ id: 't1', display_name: 'Philippe Durand' }, { id: 't2', first_name: 'Michel', last_name: 'Roux' }];
const SELECTIONS = [
  { equipment_id: 'eq-1', piece_reference: 'R123', piece_name: 'Bougie d’allumage', repere: '12', quantity: 1 },
  { equipment_id: 'eq-1', piece_reference: 'J9', piece_name: 'Joint de porte', repere: '', quantity: 2 },
  { equipment_id: 'eq-1', piece_reference: 'X0', piece_name: 'Retirée', repere: '', quantity: 0 },
];

// ASCII imprimable, Latin-1 (160 à 255) et les quelques signes cp1252 que Helvetica rend.
const sureEnPdf = (t) => [...t].every((c) => {
  const n = c.codePointAt(0);
  return (n >= 32 && n <= 126) || (n >= 160 && n <= 255) || [8216, 8217, 8220, 8221, 8211, 8212, 8230, 8364, 338, 339].includes(n);
});

test('carte éligible : demande SAV racine, réalisée ou facturée', () => {
  assert.equal(peutFaireRapportSav({ intervention_type: 'sav', workflow_status: 'realise', parent_id: null }), true);
  assert.equal(peutFaireRapportSav({ intervention_type: 'sav', workflow_status: 'facture' }), true);
  assert.equal(peutFaireRapportSav({ intervention_type: 'sav', workflow_status: 'planifie' }), false);
  assert.equal(peutFaireRapportSav({ intervention_type: 'entretien', workflow_status: 'realise' }), false);
  assert.equal(peutFaireRapportSav({ intervention_type: 'sav', workflow_status: 'realise', parent_id: 'p' }), false);
  assert.equal(peutFaireRapportSav(null), false);
});

test('passage : dernier RDV non annulé, jamais futur, techniciens de ce jour-là', () => {
  const rdvs = [
    { scheduled_date: '2026-11-10', status: 'completed', technician_ids: ['t1'] },
    { scheduled_date: '2026-11-12', status: 'completed', technician_ids: ['t1', 't2'] },
    { scheduled_date: '2026-11-12', status: 'scheduled', technician_ids: ['t2'] },
    { scheduled_date: '2026-11-14', status: 'cancelled', technician_ids: ['t1'] },
    { scheduled_date: '2026-12-01', status: 'scheduled', technician_ids: ['t1'] },
  ];
  assert.deepEqual(passageDuRapport({ rdvs, aujourdhui: AUJOURDHUI }), { date: '2026-11-12', technicianIds: ['t1', 't2'] });
});

test('passage sans RDV : date de la carte si elle est passée, sinon aujourd\'hui', () => {
  assert.deepEqual(passageDuRapport({ rdvs: [], scheduledDate: '2026-11-05', aujourdhui: AUJOURDHUI }), { date: '2026-11-05', technicianIds: [] });
  assert.deepEqual(passageDuRapport({ rdvs: [], scheduledDate: '2026-12-25', aujourdhui: AUJOURDHUI }), { date: AUJOURDHUI, technicianIds: [] });
  assert.deepEqual(passageDuRapport({ aujourdhui: AUJOURDHUI }), { date: AUJOURDHUI, technicianIds: [] });
});

test('contenu proposé : demande, travaux déjà saisis, pièces cochées, jamais les notes internes', () => {
  const contenu = contenuInitial({
    carte: { sav_description: 'Ne s’allume plus', work_performed: '', report_notes: 'client pénible', scheduled_date: null },
    rdvs: [{ scheduled_date: '2026-11-12', status: 'completed', technician_ids: ['t1', 't2'] }],
    membres: MEMBRES, selections: SELECTIONS, appareil: APPAREIL, aujourdhui: AUJOURDHUI,
  });
  assert.equal(contenu.date, '2026-11-12');
  assert.equal(contenu.intervenants, 'Philippe Durand et Michel Roux');
  assert.equal(contenu.probleme, 'Ne s’allume plus');
  assert.equal(contenu.travaux, '');
  assert.equal(contenu.observations, '');
  assert.deepEqual(contenu.appareil, APPAREIL);
  assert.deepEqual(contenu.pieces.map((p) => [p.designation, p.quantite, p.retenue]), [['Bougie d’allumage', 1, true], ['Joint de porte', 2, true]]);
  assert.ok(!JSON.stringify(contenu).includes('pénible'));
});

test('rapport déjà édité : rouvert tel qu\'écrit, coches gardées, pièce identifiée depuis cochée', () => {
  const trace = {
    path: 'x',
    contenu: {
      date: '2026-11-11', intervenants: 'Philippe', appareil: APPAREIL, probleme: 'Bruit', travaux: 'Vis sans fin changée', observations: 'RAS',
      pieces: [{ cle: clePiece(SELECTIONS[0]), designation: 'Bougie', reference: 'R123', quantite: 1, retenue: false }],
    },
  };
  const contenu = contenuInitial({ carte: { sav_description: 'autre', work_performed: 'autre' }, selections: SELECTIONS, aujourdhui: AUJOURDHUI, trace });
  assert.equal(contenu.date, '2026-11-11');
  assert.equal(contenu.travaux, 'Vis sans fin changée');
  assert.equal(contenu.probleme, 'Bruit');
  assert.deepEqual(contenu.pieces.map((p) => [p.reference, p.retenue]), [['R123', false], ['J9', true]]);
});

test('validation : date obligatoire et jamais future, travaux obligatoires', () => {
  assert.deepEqual(validerContenu({ date: '2026-11-12', travaux: 'Fait' }, { aujourdhui: AUJOURDHUI }), []);
  assert.match(validerContenu({ date: '', travaux: 'Fait' }, { aujourdhui: AUJOURDHUI })[0], /date/);
  assert.match(validerContenu({ date: '2026-13-40', travaux: 'Fait' }, { aujourdhui: AUJOURDHUI })[0], /date/);
  assert.match(validerContenu({ date: '2026-11-20', travaux: 'Fait' }, { aujourdhui: AUJOURDHUI })[0], /futur/);
  assert.match(validerContenu({ date: '2026-11-12', travaux: '  \n ' }, { aujourdhui: AUJOURDHUI })[0], /travaux/);
});

test('lettre : en-tête, appareil en gras, blocs dans l\'ordre, pièces cochées seulement', () => {
  const contenu = {
    date: '2026-11-12', intervenants: 'Philippe Durand', appareil: APPAREIL,
    probleme: 'Ne s’allume plus', travaux: 'Remplacement de la bougie.\nEssai de fonctionnement : OK', observations: '',
    pieces: [
      { cle: 'a', designation: 'Bougie d’allumage', reference: 'R123', quantite: 1, retenue: true },
      { cle: 'b', designation: 'Joint de porte', reference: 'J9', quantite: 2, retenue: false },
    ],
  };
  const { lettre } = buildRapportSav({ contenu, client: CLIENT, company: COMPANY, dateEdition: AUJOURDHUI });
  assert.equal(lettre.objet, 'RAPPORT D’INTERVENTION');
  assert.equal(lettre.references, 'Intervention du 12 novembre 2026');
  assert.equal(lettre.lieuDate, 'Gaillac, le 19 novembre 2026');
  assert.deepEqual(lettre.destinataire, ['M. Paul MARTIN', '3 rue des Lilas', '81600 GAILLAC']);
  assert.equal(lettre.titreDocument, "Rapport d'intervention - M. Paul MARTIN");
  assert.equal(lettre.signataire.entreprise, 'MAYER ÉNERGIE SAS');

  const textes = lettre.paragraphes.map((p) => p.map((s) => s.text).join(''));
  assert.equal(textes[0], 'Nous sommes intervenus le 12 novembre 2026 au domicile de M. Paul MARTIN, 3 rue des Lilas, 81600 GAILLAC, sur son poêle à granulés de marque EDILKAMIN Lena, n° de série SN42. L’intervention a été réalisée par Philippe Durand.');
  assert.equal(lettre.paragraphes[0].find((s) => s.bold).text, 'son poêle à granulés de marque EDILKAMIN Lena, n° de série SN42');
  assert.equal(textes[1], 'Problème signalé : Ne s’allume plus');
  assert.equal(textes[2], 'Travaux réalisés : Remplacement de la bougie.');
  assert.equal(textes[3], 'Essai de fonctionnement : OK');
  assert.equal(textes[4], 'Pièces remplacées : 1 x Bougie d’allumage (réf. R123)');
  assert.equal(textes[5], 'Nous restons à votre disposition pour tout renseignement complémentaire.');
  assert.equal(textes.length, 6);
  assert.ok(!textes.join(' ').includes('Joint de porte'));
});

test('lettre sans appareil, sans intervenant, sans pièce : phrases omises, pas de blanc', () => {
  const { lettre } = buildRapportSav({
    contenu: { date: '2026-11-12', intervenants: '', appareil: null, probleme: '', travaux: 'Réglage', observations: 'À revoir au printemps', pieces: [] },
    client: { name: 'Mme DUPONT' }, company: { name: 'ACME' }, dateEdition: AUJOURDHUI,
  });
  const textes = lettre.paragraphes.map((p) => p.map((s) => s.text).join(''));
  assert.deepEqual(textes, [
    'Nous sommes intervenus le 12 novembre 2026 au domicile de Mme DUPONT pour un dépannage.',
    'Travaux réalisés : Réglage',
    'Observations : À revoir au printemps',
    'Nous restons à votre disposition pour tout renseignement complémentaire.',
  ]);
  assert.equal(lettre.lieuDate, 'Le 19 novembre 2026');
  assert.equal(lettre.faitA, 'Fait le 19-11-2026');
});

test('texte saisi : rien qui sorte en artefact dans le PDF', () => {
  assert.equal(pdfSafe('1 953 € → OK ✅ −3 °C'), '1 953 € - OK  -3 °C');
  const { lettre } = buildRapportSav({
    contenu: { date: '2026-11-12', intervenants: 'Zoé 😀', appareil: APPAREIL, probleme: 'Θ≥3', travaux: 'Nettoyage\tcomplet → OK', observations: '', pieces: [] },
    client: CLIENT, company: COMPANY, dateEdition: AUJOURDHUI,
  });
  const tout = [lettre.lieuDate, lettre.objet, lettre.references, lettre.faitA, ...lettre.destinataire, ...lettre.paragraphes.flat().map((s) => s.text)];
  for (const t of tout) assert.ok(sureEnPdf(t), `hors PDF : ${t}`);
});

test('saisie comparée au rapport archivé : espaces et lignes vides ne comptent pas', () => {
  const a = { date: '2026-11-12', intervenants: ' Philippe ', appareil: null, probleme: '', travaux: 'Fait\n\n', observations: '', pieces: [] };
  const b = { date: '2026-11-12', intervenants: 'Philippe', appareil: null, probleme: '', travaux: 'Fait', observations: '', pieces: [] };
  assert.equal(memeContenu(a, b), true);
  assert.equal(memeContenu(a, { ...b, travaux: 'Fait autrement' }), false);
  assert.equal(memeContenu({ ...a, pieces: [{ cle: 'x', designation: 'P', reference: 'R', quantite: 1, retenue: true }] }, { ...b, pieces: [{ cle: 'x', designation: 'P', reference: 'R', quantite: 1, retenue: false }] }), false);
});

test('trace : une nouvelle édition efface la mention d\'envoi', () => {
  const contenu = { date: '2026-11-12', travaux: 'Fait', pieces: [] };
  const editee = traceRapport({ path: 'o/p/i/rapport-intervention.pdf', contenu, userId: 'u1', maintenant: '2026-11-19T10:00:00.000Z' });
  assert.deepEqual(Object.keys(editee), ['path', 'edite_le', 'edite_par', 'contenu']);
  const envoyee = traceEnvoi(editee, { to: 'a@b.fr', maintenant: '2026-11-19T10:05:00.000Z' });
  assert.equal(envoyee.envoye_a, 'a@b.fr');
  assert.equal(rapportDeCarte({ metadata: { rapport_sav: envoyee } }).envoye_le, '2026-11-19T10:05:00.000Z');
  assert.equal(traceRapport({ path: 'x', contenu, maintenant: 'm' }).envoye_le, undefined);
  assert.equal(rapportDeCarte({ metadata: { rapport_sav: { contenu } } }), null);
  assert.equal(rapportDeCarte({ metadata: null }), null);
});

test('gabarit d\'e-mail : variables connues seulement, messages pour chaque code', () => {
  const variables = `${DEFAULT_RAPPORT_SAV_EMAIL.subject} ${DEFAULT_RAPPORT_SAV_EMAIL.html_body}`.match(/\{\{[A-Z_]+\}\}/g) || [];
  for (const v of variables) assert.ok(RAPPORT_SAV_EMAIL_PLACEHOLDERS.includes(v), `variable inconnue : ${v}`);
  assert.equal(DEFAULT_RAPPORT_SAV_EMAIL.is_transactional, true);
  for (const [code, message] of Object.entries(RAPPORT_SAV_CODES)) {
    assert.ok(message.length > 10, code);
    assert.equal(messageErreurRapportSav(code), message);
  }
  assert.equal(messageErreurRapportSav('code_inconnu'), 'L’envoi du rapport a échoué.');
  assert.equal(dateInterventionFr('2026-11-12'), '12/11/2026');
  assert.equal(dateInterventionFr(null), '');
  assert.equal(appareilPourEmail(APPAREIL), 'votre poêle à granulés Edilkamin Lena');
  assert.equal(appareilPourEmail(null), 'votre installation');
});
