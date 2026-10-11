// scripts/device-viewport.test.mjs — classification d'appareil (src/lib/deviceViewport.js)
// node --test scripts/device-viewport.test.mjs
//
// Un téléphone classé tablette est rendu à 38 % d'échelle (viewport forcé à
// 1024 px) : rien n'est lisible ni tapable. Ce test fige les trois familles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDevice, PHONE_MAX_SHORT_EDGE, TABLET_VIEWPORT_WIDTH } from '../src/lib/deviceViewport.js';

const ANDROID_PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36';
const ANDROID_TABLET_UA = 'Mozilla/5.0 (Linux; Android 13; RT3 Pro) AppleWebKit/537.36 Chrome/128.0 Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';

test('un PC sans tactile est desktop quelle que soit sa taille', () => {
  assert.equal(classifyDevice({ touch: false, shortEdge: 390, longEdge: 844, userAgent: ANDROID_PHONE_UA }), 'desktop');
  assert.equal(classifyDevice({ touch: false, shortEdge: 1080, longEdge: 1920 }), 'desktop');
});

test('un téléphone Android ou un iPhone est phone (marqueur Mobi)', () => {
  assert.equal(classifyDevice({ touch: true, shortEdge: 412, longEdge: 915, userAgent: ANDROID_PHONE_UA }), 'phone');
  assert.equal(classifyDevice({ touch: true, shortEdge: 390, longEdge: 844, userAgent: IPHONE_UA }), 'phone');
});

test('sans user-agent, le bord court tranche', () => {
  assert.equal(classifyDevice({ touch: true, shortEdge: PHONE_MAX_SHORT_EDGE - 1, longEdge: 900 }), 'phone');
  assert.equal(classifyDevice({ touch: true, shortEdge: PHONE_MAX_SHORT_EDGE, longEdge: 900 }), 'tablet');
});

test('la tablette durcie 8" reste tablette (dézoom conservé)', () => {
  assert.equal(classifyDevice({ touch: true, shortEdge: 600, longEdge: 960, userAgent: ANDROID_TABLET_UA }), 'tablet');
  assert.equal(classifyDevice({ touch: true, shortEdge: 800, longEdge: 1000, userAgent: ANDROID_TABLET_UA }), 'tablet');
});

test('un grand écran tactile est desktop (déjà au-dessus du breakpoint lg)', () => {
  assert.equal(classifyDevice({ touch: true, shortEdge: 810, longEdge: TABLET_VIEWPORT_WIDTH, userAgent: IPAD_UA }), 'desktop');
  assert.equal(classifyDevice({ touch: true, shortEdge: 1080, longEdge: 1920 }), 'desktop');
});
