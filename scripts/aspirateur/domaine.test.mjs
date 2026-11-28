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

test('relecture C1/I3 : adresse IP et nom sans point refusés comme site', () => {
  assert.equal(normaliserDomaine('https://172.18.0.1/'), null);
  assert.equal(normaliserDomaine('https://[::1]/'), null);
  assert.equal(normaliserDomaine('https://localhost/'), null);
  assert.equal(urlAutorisee('https://10.0.0.1/x', 'pro.invicta-group.fr'), false);
});

test('relecture I3 : hébergeurs partagés, le domaine enregistrable garde trois libellés', () => {
  assert.equal(domaineEnregistrable('boutique.myshopify.com'), 'boutique.myshopify.com');
  assert.equal(domaineEnregistrable('cdn.boutique.myshopify.com'), 'boutique.myshopify.com');
  assert.equal(urlAutorisee('https://autre.myshopify.com/', 'boutique.myshopify.com'), false);
  assert.equal(urlAutorisee('https://seau.s3.amazonaws.com/x', 'x.s3.amazonaws.com'), false);
  assert.equal(domaineEnregistrable('www.exemple.co.uk'), 'exemple.co.uk');
});

test('relecture I9 : robots.txt (groupe « * »), chemins interdits et autorisés', async () => {
  const { cheminAutorise } = await import('../../src/lib/aspirateur/domaine.js');
  const robots = 'User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /prive/\nDisallow: /recherche\nAllow: /prive/public/\n# commentaire\n';
  assert.equal(cheminAutorise(robots, '/produit/1'), true);
  assert.equal(cheminAutorise(robots, '/prive/x'), false);
  assert.equal(cheminAutorise(robots, '/prive/public/fiche'), true);
  assert.equal(cheminAutorise(robots, '/recherche?q=x'), false);
  assert.equal(cheminAutorise('', '/x'), true);
  assert.equal(cheminAutorise('User-agent: *\nDisallow:\n', '/x'), true);
});
