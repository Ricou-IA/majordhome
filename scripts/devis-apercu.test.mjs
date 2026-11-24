import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteApercu } from '../src/lib/devisApercu.js';

const form = { subject: 'Poêle à granulés', validityDays: '30', conditions: 'Acompte 30 %', commentaire: '', globalDiscountPercent: '5' };
const lead = { first_name: 'Élise', last_name: 'DUPONT', address: '1 rue X', postal_code: '81600', city: 'Gaillac', phone: '06', email: 'e@x.fr' };
const jour = new Date(2026, 10, 24);

test('nouveau devis : client du lead, pas de numéro, validité depuis aujourd’hui', () => {
  const q = quoteApercu({ lead, form, aujourdhui: jour });
  assert.equal(q.quote_number, '');
  assert.equal(q.client_display_name, 'Élise DUPONT');
  assert.equal(q.client_city, 'Gaillac');
  assert.equal(q.subject, 'Poêle à granulés');
  assert.equal(q.global_discount_percent, 5);
  assert.equal(q.validity_date.getDate(), 24);
  assert.equal(q.validity_date.getMonth(), 11);
});

test('devis modifié : garde son numéro, sa date et son client', () => {
  const quote = { quote_number: 'DEV-2026-0042', created_at: '2026-11-01T10:00:00', client_display_name: 'Autre Client', client_city: 'Albi' };
  const q = quoteApercu({ lead, form: { ...form, validityDays: '15' }, quote, aujourdhui: jour });
  assert.equal(q.quote_number, 'DEV-2026-0042');
  assert.equal(q.client_display_name, 'Autre Client');
  assert.equal(q.client_city, 'Albi');
  assert.equal(q.validity_date.getDate(), 16);
});

test('validité illisible ou absente : pas de date de fin', () => {
  assert.equal(quoteApercu({ lead, form: { ...form, validityDays: '' }, aujourdhui: jour }).validity_date, null);
  assert.equal(quoteApercu({ lead: null, form: {}, aujourdhui: jour }).client_display_name, '');
});
