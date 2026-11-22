import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { messageriePublique, resoudreExpediteur, partieLocale, domaineVerifie, lireAdresse, domaineDe, EXPEDITEUR_REFUS } from '../src/lib/expediteur.js';
import { valeursDeMarque } from '../src/lib/mailHabillage.js';

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
  assert.equal(r.from, 'Cimaj <cimaj@envoi.exemple.fr>', 'une adresse au nom de l’entreprise, sur le domaine commun');
  assert.equal(r.fromEmail, 'cimaj@envoi.exemple.fr');
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
  assert.match(r.fromEmail, /^[a-z0-9-]+@envoi\.exemple\.fr$/);
});

test('ce qui précède le « @ » vient du nom de l’entreprise, jamais d’une saisie libre', () => {
  assert.equal(partieLocale('Habitat & Énergies'), 'habitat-energies');
  assert.equal(partieLocale('  CIMAJ  '), 'cimaj');
  assert.equal(partieLocale('---'), '');
  assert.equal(partieLocale(null), '');
  assert.ok(partieLocale('a'.repeat(80)).length <= 40);
  // from_name ne compte pas : seul le nom de l'entreprise fait l'adresse.
  const r = resoudreExpediteur({ from_name: 'Mayer', brand_name: 'Cimaj', from_email: 'c@cimaj.fr' }, { plateforme: PLATEFORME });
  assert.equal(r.fromEmail, 'cimaj@envoi.exemple.fr');
});

test('lecture d’une adresse', () => {
  assert.deepEqual(lireAdresse('Nom <a@b.fr>'), { nom: 'Nom', adresse: 'a@b.fr' });
  assert.deepEqual(lireAdresse(' a@b.fr '), { nom: '', adresse: 'a@b.fr' });
  assert.deepEqual(lireAdresse('rien'), { nom: '', adresse: '' });
  assert.equal(domaineDe('a@B.fr'), 'b.fr');
  assert.equal(domaineDe('a@b'), '');
});

test('une messagerie grand public n’est pas un domaine à configurer', () => {
  assert.equal(messageriePublique('jean@Hotmail.fr'), true);
  assert.equal(messageriePublique('jean@gmail.com'), true);
  assert.equal(messageriePublique('contact@dupont.fr'), false);
  assert.equal(messageriePublique(''), false);
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
  // Une edge qui passe par orgBranding n'écrit pas {{ORG_EMAIL}} avec l'adresse d'envoi : ses valeurs de marque
  // viennent de `valeursDeMarque`, où {{ORG_EMAIL}} est l'adresse de l'entreprise (`contactEmail`).
  assert.match(lire('_shared/mail.ts'), /valeursDeMarque\(b\.reglages\)/);
  assert.match(lire('../../src/lib/mailHabillage.js'), /'\{\{ORG_EMAIL\}\}': resoudreExpediteur\(s\)\.contactEmail/);
  const sur = { from_email: 'contact@dupont.fr', resend: { status: 'verified', domain: 'dupont.fr' } };
  assert.equal(valeursDeMarque(sur)['{{ORG_EMAIL}}'], 'contact@dupont.fr');
  assert.equal(valeursDeMarque({ from_email: 'contact@cimaj.fr' })['{{ORG_EMAIL}}'], 'contact@cimaj.fr');
});
