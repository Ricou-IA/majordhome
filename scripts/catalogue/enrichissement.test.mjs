// scripts/catalogue/enrichissement.test.mjs
// Enrichissement web d'un article Majord'home (src/lib/catalogue/enrichissement.js) — module PUR, copié pour l'edge
// catalog-item-enrich. Décision d'Eric (2026-10-25) : « l'enrichissement IA WEB doit se faire sur l'article pour
// pouvoir récupérer les photos etc ».
// Run : node --test scripts/catalogue/enrichissement.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  urlPublique, champsDuSchema, construirePromptEnrichissement, lireProposition, estPdf, nomDeFichier,
  fusionnerSpecs, cochesParDefaut, adresseIpPrivee,
} from '../../src/lib/catalogue/enrichissement.js';

const SCHEMA = [
  { key: 'puissance_kw', label: 'Puissance', unit: 'kW', type: 'number', group: 'performance' },
  { key: 'energy_class', label: 'Classe énergétique', type: 'enum', options: ['A++', 'A+', 'A'], group: 'performance' },
  { key: 'wifi', label: 'Wi-Fi', type: 'boolean', group: 'confort' },
  { key: 'mpn', label: 'Référence fabricant', type: 'text', group: 'identity' },
  { key: 'fiche_technique_fr', label: 'Fiche technique (lien)', type: 'text', group: 'documents' },
];
const CHAMPS = champsDuSchema(SCHEMA);

test('urlPublique : http(s) vers un nom de domaine public seulement', () => {
  assert.equal(urlPublique('https://www.v2charge.com/fr/fiche.pdf'), true);
  assert.equal(urlPublique('http://www.exemple.fr/a.pdf'), true);
  for (const u of [
    'http://localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://10.0.0.5/a', 'https://169.254.169.254/latest',
    'ftp://exemple.fr/a', 'https://user:pw@exemple.fr/', 'https://exemple.fr:8443/', 'javascript:alert(1)',
    'https://intranet/x', 'https://metadata.google.internal/', 'https://db.local/x', '', null, 'pas une url',
  ]) assert.equal(urlPublique(u), false, String(u));
});

test('champsDuSchema : clé, libellé, unité, type, options ; le groupe « documents » est écarté (la fiche va aux documents)', () => {
  assert.deepEqual(CHAMPS.map((c) => c.key), ['puissance_kw', 'energy_class', 'wifi', 'mpn']);
  assert.deepEqual(CHAMPS[1], { key: 'energy_class', label: 'Classe énergétique', unit: null, type: 'enum', options: ['A++', 'A+', 'A'] });
});

test('construirePromptEnrichissement : l\'article, ses références et chaque champ attendu ; contrat JSON', () => {
  const p = construirePromptEnrichissement(
    { name: 'Borne V2C Trydan 7,4 kW', brand: 'V2C', gamme: 'Trydan', model_key: 'TRY321SOF', references: ['TRY32-1-SO-F', '41-122029'] },
    CHAMPS,
  );
  for (const attendu of ['Borne V2C Trydan 7,4 kW', 'V2C', 'TRY32-1-SO-F', '41-122029', 'puissance_kw', 'kW', 'A++', '"photo_url"', '"fiche_url"', '"source_url"', 'PDF']) {
    assert.ok(p.includes(attendu), `prompt sans « ${attendu} »`);
  }
});

test('lireProposition : JSON dans un bloc de code, specs converties selon leur type, clés inconnues et vides écartées', () => {
  const texte = 'Voici ce que j\'ai trouvé.\n```json\n{"photo_url":"https://cdn.v2c.com/trydan.png","fiche_url":"https://v2c.com/trydan-fr.pdf",'
    + '"source_url":"https://v2c.com/trydan","specs":{"puissance_kw":"7,4 kW","energy_class":"a+","wifi":"oui","mpn":"  TRY32-1-SO-F ","inconnue":"x","poids":null},'
    + '"remarque":"Fiche officielle du fabricant"}\n```';
  const r = lireProposition(texte, CHAMPS);
  assert.equal(r.erreur, undefined);
  assert.equal(r.photo_url, 'https://cdn.v2c.com/trydan.png');
  assert.equal(r.fiche_url, 'https://v2c.com/trydan-fr.pdf');
  assert.equal(r.source_url, 'https://v2c.com/trydan');
  assert.deepEqual(r.specs, { puissance_kw: 7.4, energy_class: 'A+', wifi: true, mpn: 'TRY32-1-SO-F' });
  assert.equal(r.remarque, 'Fiche officielle du fabricant');
});

