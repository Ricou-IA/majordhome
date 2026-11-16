// Tests du module pur src/lib/leadCardDate.js — `node --test scripts/lead-card-date.test.mjs`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateDeCarte, plusRecente } from '../src/lib/leadCardDate.js';

const lead = (extra = {}) => ({
  id: 'l1',
  created_date: '2026-10-01',
  created_at: '2026-10-01T08:00:00Z',
  status_changed_at: '2026-11-05T10:00:00Z',
  status_is_final: false,
  status_is_won: false,
  ...extra,
});

test('plusRecente : garde la valeur brute la plus tardive, ignore vides et illisibles', () => {
  assert.equal(plusRecente(['2026-10-02T09:00:00Z', null, '2026-11-03T09:00:00Z', 'pas une date']), '2026-11-03T09:00:00Z');
  assert.equal(plusRecente([null, undefined, '']), null);
  assert.equal(plusRecente([]), null);
});

test('Nouveau : date de création de la carte', () => {
  const r = dateDeCarte({ columnKey: 'nouveau', lead: lead() });
  assert.equal(r.date, '2026-10-01');
  assert.equal(r.libelle, 'Créé le');
  assert.equal(r.aReplanifier, false);
});

test('Contacté : le dernier contact, quel que soit son canal', () => {
  const r = dateDeCarte({
    columnKey: 'contacte',
    lead: lead({
      last_call_date: '2026-10-10T09:00:00Z',
      last_followup_date: '2026-10-20T09:00:00Z',
      last_interaction_at: '2026-10-15T09:00:00Z',
    }),
  });
  assert.equal(r.date, '2026-10-20T09:00:00Z');
  assert.equal(r.libelle, 'Dernier contact le');
});

test('Contacté sans aucun contact enregistré : pas de date (jamais la date de création)', () => {
  assert.equal(dateDeCarte({ columnKey: 'contacte', lead: lead() }).date, null);
});

test('RDV planifié : la date du RDV actif de la vue prime sur celle du lead', () => {
  const r = dateDeCarte({
    columnKey: 'rdv_planifie',
    lead: lead({ appointment_date: '2026-11-02' }),
    card: { column_key: 'rdv_planifie', has_active_rdv: true, next_rdv_date: '2026-11-20' },
  });
  assert.equal(r.date, '2026-11-20');
  assert.equal(r.aReplanifier, false);
});

test('RDV planifié sans RDV actif : à replanifier, pas de date', () => {
  const r = dateDeCarte({
    columnKey: 'rdv_planifie',
    lead: lead({ appointment_date: '2026-11-02' }),
    card: { column_key: 'rdv_planifie', has_active_rdv: false, next_rdv_date: null },
  });
  assert.equal(r.date, null);
  assert.equal(r.aReplanifier, true);
});

test('RDV planifié, carte de la vue encore rangée ailleurs (déplacement en cours) : date du lead, pas d’alerte', () => {
  const r = dateDeCarte({
    columnKey: 'rdv_planifie',
    lead: lead({ appointment_date: '2026-11-02' }),
    card: { column_key: 'contacte', has_active_rdv: false, next_rdv_date: null },
  });
  assert.equal(r.date, '2026-11-02');
  assert.equal(r.aReplanifier, false);
});

test('RDV planifié sans carte de la vue : date du lead', () => {
  const r = dateDeCarte({ columnKey: 'rdv_planifie', lead: lead({ appointment_date: '2026-11-02' }) });
  assert.equal(r.date, '2026-11-02');
});

test('Devis envoyé : le PREMIER devis du lead, pas le dernier envoi', () => {
  const r = dateDeCarte({
    columnKey: 'devis_envoye',
    lead: lead({ quote_sent_date: '2026-11-10' }),
    card: { column_key: 'devis_envoye', devis_count: 2, first_quote_date: '2026-09-30' },
  });
  assert.equal(r.date, '2026-09-30');
  assert.equal(r.libelle, 'Premier devis le');
});

test('Devis envoyé sans devis Pennylane : date d’envoi notée sur le lead', () => {
  const r = dateDeCarte({
    columnKey: 'devis_envoye',
    lead: lead({ quote_sent_date: '2026-11-10' }),
    card: { column_key: 'devis_envoye', devis_count: 0, first_quote_date: null },
  });
  assert.equal(r.date, '2026-11-10');
});

test('Gagné : la date de gain du lead', () => {
  const r = dateDeCarte({
    columnKey: 'gagne',
    lead: lead({ won_date: '2026-11-12' }),
    card: { column_key: 'gagne', devis_count: 1, quotes_validated_at: '2026-11-14T08:00:00Z' },
  });
  assert.equal(r.date, '2026-11-12');
  assert.equal(r.libelle, 'Gagné le');
});

test('Gagné par Pennylane sans date de gain sur le lead : validation du devis', () => {
  const r = dateDeCarte({
    columnKey: 'gagne',
    lead: lead({ won_date: null }),
    card: { column_key: 'gagne', devis_count: 1, quotes_validated_at: '2026-08-18T08:00:00Z' },
  });
  assert.equal(r.date, '2026-08-18T08:00:00Z');
});

test('Gagné sans devis ni date de gain : le jour du passage au statut gagné', () => {
  const r = dateDeCarte({
    columnKey: 'gagne',
    lead: lead({ won_date: null, status_is_final: true, status_is_won: true }),
  });
  assert.equal(r.date, '2026-11-05T10:00:00Z');
});

test('Perdu par Pennylane : le dernier refus, même si le statut du lead n’a pas bougé', () => {
  const r = dateDeCarte({
    columnKey: 'perdu',
    lead: lead({ status_changed_at: '2026-09-01T10:00:00Z' }), // passage en « Devis envoyé »
    card: { column_key: 'perdu', devis_count: 2, quotes_refused_at: '2026-10-28T15:30:00Z' },
  });
  assert.equal(r.date, '2026-10-28T15:30:00Z');
  assert.equal(r.libelle, 'Perdu le');
});

test('Perdu par Pennylane, refus inconnu du miroir, statut resté en amont : pas de date', () => {
  const r = dateDeCarte({
    columnKey: 'perdu',
    lead: lead({ status_changed_at: '2026-09-01T10:00:00Z' }),
    card: { column_key: 'perdu', devis_count: 1, quotes_refused_at: null },
  });
  assert.equal(r.date, null);
});

test('Perdu à la main (sans devis) : le jour du passage en Perdu', () => {
  const r = dateDeCarte({
    columnKey: 'perdu',
    lead: lead({ status_is_final: true, status_is_won: false, status_changed_at: '2026-11-03T16:00:00Z' }),
    card: { column_key: 'perdu', devis_count: 0, quotes_refused_at: null },
  });
  assert.equal(r.date, '2026-11-03T16:00:00Z');
});

test('Perdu à la main, sans carte de la vue', () => {
  const r = dateDeCarte({
    columnKey: 'perdu',
    lead: lead({ status_is_final: true, status_is_won: false, status_changed_at: '2026-11-03T16:00:00Z' }),
  });
  assert.equal(r.date, '2026-11-03T16:00:00Z');
});

test('Lead absent ou colonne inconnue : rien ne casse', () => {
  assert.deepEqual(dateDeCarte({ columnKey: 'gagne', lead: null }), { date: null, libelle: '', aReplanifier: false });
  assert.equal(dateDeCarte({ columnKey: 'autre', lead: lead() }).date, '2026-10-01');
});
