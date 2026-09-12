// scripts/souplesse.test.mjs — Run : node --test scripts/souplesse.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libelleSouplesse, souplesseEffective, phraseAnnonce } from '../src/lib/souplesse.js';

test('libellés et souplesse effective', () => {
  assert.equal(libelleSouplesse(0), 'figé');
  assert.equal(libelleSouplesse(30), '±30 min');
  assert.equal(libelleSouplesse(240), 'demi-journée');
  assert.equal(souplesseEffective({ time_flex_minutes: 30, hour_confirmed_at: '2026-09-12' }), 0);
  assert.equal(souplesseEffective({ time_flex_minutes: null }, 30), 30);
  assert.equal(souplesseEffective({ time_flex_minutes: 15 }, 30), 15);
});

test('phrase d annonce au client', () => {
  assert.equal(phraseAnnonce({ startTime: '08:15' }, 30, 'mar. 14 oct.'), 'mar. 14 oct. vers 08:15 (entre 07:45 et 08:45)');
  assert.equal(phraseAnnonce({ startTime: '14:00' }, 0, 'mar. 14 oct.'), 'mar. 14 oct. à 14:00 — heure ferme');
  assert.equal(phraseAnnonce({ startTime: '09:30' }, 240, 'mar. 14 oct.'), 'mar. 14 oct., dans la matinée (heure précisée la veille)');
});
