import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  habillerMail, valeursDeMarque, couleurValide, lireHabillage, choixDepuisReglages, aDejaDesabonnement,
  HABILLAGE_DEFAUT, DEFAUTS_MARQUE,
} from '../src/lib/mailHabillage.js';
import { VARIABLES_MARQUE } from '../src/lib/emailsAutomatiques.js';

const S = '<html><body>T{{LOGO_URL}}<div>{{EMAIL_BODY}}</div></body></html>';
const MAL_FORMEES = ['orange', '#12', 'red;}', '"><script>'];

test('page complète : rendue telle quelle', () => {
  const page = '<!DOCTYPE html><html><body>x</body></html>';
  assert.equal(habillerMail({ email_habillage: HABILLAGE_DEFAUT }, page), page);
});

test('ancien habillage sans email_habillage : identique à aujourd\'hui', () => {
  assert.equal(habillerMail({ email_skeleton_html: S }, '<p>a</p>'), S.replace('{{EMAIL_BODY}}', '<p>a</p>'));
});

test('email_habillage prime sur l\'ancien habillage ; null y revient', () => {
  assert.ok(!habillerMail({ email_skeleton_html: S, email_habillage: HABILLAGE_DEFAUT }, '<p>a</p>').startsWith('<html><body>T'));
  assert.equal(habillerMail({ email_skeleton_html: S, email_habillage: null }, '<p>a</p>'), S.replace('{{EMAIL_BODY}}', '<p>a</p>'));
});

test('habillage par défaut : un lien de désabonnement, un seul', () => {
  const r = { from_email: 'contact@ex.fr', brand_name: 'Cimaj' };
  assert.equal(habillerMail(r, '<p>a</p>').split('mailto:contact@ex.fr?subject=Désabonnement').length - 1, 1);
  const deja = '<p><a href="mailto:{{ORG_EMAIL}}?subject=Désabonnement">x</a></p>';
  assert.equal(habillerMail(r, deja).split('subject=Désabonnement').length - 1, 1);
});

test('aDejaDesabonnement : avec ou sans accent', () => {
  assert.equal(aDejaDesabonnement('<a href="mailto:a@b.fr?subject=Désabonnement">'), true);
  assert.equal(aDejaDesabonnement('<a href="mailto:a@b.fr?subject=Desabonnement">'), true);
  assert.equal(aDejaDesabonnement('<a href="mailto:a@b.fr?subject=Bonjour">'), false);
});

test('valeurs de marque : clés du registre, défauts neutres, couleur mal formée écartée', () => {
  assert.deepEqual(Object.keys(valeursDeMarque({})).sort(), [...VARIABLES_MARQUE].sort());
  assert.equal(valeursDeMarque({})['{{ACCENT_COLOR}}'], '#64748b');
  assert.equal(valeursDeMarque({})['{{SECONDARY_COLOR}}'], '#334155');
  assert.equal(valeursDeMarque({})['{{BRAND_NAME}}'], '');
  assert.deepEqual(valeursDeMarque(null), valeursDeMarque({}));
  for (const c of MAL_FORMEES) {
    assert.equal(valeursDeMarque({ accent_color: c })['{{ACCENT_COLOR}}'], '#64748b');
    assert.equal(valeursDeMarque({ secondary_color: c })['{{SECONDARY_COLOR}}'], '#334155');
  }
  assert.equal(valeursDeMarque({ accent_color: '#F97316', secondary_color: '#abc' })['{{ACCENT_COLOR}}'], '#F97316');
});

test('couleurValide : #rgb et #rrggbb seulement', () => {
  assert.equal(couleurValide('#abc', 'X'), '#abc');
  assert.equal(couleurValide('#A1b2C3', 'X'), '#A1b2C3');
  for (const c of [...MAL_FORMEES, '#abcd', '#12345g', '', null, undefined, 12]) assert.equal(couleurValide(c, 'X'), 'X');
});

test('une couleur mal formée n\'apparaît jamais dans l\'e-mail construit', () => {
  for (const c of MAL_FORMEES) {
    const r = { accent_color: c, secondary_color: c, email_tagline: 'S', email_habillage: { entete: 'logo_bandeau', pied: { coordonnees: true, certifications: false, site: false } } };
    const h = habillerMail(r, '<p>a</p>');
    assert.ok(!h.includes(c), `couleur ${c} présente`);
    assert.ok(h.includes(DEFAUTS_MARQUE.bandeau));
  }
});

test('nom de l\'entreprise échappé, logo seulement en https, sans logo le nom', () => {
  const h = habillerMail({ brand_name: '<b>X</b>', logo_url: 'javascript:1' }, '<p>a</p>');
  assert.ok(h.includes('&lt;b&gt;X&lt;/b&gt;') && !h.includes('<img'));
  assert.ok(habillerMail({ brand_name: 'X', logo_url: 'https://ex.fr/l.png' }, '<p>a</p>').includes('<img'));
});

test('bandeau et certifications selon les choix', () => {
  const r = { email_tagline: 'Slogan', rge_certifications: ['QualiBois'], email_habillage: { entete: 'logo_bandeau', pied: { coordonnees: true, certifications: true, site: false } } };
  const h = habillerMail(r, '<p>a</p>');
  assert.ok(h.includes('Slogan') && h.includes('QualiBois') && h.includes('#334155'));
  assert.ok(!habillerMail({ ...r, email_habillage: HABILLAGE_DEFAUT }, '<p>a</p>').includes('Slogan'));
});

test('le corps est inséré tel quel, variables comprises', () => {
  const corps = '<p>Bonjour {{CLIENT_NAME}} <b>&amp;</b></p>';
  assert.ok(habillerMail({}, corps).includes(corps));
});

test('lireHabillage : null hors objet, valeurs inconnues ramenées au défaut', () => {
  assert.equal(lireHabillage({}), null);
  assert.equal(lireHabillage({ email_habillage: null }), null);
  assert.equal(lireHabillage({ email_habillage: 'x' }), null);
  assert.deepEqual(lireHabillage({ email_habillage: { entete: 'zzz', pied: { coordonnees: 'oui', site: true } } }), {
    entete: 'logo', pied: { coordonnees: true, certifications: false, site: true },
  });
});

test('choixDepuisReglages : réglages vides, ancien habillage seul, choix enregistré', () => {
  assert.deepEqual(choixDepuisReglages({}), HABILLAGE_DEFAUT);
  assert.deepEqual(choixDepuisReglages(null), HABILLAGE_DEFAUT);
  assert.deepEqual(choixDepuisReglages({ email_skeleton_html: S }), {
    entete: 'logo_bandeau', pied: { coordonnees: true, certifications: false, site: true },
  });
  const enregistre = { entete: 'logo_bandeau', pied: { coordonnees: false, certifications: true, site: false } };
  assert.deepEqual(choixDepuisReglages({ email_skeleton_html: S, email_habillage: enregistre }), enregistre);
});