test('lireProposition : URL privée ou non http ⇒ écartée ; valeur hors liste ou nombre illisible ⇒ écartée', () => {
  const r = lireProposition('{"photo_url":"http://localhost/a.png","fiche_url":"file:///etc/passwd","specs":{"energy_class":"G","puissance_kw":"beaucoup","wifi":"peut-être"}}', CHAMPS);
  assert.equal(r.photo_url, null);
  assert.equal(r.fiche_url, null);
  assert.deepEqual(r.specs, {});
});

test('lireProposition : réponse sans JSON ⇒ erreur « reponse_illisible », jamais d\'exception', () => {
  assert.equal(lireProposition('Je n\'ai rien trouvé.', CHAMPS).erreur, 'reponse_illisible');
  assert.equal(lireProposition('{"photo_url": ', CHAMPS).erreur, 'reponse_illisible');
  assert.equal(lireProposition('', CHAMPS).erreur, 'reponse_illisible');
});

test('estPdf : les octets commencent par « %PDF- »', () => {
  assert.equal(estPdf(new TextEncoder().encode('%PDF-1.7\n...')), true);
  assert.equal(estPdf(new TextEncoder().encode('<!DOCTYPE html>')), false);
  assert.equal(estPdf(new Uint8Array()), false);
});

test('nomDeFichier : dernier segment décodé, extension .pdf garantie', () => {
  assert.equal(nomDeFichier('https://x.com/docs/Fiche%20Trydan.pdf?v=2'), 'Fiche Trydan.pdf');
  assert.equal(nomDeFichier('https://x.com/telecharger?id=12', 'Fiche technique V2C'), 'Fiche technique V2C.pdf');
  assert.equal(nomDeFichier('https://x.com/docs/trydan'), 'trydan.pdf');
});

test('fusionnerSpecs : les caractéristiques acceptées remplacent, les autres restent, rien n\'est muté', () => {
  const avant = { puissance_kw: 7, mpn: 'ABC' };
  const apres = fusionnerSpecs(avant, { puissance_kw: 7.4, wifi: true });
  assert.deepEqual(apres, { puissance_kw: 7.4, mpn: 'ABC', wifi: true });
  assert.deepEqual(avant, { puissance_kw: 7, mpn: 'ABC' });
});

test('cochesParDefaut : seules les valeurs proposées pour un champ vide sont cochées d\'office', () => {
  const coches = cochesParDefaut({ puissance_kw: 7, mpn: '', wifi: null }, { puissance_kw: 7.4, mpn: 'TRY', wifi: true, energy_class: 'A' });
  assert.deepEqual([...coches].sort(), ['energy_class', 'mpn', 'wifi']);
});

test("urlPublique : nom à point final et services DNS qui pointent vers une adresse choisie ⇒ refusés", () => {
  for (const u of ["http://localhost./", "https://exemple.fr./a.pdf", "https://127.0.0.1.nip.io/", "https://169.254.169.254.nip.io/latest",
    "https://10.0.0.1.sslip.io/", "https://localtest.me/", "https://app.localtest.me/", "https://x.lvh.me/"]) {
    assert.equal(urlPublique(u), false, u);
  }
  assert.equal(urlPublique("https://cdn.v2charge.com/trydan.png"), true);
});

test("adresseIpPrivee : bouclage, privées, link-local, CGNAT, multicast, IPv6 locales et mappées ⇒ vrai ; publiques ⇒ faux", () => {
  for (const ip of ["127.0.0.1", "10.2.3.4", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "pas une ip"]) {
    assert.equal(adresseIpPrivee(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "151.101.1.69", "2606:4700::6810:84e5", "::ffff:8.8.8.8"]) {
    assert.equal(adresseIpPrivee(ip), false, ip);
  }
});
