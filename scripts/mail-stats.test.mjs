import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statsAffichees } from '../src/lib/mailStats.js';

const maintenant = new Date('2026-11-24T12:00:00Z');
const stats = [
  { campaign_name: 'Relance devis', total_sent: 100, total_delivered: 100, total_opened: 40, last_sent_at: '2026-11-20T08:00:00Z' },
  { campaign_name: 'Ramonage', total_sent: 500, total_delivered: 400, total_opened: 80, last_sent_at: '2026-06-01T08:00:00Z' },
  { campaign_name: 'Accueil', total_sent: 10, total_delivered: 0, total_opened: 0, last_sent_at: null },
];

test('la période retient les campagnes par leur dernier envoi', () => {
  assert.deepEqual(statsAffichees(stats, { periode: '30', maintenant }).map((r) => r.campaign_name), ['Relance devis']);
  assert.deepEqual(statsAffichees(stats, { periode: '365', maintenant }).map((r) => r.campaign_name), ['Relance devis', 'Ramonage']);
  assert.equal(statsAffichees(stats, { periode: 'tout', maintenant }).length, 3);
});

test('tri par colonne, valeur absente en fin', () => {
  const parEnvois = statsAffichees(stats, { tri: { cle: 'envois', ascendant: false }, maintenant });
  assert.deepEqual(parEnvois.map((r) => r.campaign_name), ['Ramonage', 'Relance devis', 'Accueil']);
  const parOuverture = statsAffichees(stats, { tri: { cle: 'ouverts', ascendant: false }, maintenant });
  assert.deepEqual(parOuverture.map((r) => r.campaign_name), ['Relance devis', 'Ramonage', 'Accueil']);
  const parNom = statsAffichees(stats, { tri: { cle: 'campagne', ascendant: true }, maintenant });
  assert.deepEqual(parNom.map((r) => r.campaign_name), ['Accueil', 'Ramonage', 'Relance devis']);
});
