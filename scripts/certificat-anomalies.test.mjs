// scripts/certificat-anomalies.test.mjs — node --test
// Anomalie du certificat d'entretien : normalisation pour la carte, déclencheur SAV, textes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS_CORRECTIVES,
  libelleAction,
  anomaliesDeCarte,
  doitCreerSav,
  descriptionSavDepuisCertificat,
  noteClientDepuisAnomalies,
} from '../src/lib/certificatAnomalies.js';

const guillou = {
  certificat_id: 'c1', intervention_id: 'i-enfant', equipment_id: 'e1',
  equipement: 'Burneco Cap 30', equipement_type: 'chaudiere_bois',
  bilan: 'anomalie', detail: 'Creuset commence a se deformer', action: 'devis',
  date: '2026-10-07', sav_id: null,
};

test('libellés des actions correctives : source unique, code inconnu ⇒ vide', () => {
  assert.equal(ACTIONS_CORRECTIVES.length, 3);
  assert.equal(libelleAction('devis'), 'Devis à établir');
  assert.equal(libelleAction('sur_place'), 'Corrigée sur place');
  assert.equal(libelleAction('arret_urgence'), "Arrêt d'urgence");
  assert.equal(libelleAction('xyz'), '');
  assert.equal(libelleAction(null), '');
});

test('anomaliesDeCarte : jsonb déjà parsé, chaîne JSON, vide, tri par date, conformes écartés', () => {
  assert.deepEqual(anomaliesDeCarte({ anomalies: null }), []);
  assert.deepEqual(anomaliesDeCarte({}), []);
  assert.deepEqual(anomaliesDeCarte({ anomalies: 'pas du json' }), []);
  const parsed = anomaliesDeCarte({ anomalies: [guillou] });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].certificatId, 'c1');
  assert.equal(parsed[0].interventionId, 'i-enfant');
  assert.equal(parsed[0].equipement, 'Burneco Cap 30');
  assert.equal(parsed[0].detail, 'Creuset commence a se deformer');
  assert.equal(parsed[0].action, 'devis');
  assert.equal(parsed[0].actionLabel, 'Devis à établir');
  assert.equal(parsed[0].savId, null);
  const fromString = anomaliesDeCarte({ anomalies: JSON.stringify([
    { ...guillou, certificat_id: 'c2', date: '2026-10-09' },
    { ...guillou, certificat_id: 'c3', date: '2026-10-01', bilan: 'conforme' },
    { ...guillou, certificat_id: 'c4', date: '2026-10-05', bilan: 'arret_urgence', action: 'arret_urgence', sav_id: 's1' },
  ]) });
  assert.deepEqual(fromString.map((a) => a.certificatId), ['c4', 'c2']);
  assert.equal(fromString[0].savId, 's1');
  assert.equal(fromString[0].bilanLabel, "Arrêt d'urgence");
});

test('doitCreerSav : devis + anomalie ou arrêt ⇒ oui ; corrigé sur place, conforme, sans action ⇒ non', () => {
  assert.equal(doitCreerSav({ bilan_conformite: 'anomalie', action_corrective: 'devis' }), true);
  assert.equal(doitCreerSav({ bilan_conformite: 'arret_urgence', action_corrective: 'devis' }), true);
  assert.equal(doitCreerSav({ bilan_conformite: 'anomalie', action_corrective: 'sur_place' }), false);
  assert.equal(doitCreerSav({ bilan_conformite: 'anomalie', action_corrective: 'arret_urgence' }), false);
  assert.equal(doitCreerSav({ bilan_conformite: 'conforme', action_corrective: 'devis' }), false);
  assert.equal(doitCreerSav({ bilan_conformite: 'anomalie' }), false);
  assert.equal(doitCreerSav(null), false);
});

test('descriptionSavDepuisCertificat : date, équipement, détail, action ; champs absents tolérés', () => {
  const cert = { date_intervention: '2026-10-07', equipement_marque: 'Burneco', equipement_modele: 'Cap 30', anomalies_detail: 'Creuset commence a se deformer', action_corrective: 'devis' };
  assert.equal(
    descriptionSavDepuisCertificat(cert),
    'Suite à l’entretien du 7 octobre 2026 (Burneco Cap 30) : Creuset commence a se deformer. Devis à établir.',
  );
  assert.equal(
    descriptionSavDepuisCertificat({ ...cert, equipement_marque: null, equipement_modele: null }, { equipementLabel: 'Chaudière bois' }),
    'Suite à l’entretien du 7 octobre 2026 (Chaudière bois) : Creuset commence a se deformer. Devis à établir.',
  );
  assert.equal(
    descriptionSavDepuisCertificat({ anomalies_detail: '  Fuite.  ', action_corrective: 'devis' }),
    'Suite à l’entretien : Fuite. Devis à établir.',
  );
  assert.equal(descriptionSavDepuisCertificat({ action_corrective: 'devis' }), 'Suite à l’entretien : anomalie constatée. Devis à établir.');
});

test('noteClientDepuisAnomalies : vide sans anomalie ; une ligne par anomalie avec la suite donnée', () => {
  assert.equal(noteClientDepuisAnomalies([]), '');
  assert.equal(noteClientDepuisAnomalies(null), '');
  const une = noteClientDepuisAnomalies(anomaliesDeCarte({ anomalies: [guillou] }));
  assert.equal(une, 'Constaté lors de l’entretien : Creuset commence a se deformer. Un devis vous sera adressé.');
  const deux = noteClientDepuisAnomalies(anomaliesDeCarte({ anomalies: [
    guillou,
    { ...guillou, certificat_id: 'c2', date: '2026-10-08', equipement: 'Poêle Rika', detail: 'Joint de porte usé', action: 'sur_place' },
    { ...guillou, certificat_id: 'c3', date: '2026-10-09', equipement: 'PAC Daikin', detail: 'Fuite de fluide', bilan: 'arret_urgence', action: 'arret_urgence' },
  ] }));
  assert.equal(deux, [
    'Constaté lors de l’entretien (Burneco Cap 30) : Creuset commence a se deformer. Un devis vous sera adressé.',
    'Constaté lors de l’entretien (Poêle Rika) : Joint de porte usé. Corrigé sur place.',
    'Constaté lors de l’entretien (PAC Daikin) : Fuite de fluide. Installation mise à l’arrêt par sécurité.',
  ].join('\n'));
  // Pas d'espace fine insécable ni de glyphe hors Helvetica dans le texte imprimé
  assert.equal(deux.includes(String.fromCharCode(0x202f)) || deux.includes(String.fromCharCode(0xa0)), false);
});
