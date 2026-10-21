import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  phoneTailKey,
  phoneSearchPatterns,
  buildClientDuplicateProbe,
  matchClientDuplicates,
  hasStrongDuplicate,
} from '../src/lib/clientDuplicateMatch.js';

// ERNY (2026-09-22) : fiche importée Econhome recréée à l'identique depuis l'appli.
const ERNY_IMPORT = {
  id: 'a',
  first_name: 'LAURENT',
  last_name: 'ERNY',
  phone: '06 77 03 73 20',
  email: 'laurent.erny@gmail.com',
  postal_code: '81000',
};

test('phoneTailKey — formats FR et Pennylane sans 0 vers la même clé', () => {
  assert.equal(phoneTailKey('06 77 03 73 20'), '677037320');
  assert.equal(phoneTailKey('+33 6 77 03 73 20'), '677037320');
  assert.equal(phoneTailKey('06.77.03.73.20'), '677037320');
  assert.equal(phoneTailKey('677037320'), '677037320');
  assert.equal(phoneTailKey('06 77'), null);
  assert.equal(phoneTailKey(null), null);
});

test('phoneSearchPatterns — 8 derniers chiffres bruts, espacés, pointés', () => {
  assert.deepEqual(phoneSearchPatterns('677037320'), ['77037320', '77 03 73 20', '77.03.73.20']);
  assert.deepEqual(phoneSearchPatterns(null), []);
});

test('buildClientDuplicateProbe — null sans axe exploitable', () => {
  assert.equal(buildClientDuplicateProbe({}), null);
  assert.equal(buildClientDuplicateProbe({ lastName: 'ERNY' }), null);
  assert.ok(buildClientDuplicateProbe({ lastName: 'ERNY', postalCode: '81000' }));
  assert.ok(buildClientDuplicateProbe({ phone: '0677037320' }));
});

test('ERNY — même téléphone et même email : rapprochement fort', () => {
  const probe = buildClientDuplicateProbe({
    firstName: 'Laurent', lastName: 'Erny', phone: '06 77 03 73 20',
    email: ' Laurent.Erny@gmail.com ', postalCode: '81000',
  });
  const [m] = matchClientDuplicates([ERNY_IMPORT], probe);
  assert.deepEqual(m.matchReasons, ['phone', 'email', 'name']);
  assert.equal(m.isStrong, true);
  assert.equal(hasStrongDuplicate([m]), true);
});

test('téléphone secondaire du candidat ou de la saisie compte', () => {
  const probe = buildClientDuplicateProbe({ phoneSecondary: '+33677037320' });
  const m = matchClientDuplicates([{ ...ERNY_IMPORT, phone: null, phone_secondary: '0677037320' }], probe);
  assert.deepEqual(m[0].matchReasons, ['phone']);
});

test('nom + prénom sans accent : faible', () => {
  const probe = buildClientDuplicateProbe({ firstName: 'Aurélie', lastName: 'Motte' });
  const m = matchClientDuplicates([{ id: 'b', first_name: 'AURELIE', last_name: 'MOTTE' }], probe);
  assert.deepEqual(m[0].matchReasons, ['name']);
  assert.equal(m[0].isStrong, false);
  assert.equal(hasStrongDuplicate(m), false);
});

test('même nom dans le même code postal : faible ; autre CP : rien', () => {
  const probe = buildClientDuplicateProbe({ firstName: 'Christiane', lastName: 'Erny', postalCode: '81000' });
  assert.deepEqual(matchClientDuplicates([ERNY_IMPORT], probe)[0].matchReasons, ['name_cp']);
  const ailleurs = buildClientDuplicateProbe({ firstName: 'Christiane', lastName: 'Erny', postalCode: '31000' });
  assert.deepEqual(matchClientDuplicates([ERNY_IMPORT], ailleurs), []);
});

test('faux positif de la requête large écarté, forts triés en tête', () => {
  const probe = buildClientDuplicateProbe({ firstName: 'Laurent', lastName: 'Erny', phone: '0677037320' });
  const m = matchClientDuplicates([
    { id: 'homonyme', first_name: 'LAURENT', last_name: 'ERNY', phone: '0611111111' },
    { id: 'autre', first_name: 'PAUL', last_name: 'DURAND', phone: '0699037320' },
    ERNY_IMPORT,
  ], probe);
  assert.deepEqual(m.map((c) => c.id), ['a', 'homonyme']);
});
