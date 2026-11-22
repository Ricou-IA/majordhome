import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adresseDeLienValide } from '../src/lib/mailLien.js';
import { normaliser } from '../src/lib/mailCorps.js';

const LIENS = ['{{LIEN_PV}}', '{{ORG_WEBSITE_URL}}'];

const VALIDES = ['https://ex.fr', 'http://ex.fr', 'mailto:a@ex.fr', 'tel:+33612345678', '{{LIEN_PV}}', '  https://ex.fr/contact  '];
const INVALIDES = ['', '   ', 'javascript:alert(1)', 'ex.fr', '{{ORG_WEBSITE_URL}}/contact', '{{LIEN_PV}}{{ORG_WEBSITE_URL}}',
  'https://ex.fr/{{LIEN_PV}}', '{{CLIENT_NAME}}', 'data:text/html,x', 'https://ex.\u0007fr',
  'https://', 'http://', 'mailto:', 'tel:', 'HTTPS://  ', 'https://ex fr'];

const garde = (adresse) => /<a /.test(normaliser(`<p><a href="${adresse}">x</a></p>`));

test('adresses acceptées : https, http, mailto, tel, une adresse proposée seule', () => {
  for (const a of VALIDES) {
    const r = adresseDeLienValide(a, LIENS);
    assert.equal(r.valide, true, a);
    assert.equal(r.adresse, a.trim());
  }
});

test('adresses refusées, avec une phrase', () => {
  for (const a of INVALIDES) {
    const r = adresseDeLienValide(a, LIENS);
    assert.equal(r.valide, false, a);
    assert.ok(r.message && !/variable|balise|html|\{\{/i.test(r.message), `${a} : ${r.message}`);
  }
});

test('une adresse sans « https:// » est refusée avec une suggestion valable', () => {
  const r = adresseDeLienValide('ex.fr', LIENS);
  assert.equal(r.suggestion, 'https://ex.fr');
  assert.equal(adresseDeLienValide('www.ex.fr/devis', LIENS).suggestion, 'https://www.ex.fr/devis');
  assert.equal(adresseDeLienValide('a@ex.fr', LIENS).suggestion, 'mailto:a@ex.fr');
  assert.equal(adresseDeLienValide('06 12 34 56 78', LIENS).suggestion, 'tel:0612345678');
  for (const s of ['ex.fr', 'a@ex.fr', '06 12 34 56 78']) {
    assert.equal(adresseDeLienValide(adresseDeLienValide(s, LIENS).suggestion, LIENS).valide, true, s);
  }
  assert.equal(adresseDeLienValide('javascript:alert(1)', LIENS).suggestion, undefined);
});

test('une adresse proposée suivie d’un texte : on demande l’adresse complète', () => {
  const r = adresseDeLienValide('{{ORG_WEBSITE_URL}}/contact', LIENS);
  assert.match(r.message, /adresse complète/);
});

test('accord avec normaliser : une adresse acceptée garde son lien, une adresse refusée le perd', () => {
  for (const a of VALIDES) assert.equal(garde(a.trim()), true, a);
  // Deux écarts voulus, où la fenêtre est plus stricte que `normaliser` (qui garderait le lien) :
  // `{{CLIENT_NAME}}` n'est pas une adresse ; `https://ex.fr/{{LIEN_PV}}` mêle une adresse proposée et
  // du texte, et deviendrait une adresse double à l'envoi.
  // Et une adresse réduite à son début (`https://`, `mailto:`…) ou une adresse web avec une espace : `normaliser`
  // garderait un lien vide ou cassé.
  const PLUS_STRICTS = new Set(['{{CLIENT_NAME}}', 'https://ex.fr/{{LIEN_PV}}', 'https://', 'http://', 'mailto:', 'tel:',
    'HTTPS://  ', 'https://ex fr']);
  for (const a of INVALIDES.filter((x) => !PLUS_STRICTS.has(x))) assert.equal(garde(a), false, a);
  for (const a of PLUS_STRICTS) assert.equal(garde(a), true, a);
  // Un numéro écrit avec ses espaces reste accepté : seule l'adresse web refuse une espace.
  assert.equal(adresseDeLienValide('tel:+33 6 12 34 56 78', LIENS).valide, true);
});

test('la liste des adresses proposées accepte des jetons ou des objets { nom }', () => {
  assert.equal(adresseDeLienValide('{{LIEN_PV}}', [{ nom: '{{LIEN_PV}}' }]).valide, true);
  assert.equal(adresseDeLienValide('{{LIEN_PV}}', []).valide, false);
});
