import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resoudreExpediteur, domaineVerifie, lireAdresse, domaineDe, EXPEDITEUR_REFUS } from '../src/lib/expediteur.js';

const VERIFIE = {
  brand_name: 'Dupont Chauffage', from_email: 'contact@dupont.fr', reply_to: 'bureau@dupont.fr',
  resend: { status: 'verified', domain: 'dupont.fr' },
};
const NOUVELLE = { brand_name: 'Cimaj', from_email: 'contact@cimaj.fr' };
const PLATEFORME = 'notifications@envoi.exemple.fr';

test('domaine vérifié : l’adresse de l’entreprise, quel que soit l’usage', () => {
  for (const usage of ['individuel', 'nombre']) {
    const r = resoudreExpediteur(VERIFIE, { usage, plateforme: PLATEFORME });
    assert.equal(r.refus, null);
    assert.equal(r.mode, 'domaine');
    assert.equal(r.from, 'Dupont Chauffage <contact@dupont.fr>');
    assert.equal(r.replyTo, 'bureau@dupont.fr');
    assert.equal(r.contactEmail, 'contact@dupont.fr');
  }
});

test('domaine non vérifié, e-mail individuel : adresse commune au nom de l’entreprise, réponse chez elle', () => {
  const r = resoudreExpediteur(NOUVELLE, { plateforme: PLATEFORME });
  assert.equal(r.mode, 'plateforme');
  assert.equal(r.from, 'Cimaj <notifications@envoi.exemple.fr>');
  assert.equal(r.fromEmail, 'notifications@envoi.exemple.fr');
  assert.equal(r.replyTo, 'contact@cimaj.fr');
  assert.equal(r.contactEmail, 'contact@cimaj.fr');
});

test('domaine non vérifié, envoi en nombre : refusé, avec ou sans adresse commune', () => {
  assert.equal(resoudreExpediteur(NOUVELLE, { usage: 'nombre', plateforme: PLATEFORME }).refus, 'domaine_requis');
  assert.equal(resoudreExpediteur(NOUVELLE, { usage: 'nombre' }).refus, 'domaine_requis');
});

test('sans adresse commune : rien ne change, l’e-mail part de l’adresse de l’entreprise', () => {
  const r = resoudreExpediteur(NOUVELLE, {});
  assert.equal(r.mode, 'non_verifie');
  assert.equal(r.from, 'Cimaj <contact@cimaj.fr>');
  assert.equal(resoudreExpediteur(NOUVELLE, { plateforme: 'pas une adresse' }).mode, 'non_verifie');
});

test('aucune adresse de l’entreprise : refus, jamais un envoi dont la réponse se perd', () => {
  const r = resoudreExpediteur({ brand_name: 'Cimaj' }, { plateforme: PLATEFORME });
  assert.equal(r.refus, 'no_from_email');
  assert.equal(r.from, '');
  assert.equal(resoudreExpediteur(null, { plateforme: PLATEFORME }).refus, 'no_from_email');
});

test('adresse de réponse seule : elle sert de contact et de réponse', () => {
  const r = resoudreExpediteur({ reply_to: 'bureau@cimaj.fr' }, { plateforme: `Majordhome <${PLATEFORME}>` });
  assert.equal(r.replyTo, 'bureau@cimaj.fr');
  assert.equal(r.from, `Majordhome <${PLATEFORME}>`, 'sans nom d’entreprise, le nom de la plateforme');
});

test('un statut « vérifié » ne vaut que pour le domaine de l’adresse d’envoi', () => {
  assert.equal(domaineVerifie(VERIFIE), true);
  assert.equal(domaineVerifie({ ...VERIFIE, from_email: 'contact@autre.fr' }), false);
  assert.equal(domaineVerifie({ ...VERIFIE, resend: { status: 'pending', domain: 'dupont.fr' } }), false);
  assert.equal(domaineVerifie({ ...VERIFIE, from_email: 'Contact@DUPONT.fr' }), true);
  assert.equal(domaineVerifie({}), false);
});

test('un nom ne peut pas forger un en-tête', () => {
  const r = resoudreExpediteur({ ...NOUVELLE, brand_name: 'Cimaj" <x@y.fr>\r\nBcc: z@y.fr' }, { plateforme: PLATEFORME });
  assert.ok(!/[\r\n"]/.test(r.from));
  assert.equal((r.from.match(/</g) || []).length, 1);
  assert.ok(r.from.endsWith(`<${PLATEFORME}>`));
});

test('lecture d’une adresse', () => {
  assert.deepEqual(lireAdresse('Nom <a@b.fr>'), { nom: 'Nom', adresse: 'a@b.fr' });
  assert.deepEqual(lireAdresse(' a@b.fr '), { nom: '', adresse: 'a@b.fr' });
  assert.deepEqual(lireAdresse('rien'), { nom: '', adresse: '' });
  assert.equal(domaineDe('a@B.fr'), 'b.fr');
  assert.equal(domaineDe('a@b'), '');
});

test('chaque refus a son message', () => {
  for (const code of ['no_from_email', 'domaine_requis']) assert.ok(EXPEDITEUR_REFUS[code]);
});

test('les edges ne fabriquent plus leur expéditeur à part', () => {
  const lire = (f) => readFileSync(new URL(`../supabase/functions/${f}`, import.meta.url), 'utf8');
  assert.match(lire('_shared/mail.ts'), /resoudreExpediteur/);
  for (const edge of ['mailing-send/index.ts', 'contract-signed-notify/index.ts']) {
    assert.match(lire(edge), /resoudreExpediteur|expediteurDe/, `${edge} passe par le module`);
  }
  // Une edge qui passe par orgBranding n'écrit pas {{ORG_EMAIL}} avec l'adresse d'envoi.
  assert.match(lire('_shared/mail.ts'), /"\{\{ORG_EMAIL\}\}": b\.contactEmail/);
});
