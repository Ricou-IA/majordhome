// node --test scripts/emails-automatiques.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  EMAILS_AUTOMATIQUES, VARIABLES_MARQUE, ESSAI_CODES,
  emailAutomatique, texteEffectif, emailsAffiches, variablesDe, messageErreurEssai,
} from '../src/lib/emailsAutomatiques.js';
import { CATALOGUE } from '../src/lib/modules.js';
import { PROPOSITION_CONTRAT_PLACEHOLDERS_REQUIS, DEFAULT_PROPOSITION_CONTRAT_EMAIL } from '../src/lib/contratEmailTemplates.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (...p) => readFileSync(path.join(racine, ...p), 'utf8');

test('chaque e-mail a une clé unique, un objet, un corps, un titre et une phrase', () => {
  const cles = EMAILS_AUTOMATIQUES.map((e) => e.gabarit.key);
  assert.equal(new Set(cles).size, cles.length);
  for (const e of EMAILS_AUTOMATIQUES) {
    assert.match(e.gabarit.key, /^[a-z0-9_]+$/);
    assert.ok(e.gabarit.subject.trim(), `${e.gabarit.key} : objet`);
    assert.ok(e.gabarit.html_body.trim(), `${e.gabarit.key} : corps`);
    assert.equal(e.gabarit.is_transactional, true, `${e.gabarit.key} : exclu des envois en nombre`);
    assert.ok(e.titre.trim() && e.description.trim(), `${e.gabarit.key} : titre et phrase`);
  }
});

test('un texte par défaut ne cite que des variables connues : celles de l’entreprise ou celles de son exemple', () => {
  for (const e of EMAILS_AUTOMATIQUES) {
    const connues = new Set([...VARIABLES_MARQUE, ...Object.keys(e.exemple)]);
    for (const v of variablesDe(`${e.gabarit.subject}\n${e.gabarit.html_body}`)) {
      assert.ok(connues.has(v), `${e.gabarit.key} cite ${v}, absente de son exemple`);
    }
  }
});

test('un texte par défaut ne nomme aucune entreprise', () => {
  for (const e of EMAILS_AUTOMATIQUES) {
    assert.doesNotMatch(`${e.gabarit.subject} ${e.gabarit.html_body}`, /mayer|gaillac|econhome/i, e.gabarit.key);
  }
});

test('les variables de l’entreprise sont celles que remplit _shared/mail.ts', () => {
  const source = lire('supabase', 'functions', '_shared', 'mail.ts').replace(/\r\n/g, '\n');
  const corps = source.slice(source.indexOf('export function brandingReplacements'));
  const cles = [...corps.slice(0, corps.indexOf('\n}\n')).matchAll(/"(\{\{[A-Z_]+\}\})"/g)].map((m) => m[1]);
  assert.deepEqual([...cles].sort(), [...VARIABLES_MARQUE].sort());
});

test('le module d’un e-mail existe au catalogue', () => {
  const modules = new Set(CATALOGUE.map((m) => m.key));
  for (const e of EMAILS_AUTOMATIQUES) {
    if (e.module) assert.ok(modules.has(e.module), `${e.gabarit.key} → module ${e.module}`);
  }
});

test('la proposition de contrat par défaut porte le montant, l’équipement et le lien', () => {
  for (const v of PROPOSITION_CONTRAT_PLACEHOLDERS_REQUIS) {
    assert.ok(DEFAULT_PROPOSITION_CONTRAT_EMAIL.html_body.includes(v), v);
  }
});

test('texte effectif : celui de l’entreprise s’il est complet, sinon le défaut', () => {
  const perso = texteEffectif({ subject: 'Objet maison', html_body: '<p>Corps maison</p>' }, 'pv_reception');
  assert.deepEqual(perso, { subject: 'Objet maison', html_body: '<p>Corps maison</p>', source: 'entreprise' });

  const defaut = emailAutomatique('pv_reception').gabarit;
  for (const ligne of [null, undefined, { subject: '', html_body: '<p>x</p>' }, { subject: 'Objet', html_body: '  ' }]) {
    assert.deepEqual(texteEffectif(ligne, 'pv_reception'), { subject: defaut.subject, html_body: defaut.html_body, source: 'defaut' });
  }
});

test('texte effectif : une clé hors registre n’a pas de défaut', () => {
  assert.equal(texteEffectif(null, 'webshop_confirmation'), null);
  assert.equal(texteEffectif({ subject: 'S', html_body: 'B' }, 'webshop_confirmation').source, 'entreprise');
  assert.equal(emailAutomatique('inconnu'), null);
});

test('un e-mail dont le module est fermé n’est pas présenté', () => {
  const sansDpe = emailsAffiches((m) => m !== 'dpe').map((e) => e.gabarit.key);
  assert.ok(!sansDpe.includes('rapport_dpe'));
  assert.ok(sansDpe.includes('pv_reception'));
  const rienDOuvert = emailsAffiches(() => false);
  assert.ok(rienDOuvert.length > 0 && rienDOuvert.every((e) => e.module === null));
  assert.equal(emailsAffiches(() => true, { accueilMetaActif: true }).length, EMAILS_AUTOMATIQUES.length);
  assert.ok(!emailsAffiches(() => true).some((e) => e.interrupteur === 'lead_welcome_email'),
    'l’accueil Facebook / Instagram ne s’affiche que pour une entreprise qui l’a allumé');
});

test('essai : les codes de l’edge sont ceux du registre, et un code inconnu a un message', () => {
  const edge = lire('supabase', 'functions', 'email-essai', 'index.ts');
  const codes = new Set([...edge.matchAll(/refus\("([a-z_]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...codes].sort(), Object.keys(ESSAI_CODES).sort());
  assert.equal(messageErreurEssai('no_from_email'), ESSAI_CODES.no_from_email);
  assert.match(messageErreurEssai('envoi_refuse', 'Domaine non vérifié.'), /refusé\. Domaine non vérifié\.$/);
  assert.ok(messageErreurEssai('autre_chose'));
});

test('les edges qui envoient un e-mail du registre lisent le texte par chargerTexteEmail', () => {
  const edges = ['invoice-send', 'auto-rdv', 'auto-rdv-cron', 'chantier-pv', 'dpe-lien', 'sav-report-send', 'lead-welcome-email', 'contract-signed-notify', 'email-essai'];
  for (const nom of edges) {
    const source = lire('supabase', 'functions', nom, 'index.ts');
    assert.match(source, /chargerTexteEmail\(/, `${nom} : chargerTexteEmail`);
    assert.doesNotMatch(source, /from\("majordhome_mail_campaigns"\)/, `${nom} : lecture directe de mail_campaigns`);
  }
});
