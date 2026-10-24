// node --test scripts/lead-welcome-email.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  leadWelcomeSettings, toggleLeadWelcome, borneCreation, leadsAAccueillir,
  LEAD_WELCOME_MAX_AGE_HOURS, LEAD_WELCOME_MAX_ECHECS, DEFAULT_LEAD_WELCOME_EMAIL,
} from '../src/lib/leadWelcomeEmail.js';

test('réglage absent ou sans date d’activation = éteint', () => {
  assert.deepEqual(leadWelcomeSettings(undefined), { enabled: false, enabled_since: null });
  assert.equal(leadWelcomeSettings({ lead_welcome_email: { enabled: true } }).enabled, false);
  assert.equal(leadWelcomeSettings({ lead_welcome_email: { enabled: true, enabled_since: 'n’importe quoi' } }).enabled, false);
  assert.equal(leadWelcomeSettings({ lead_welcome_email: { enabled: true, enabled_since: '2026-10-24T08:00:00.000Z' } }).enabled, true);
});

test('activer pose la date du jour, éteindre l’efface', () => {
  const now = new Date('2026-10-24T08:00:00Z');
  assert.deepEqual(toggleLeadWelcome(true, now), { enabled: true, enabled_since: '2026-10-24T08:00:00.000Z' });
  assert.deepEqual(toggleLeadWelcome(false, now), { enabled: false, enabled_since: null });
});

test('borne = la plus récente entre activation et fenêtre de rattrapage', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  assert.equal(borneCreation('2026-10-24T08:00:00Z', now), '2026-10-24T08:00:00.000Z');
  const fenetre = new Date(now.getTime() - LEAD_WELCOME_MAX_AGE_HOURS * 3_600_000).toISOString();
  assert.equal(borneCreation('2026-01-01T00:00:00Z', now), fenetre);
});

test('sélection : jamais deux fois, échecs plafonnés, désinscrits et sans e-mail exclus', () => {
  const leads = [
    { id: 'a', email: 'a@x.fr' },
    { id: 'b', email: 'b@x.fr' },
    { id: 'c', email: null },
    { id: 'd', email: 'd@x.fr', email_unsubscribed_at: '2026-10-01' },
    { id: 'e', email: 'e@x.fr' },
    { id: 'f', email: 'f@x.fr' },
    { id: 'g', email: 'g@x.fr', is_deleted: true },
  ];
  const journal = [
    { lead_id: 'b', status: 'delivered' },
    ...Array.from({ length: LEAD_WELCOME_MAX_ECHECS }, () => ({ lead_id: 'e', status: 'failed' })),
    { lead_id: 'f', status: 'failed' },
  ];
  const { aEnvoyer, exclus } = leadsAAccueillir(leads, journal);
  assert.deepEqual(aEnvoyer.map((l) => l.id), ['a', 'f']);
  assert.deepEqual(exclus, { deja_envoye: 1, sans_email: 1, desinscrit: 1, supprime: 1, trop_d_echecs: 1 });
});

test('le gabarit par défaut ne contient ni numéro ni adresse en dur', () => {
  const tout = DEFAULT_LEAD_WELCOME_EMAIL.subject + DEFAULT_LEAD_WELCOME_EMAIL.html_body;
  assert.doesNotMatch(tout, /\d{2} \d{2}|mayer/i);
  assert.match(tout, /\{\{ORG_PHONE\}\}/);
  assert.equal(DEFAULT_LEAD_WELCOME_EMAIL.is_transactional, true);
});
