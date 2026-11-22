// Chapitres de Réglages → E-mails & SMS : node --test scripts/chapitres-communication.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  CHAPITRES, CHAPITRE_PAR_DEFAUT, PAGE_COMMUNICATION,
  chapitresOuverts, chapitreActif, parametresDuChapitre, lienChapitre,
} from '../src/lib/chapitresCommunication.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (...p) => readFileSync(path.join(racine, ...p), 'utf8');

test('cinq chapitres, le premier est celui par défaut', () => {
  assert.deepEqual(CHAPITRES.map((c) => c.key), ['expediteur', 'habillage', 'automatiques', 'sequences', 'sms']);
  assert.equal(CHAPITRES[0].key, CHAPITRE_PAR_DEFAUT);
});

test('sans le module Communication : expéditeur et SMS seulement', () => {
  assert.deepEqual(chapitresOuverts(false).map((c) => c.key), ['expediteur', 'sms']);
  assert.deepEqual(chapitresOuverts(undefined).map((c) => c.key), ['expediteur', 'sms']);
  assert.equal(chapitresOuverts(true).length, 5);
});

test('chapitre affiché : celui demandé s’il est proposé, sinon le premier', () => {
  const tous = chapitresOuverts(true);
  assert.equal(chapitreActif('habillage', tous), 'habillage');
  assert.equal(chapitreActif(null, tous), 'expediteur');
  assert.equal(chapitreActif('inconnu', tous), 'expediteur');
  assert.equal(chapitreActif('habillage', chapitresOuverts(false)), 'expediteur');
  assert.equal(chapitreActif('sms', chapitresOuverts(false)), 'sms');
});

test('ancien lien ?tab=emails : chapitre Expéditeur', () => {
  assert.equal(chapitreActif('emails', chapitresOuverts(true)), 'expediteur');
});

test('adresse d’un chapitre', () => {
  assert.deepEqual(parametresDuChapitre('expediteur'), {});
  assert.deepEqual(parametresDuChapitre('sequences'), { tab: 'sequences' });
  assert.deepEqual(parametresDuChapitre('inconnu'), {});
  assert.equal(lienChapitre('expediteur'), PAGE_COMMUNICATION);
  assert.equal(lienChapitre('habillage'), '/settings/communication?tab=habillage');
});

test('la page et la route existent, l’ancienne adresse des SMS vise un chapitre connu', () => {
  const routes = lire('src', 'apps', 'artisan', 'routes.jsx');
  assert.ok(routes.includes("path: 'settings/communication'"));
  const cibles = [...routes.matchAll(/\/settings\/communication\?tab=([a-z_]+)/g)].map((m) => m[1]);
  for (const cle of cibles) assert.ok(CHAPITRES.some((c) => c.key === cle), cle);
});

test('aucun lien de l’application ne vise un chapitre inconnu ni une ancre', () => {
  const fichiers = [
    ['src', 'apps', 'artisan', 'components', 'mailing', 'page', 'PageMail.jsx'],
    ['src', 'apps', 'artisan', 'components', 'mailing', 'page', 'CarteEnvoi.jsx'],
    ['src', 'apps', 'artisan', 'components', 'mailing', 'page', 'CarteDestinataires.jsx'],
  ];
  for (const f of fichiers) {
    const source = lire(...f);
    assert.ok(!/settings\/communication#/.test(source), `${f.at(-1)} : ancre`);
    for (const m of source.matchAll(/lienChapitre\('([a-z_]+)'\)/g)) {
      assert.ok(CHAPITRES.some((c) => c.key === m[1]), `${f.at(-1)} : ${m[1]}`);
    }
  }
});
