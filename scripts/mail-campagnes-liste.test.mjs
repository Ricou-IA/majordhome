// Liste des campagnes — archiver, restaurer, supprimer : node --test scripts/mail-campagnes-liste.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gestesDeCampagne, texteArchivage, texteSuppression, champsDeRestauration, messageRestauration, separerArchivees,
} from '../src/lib/mailCampagnesListe.js';

const manuelle = { key: 'promo_2026', label: 'Promo 2026' };
const automatique = { key: 'relance_devis', label: 'Relance devis', is_automated: true };
const sequence = { key: 'sequence_accueil_lead', label: 'Accueil d’un nouveau prospect', is_automated: true, is_transactional: true };
const registre = { key: 'pv_reception', label: 'PV de réception à signer en ligne', is_transactional: true };
const boutique = { key: 'webshop_confirmation', label: 'Confirmation de commande', is_transactional: true };
const inconnue = { key: 'ancien_evenement', label: 'Ancien e-mail', is_transactional: true };

test('un autre rôle que l’administrateur n’a aucun geste', () => {
  const g = gestesDeCampagne({ campagne: manuelle, isOrgAdmin: false });
  assert.deepEqual([g.archiver.visible, g.restaurer.visible, g.supprimer.visible], [false, false, false]);
  assert.equal(gestesDeCampagne({ campagne: null, isOrgAdmin: true }).supprimer.visible, false);
});

test('campagne manuelle, automatique, séquence, e-mail du registre : archiver et supprimer ouverts', () => {
  for (const c of [manuelle, automatique, sequence, registre]) {
    const g = gestesDeCampagne({ campagne: c, isOrgAdmin: true });
    assert.equal(g.archiver.possible, true, c.key);
    assert.equal(g.supprimer.possible, true, c.key);
    assert.equal(g.restaurer.visible, false, c.key);
  }
});

test('e-mail de la boutique ou évènement inconnu du registre : ni archivé ni supprimé, avec la raison', () => {
  for (const c of [boutique, inconnue]) {
    const g = gestesDeCampagne({ campagne: c, isOrgAdmin: true });
    assert.equal(g.archiver.visible, true, c.key);
    assert.equal(g.archiver.possible, false, c.key);
    assert.equal(g.supprimer.possible, false, c.key);
    assert.match(g.supprimer.raison, /ne partirait plus/);
    assert.equal(g.archiver.affiche, false, c.key);
    assert.equal(g.supprimer.affiche, false, c.key);
  }
});

test('un envoi en cours ferme archiver et supprimer', () => {
  const g = gestesDeCampagne({ campagne: manuelle, isOrgAdmin: true, envoiEnCours: true });
  assert.equal(g.archiver.possible, false);
  assert.equal(g.supprimer.possible, false);
  assert.match(g.archiver.raison, /envoi de cette campagne est en cours/);
  // le bouton reste affiché : le clic dit pourquoi
  assert.equal(g.archiver.affiche, true);
  assert.equal(g.supprimer.affiche, true);
  assert.equal(gestesDeCampagne({ campagne: manuelle, isOrgAdmin: true }).archiver.affiche, true);
});

test('campagne archivée : restaurer et supprimer, plus d’archiver', () => {
  const g = gestesDeCampagne({ campagne: { ...manuelle, is_archived: true }, isOrgAdmin: true });
  assert.equal(g.archiver.visible, false);
  assert.equal(g.restaurer.possible, true);
  assert.equal(g.supprimer.possible, true);
  // une ligne archivée d'un e-mail de la boutique ne sert déjà plus : elle se supprime
  assert.equal(gestesDeCampagne({ campagne: { ...boutique, is_archived: true }, isOrgAdmin: true }).supprimer.possible, true);
});

test('archivage : la confirmation dit ce que devient l’e-mail', () => {
  assert.match(texteArchivage(manuelle).message, /ne pourra plus être envoyée/);
  assert.match(texteArchivage(automatique).message, /envoi automatique s’arrête/);
  assert.match(texteArchivage(sequence).message, /ne partira plus vers vos prospects/);
  assert.match(texteArchivage(registre).message, /texte par défaut/);
  assert.match(texteArchivage(manuelle).message, /restaurer/);
  assert.equal(texteArchivage(manuelle).titre, 'Archiver « Promo 2026 » ?');
});

test('suppression : définitive, et l’historique reste', () => {
  const t = texteSuppression(manuelle, 12);
  assert.match(t.titre, /Supprimer définitivement « Promo 2026 »/);
  assert.match(t.message, /ne se rattrape pas/);
  assert.match(t.message, /Ses 12 envois restent visibles/);
  assert.match(texteSuppression(manuelle, 1).message, /Son envoi reste visible/);
  assert.doesNotMatch(texteSuppression(manuelle, 0).message, /statistiques/);
  assert.match(texteSuppression(manuelle, undefined).message, /historique de ses envois reste visible/);
  assert.match(texteSuppression(registre, 0).message, /texte par défaut/);
  // déjà archivée : la conséquence a déjà eu lieu, on ne la répète pas
  assert.doesNotMatch(texteSuppression({ ...automatique, is_archived: true }, 0).message, /s’arrête/);
});

test('aucun mot technique dans les textes', () => {
  for (const c of [manuelle, automatique, sequence, registre]) {
    for (const t of [texteArchivage(c), texteSuppression(c, 3)]) {
      assert.doesNotMatch(`${t.titre} ${t.message} ${t.confirmer}`, /html|template|variable|\{\{|is_|campaign/i);
    }
  }
});

test('restauration : une campagne automatique revient éteinte', () => {
  assert.deepEqual(champsDeRestauration({ ...manuelle, is_archived: true }), { is_archived: false });
  assert.deepEqual(champsDeRestauration({ ...automatique, is_archived: true }), { is_archived: false, is_automated: false });
  assert.deepEqual(champsDeRestauration({ ...sequence, is_archived: true }), { is_archived: false, is_automated: false });
  assert.match(messageRestauration(automatique), /envoi automatique arrêté/);
  assert.match(messageRestauration(sequence), /Séquences/);
  assert.equal(messageRestauration(manuelle), 'Campagne restaurée.');
});

test('séparer les archivées', () => {
  const r = separerArchivees([manuelle, { ...registre, is_archived: true }, { ...automatique, is_archived: true }]);
  assert.deepEqual(r.actives.map((c) => c.key), ['promo_2026']);
  assert.deepEqual(r.archivees.map((c) => c.key), ['pv_reception', 'relance_devis']);
  assert.deepEqual(separerArchivees(null), { actives: [], archivees: [] });
});
