// scripts/aspirateur/domaine.test.mjs — domaines autorisés du navigateur de l'aspirateur (src/lib/aspirateur/domaine.js).
// Run : node --test scripts/aspirateur/domaine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliserDomaine, domaineEnregistrable, urlAutorisee } from '../../src/lib/aspirateur/domaine.js';

test('normaliserDomaine : hôte exact en minuscules, https seulement', () => {
  assert.equal(normaliserDomaine('https://pro.invicta-group.fr/'), 'pro.invicta-group.fr');
  assert.equal(normaliserDomaine('https://PRO.Invicta-Group.fr/catalogue?x=1'), 'pro.invicta-group.fr');
  assert.equal(normaliserDomaine('http://pro.invicta-group.fr/'), null);
  assert.equal(normaliserDomaine('pas une url'), null);
  assert.equal(normaliserDomaine(null), null);
});

test('domaineEnregistrable : deux derniers libellés', () => {
  assert.equal(domaineEnregistrable('cdn.prod.platform.invicta-group.fr'), 'invicta-group.fr');
  assert.equal(domaineEnregistrable('invicta-group.fr'), 'invicta-group.fr');
});

test('urlAutorisee : même domaine enregistrable, https', () => {
  assert.equal(urlAutorisee('https://cdn.prod.platform.invicta-group.fr/media/x.pdf', 'pro.invicta-group.fr'), true);
  assert.equal(urlAutorisee('https://pro.invicta-group.fr/produit/1', 'pro.invicta-group.fr'), true);
  assert.equal(urlAutorisee('http://pro.invicta-group.fr/produit/1', 'pro.invicta-group.fr'), false);
  assert.equal(urlAutorisee('https://evil.example/x?u=pro.invicta-group.fr', 'pro.invicta-group.fr'), false);
  assert.equal(urlAutorisee('https://invicta-group.fr.evil.example/', 'pro.invicta-group.fr'), false);
  assert.equal(urlAutorisee('https://evilinvicta-group.fr/', 'pro.invicta-group.fr'), false);
  assert.equal(urlAutorisee('javascript:alert(1)', 'pro.invicta-group.fr'), false);
});
