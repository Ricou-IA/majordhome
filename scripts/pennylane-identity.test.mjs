// node --test scripts/pennylane-identity.test.mjs
// Règles pures de la synchro identité client MDH ⇄ Pennylane (supabase/functions/_shared/pennylaneIdentity.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  identityFromPlCustomer, changedIdentityFields, buildPlUpdate, planPullUpdate,
  changedPushableColumns, plAddressLine,
} from '../supabase/functions/_shared/pennylaneIdentity.js';

// Forme réelle relevée par sonde le 2026-10-11 (GET /customers/{id}, ressource au root).
const PL = {
  id: 1571604213760, name: 'SYNCHRO MDH ZZ TEST', first_name: 'SYNCHRO MDH', last_name: 'ZZ TEST',
  emails: ['test-a@example.invalid', 'compta@example.invalid'], phone: '+33600000001',
  billing_address: { address: '1 rue du Test', postal_code: '81600', city: 'Gaillac', country_alpha2: 'FR' },
  customer_type: 'individual', updated_at: '2026-10-11T13:30:23Z',
};

test('identité à plat : premier e-mail, billing_address', () => {
  const id = identityFromPlCustomer(PL);
  assert.equal(id.email, 'test-a@example.invalid');
  assert.equal(id.address, '1 rue du Test');
  assert.equal(id.city, 'Gaillac');
  assert.equal(id.customer_type, 'individual');
});

test('diff : seuls les champs réellement changés, e-mail insensible à la casse', () => {
  const a = identityFromPlCustomer(PL);
  const b = identityFromPlCustomer({ ...PL, emails: ['TEST-A@example.invalid'], billing_address: { ...PL.billing_address, address: '2 rue du Test' } });
  assert.deepEqual(changedIdentityFields(a, b), ['address']);
  assert.deepEqual(changedIdentityFields(a, a), []);
});

test('push particulier : seules les colonnes modifiées, adresse + complément, e-mails secondaires gardés', () => {
  const client = { first_name: 'JEAN', last_name: 'HELLARD', email: 'new@example.invalid', phone: '0601020304',
    address: '3 chemin Neuf', address_complement: 'Bât B', postal_code: '81600', city: 'Gaillac' };
  const r = buildPlUpdate({ client, columns: ['address_complement', 'email'], plCustomer: PL });
  assert.equal(r.path, '/individual_customers/1571604213760');
  assert.deepEqual(r.body, {
    emails: ['new@example.invalid', 'compta@example.invalid'],
    billing_address: { address: '3 chemin Neuf, Bât B' },
  });
  assert.deepEqual(r.fields, ['email', 'address']);
});

test('push : une valeur MDH vide ne vide jamais Pennylane', () => {
  const r = buildPlUpdate({ client: { phone: '' }, columns: ['phone'], plCustomer: PL });
  assert.equal(r, null);
});

test("push société : endpoint société, jamais de prénom/nom", () => {
  const company = { ...PL, customer_type: 'company' };
  const r = buildPlUpdate({ client: { first_name: 'X', company_name: 'SDIS 81', city: 'Albi' }, columns: ['first_name', 'company_name', 'city'], plCustomer: company });
  assert.equal(r.path, '/company_customers/1571604213760');
  assert.deepEqual(r.body, { name: 'SDIS 81', billing_address: { city: 'Albi' } });
});

test('push : type PL inconnu ⇒ on ne devine pas l\'endpoint', () => {
  assert.equal(buildPlUpdate({ client: { city: 'Albi' }, columns: ['city'], plCustomer: { id: 1 } }), null);
});

test('pull : applique le champ changé dans PL, ignore un vidage', () => {
  const pl = identityFromPlCustomer({ ...PL, phone: '', billing_address: { ...PL.billing_address, city: 'Albi' } });
  const r = planPullUpdate({ changed: ['phone', 'city'], plIdentity: pl, plUpdatedAt: PL.updated_at, client: { city: 'Gaillac', phone: '06' }, pending: null });
  assert.deepEqual(r.apply, { city: 'Albi' });
});

test('pull : écho de « adresse, complément » ⇒ rien à écrire', () => {
  const client = { address: '3 chemin Neuf', address_complement: 'Bât B' };
  const pl = { address: plAddressLine(client), customer_type: 'individual' };
  const r = planPullUpdate({ changed: ['address'], plIdentity: pl, plUpdatedAt: null, client, pending: null });
  assert.deepEqual(r.apply, {});
});

test('conflit : saisie MDH en attente plus récente ⇒ MDH garde, le push repartira', () => {
  const r = planPullUpdate({
    changed: ['address'], plIdentity: { address: '9 rue PL', customer_type: 'individual' },
    plUpdatedAt: '2026-10-11T10:00:00Z', client: { address: '1 rue MDH' },
    pending: { address: '2026-10-11T11:00:00Z' },
  });
  assert.deepEqual(r.apply, {});
  assert.deepEqual(r.conflictsKeptMdh, ['address']);
});

test('conflit : modification PL plus récente ⇒ PL gagne et la saisie en attente tombe', () => {
  const r = planPullUpdate({
    changed: ['address'], plIdentity: { address: '9 rue PL', customer_type: 'individual' },
    plUpdatedAt: '2026-10-11T12:00:00Z', client: { address: '1 rue MDH', address_complement: 'Bât B' },
    pending: { address_complement: '2026-10-11T11:00:00Z' },
  });
  assert.deepEqual(r.apply, { address: '9 rue PL' });
  assert.deepEqual(r.dropPending, ['address_complement']);
});

test('pull société : prénom/nom PL ignorés', () => {
  const r = planPullUpdate({ changed: ['first_name'], plIdentity: { first_name: 'X', customer_type: 'company' }, plUpdatedAt: null, client: {}, pending: null });
  assert.deepEqual(r.apply, {});
});

test('colonnes modifiées côté MDH', () => {
  assert.deepEqual(
    changedPushableColumns({ city: 'Gaillac', notes: 'a', phone: null }, { city: 'Albi', notes: 'b', phone: '' }),
    ['city'],
  );
});
