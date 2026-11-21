import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CODES_LIAISON, DUREE_REJEU_MS, messageLiaison, lireEtatLiaison, ruptureConnue, corpsEnvoi, lireReponseHesiasun,
  etatApresEnvoi, etatRompu, aRejouer, comparerIdentites, identitePourReglages,
} from '../src/lib/organisation/liaisonHesiasun.js';

const REGLAGES = {
  brand_name: 'Atelier du Chauffage', legal_name: 'ATELIER DU CHAUFFAGE', legal_form: 'SAS', capital: '6 000',
  siret: '100 288 224 00015', tva_intra: 'FR 75 100288224', rcs: '', insurance: '',
  address: '26 rue des Pyrénées', postal_code: '81600', city: 'Gaillac', phone: '05 63 33 23 14',
  website_url: 'https://exemple.fr', signatory_name: 'Jean MARTIN', signatory_role: 'Président',
  from_email: 'contact@exemple.fr',
};
const LIAISON = '11111111-1111-4111-8111-111111111111';
const ETAT = { liaison_id: LIAISON, relie_le: '2026-11-21T10:00:00Z', entreprise: 'Atelier', ouverte: true, dernier_envoi_le: null, erreur: null, erreur_champs: null, en_attente: false, en_attente_depuis: null };

test('chaque code rendu par l’edge a son message', () => {
  const edge = readFileSync(new URL('../supabase/functions/_shared/hesiasunIdentite.ts', import.meta.url), 'utf8')
    + readFileSync(new URL('../supabase/functions/hesiasun-identite/index.ts', import.meta.url), 'utf8');
  const codes = new Set([...edge.matchAll(/(?:refus\(|repondre\((?:null|[^,()]+), )"([a-z_]+)"/g)].map((m) => m[1]));
  assert.ok(codes.size >= 5, 'aucun code lu dans l’edge');
  for (const code of codes) assert.ok(CODES_LIAISON[code], `code sans message : ${code}`);
  assert.match(messageLiaison('inconnu'), /erreur/);
  assert.match(messageLiaison('identite_invalide', { siret: '14 chiffres' }), /SIRET : 14 chiffres/);
});

test('état de la liaison lu dans les réglages', () => {
  assert.equal(lireEtatLiaison({}), null);
  assert.equal(lireEtatLiaison({ hesiasun: { rompue_le: 'x' } }), null);
  assert.equal(ruptureConnue({ hesiasun: { rompue_le: '2026-11-22' } }), '2026-11-22');
  assert.equal(ruptureConnue({ hesiasun: { liaison_id: LIAISON, rompue_le: 'x' } }), null);
  const e = lireEtatLiaison({ hesiasun: { liaison_id: LIAISON, entreprise: 'A' } });
  assert.deepEqual(e, { ...ETAT, relie_le: '', entreprise: 'A', ouverte: false });
});

test('corps de l’envoi : quinze champs sans espaces, ouverture seulement au premier envoi', () => {
  const premier = corpsEnvoi(REGLAGES, { liaisonId: LIAISON, ouverture: true });
  assert.equal(premier.ok, true);
  assert.equal(premier.corps.source, 'majordhome');
  assert.equal(premier.corps.ouverture, true);
  assert.equal(premier.corps.identite.siret, '10028822400015');
  assert.equal(Object.keys(premier.corps.identite).length, 15);
  assert.equal('from_email' in premier.corps.identite, false);
  assert.equal('ouverture' in corpsEnvoi(REGLAGES, { liaisonId: LIAISON, ouverture: false }).corps, false);
  // identité mal formée : rien ne part
  assert.deepEqual(corpsEnvoi({ ...REGLAGES, brand_name: '' }, { liaisonId: LIAISON, ouverture: false }), { ok: false, code: 'identite_invalide', champs: { brand_name: 'Obligatoire' } });
});

test('réponses de HésiaSun', () => {
  assert.deepEqual(lireReponseHesiasun(200, { data: { id: 'x' } }), { ok: true, data: { id: 'x' } });
  assert.equal(lireReponseHesiasun(401, {}).code, 'cle_refusee');
  assert.equal(lireReponseHesiasun(403, { error: { message: 'Scope requis' } }).code, 'cle_refusee');
  for (const raison of ['version_inconnue', 'siret_different', 'tva_incoherente', 'deja_reliee', 'liaison_rompue']) {
    assert.equal(lireReponseHesiasun(409, { error: { code: 'conflict', details: { raison } } }).code, raison);
  }
  assert.equal(lireReponseHesiasun(409, { error: { details: { raison: 'autre_chose' } } }).code, 'hesiasun_refus');
  assert.deepEqual(lireReponseHesiasun(422, { error: { details: [{ path: 'siret', message: '14 chiffres' }] } }), { ok: false, code: 'identite_invalide', champs: { siret: '14 chiffres' } });
  for (const statut of [0, 500, 502, 429, 404]) assert.equal(lireReponseHesiasun(statut, null).code, 'hesiasun_injoignable', String(statut));
  // 200 sans données lisibles (page d'un hébergeur) : pas un succès
  assert.equal(lireReponseHesiasun(200, '<html>').ok, false);
});

test('état après un envoi', () => {
  const ok = etatApresEnvoi({ ...ETAT, ouverte: false, erreur: 'hesiasun_injoignable', en_attente: true, en_attente_depuis: 'hier' }, { ok: true }, 'now');
  assert.deepEqual(ok, { ...ETAT, ouverte: true, dernier_envoi_le: 'now' });
  const panne = etatApresEnvoi(ETAT, { ok: false, code: 'hesiasun_injoignable' }, 'now');
  assert.equal(panne.en_attente, true);
  assert.equal(panne.en_attente_depuis, 'now');
  // une seconde panne garde la date de la première
  assert.equal(etatApresEnvoi(panne, { ok: false, code: 'hesiasun_injoignable' }, 'plus tard').en_attente_depuis, 'now');
  // un refus motivé ne se rejoue pas tout seul
  const refus = etatApresEnvoi(ETAT, { ok: false, code: 'tva_incoherente' }, 'now');
  assert.equal(refus.en_attente, false);
  assert.equal(refus.erreur, 'tva_incoherente');
  assert.deepEqual(etatApresEnvoi(ETAT, { ok: false, code: 'identite_invalide', champs: { siret: 'x' } }, 'now').erreur_champs, { siret: 'x' });
  assert.deepEqual(etatRompu('now'), { rompue_le: 'now' });
});

test('rejeu automatique : 24 h, liaison ouverte seulement', () => {
  const t0 = Date.parse('2026-11-21T10:00:00Z');
  const attente = { ...ETAT, en_attente: true, en_attente_depuis: '2026-11-21T10:00:00Z' };
  assert.equal(aRejouer(attente, t0 + 3_600_000), true);
  assert.equal(aRejouer(attente, t0 + DUREE_REJEU_MS), false);
  assert.equal(aRejouer({ ...attente, ouverte: false }, t0), false);
  assert.equal(aRejouer(ETAT, t0), false);
  assert.equal(aRejouer(null, t0), false);
});

test('comparaison au moment de relier, et reprise de l’identité HésiaSun', () => {
  const labas = { brand_name: 'Atelier du Chauffage', siret: '10028822400015', tva_intra: 'FR75100288224', phone: '0563332314', city: 'Albi' };
  const c = comparerIdentites(REGLAGES, labas);
  assert.equal(c.lignes.length, 15);
  assert.equal(c.lignes.find((l) => l.cle === 'siret').different, false);
  assert.equal(c.lignes.find((l) => l.cle === 'phone').different, false);
  const ville = c.lignes.find((l) => l.cle === 'city');
  assert.deepEqual([ville.ici, ville.labas, ville.different], ['Gaillac', 'Albi', true]);
  assert.equal(c.identiques, false);
  assert.equal(comparerIdentites({}, labas).iciVide, true);
  assert.equal(comparerIdentites(REGLAGES, {}).labasVide, true);
  assert.equal(comparerIdentites(REGLAGES, corpsEnvoi(REGLAGES, { liaisonId: LIAISON, ouverture: false }).corps.identite).identiques, true);

  const repris = identitePourReglages(labas);
  assert.equal(repris.siret, '100 288 224 00015');
  assert.equal(repris.tva_intra, 'FR 75 100288224');
  assert.equal(repris.phone, '05 63 33 23 14');
  assert.equal(repris.address, '');
  assert.equal(Object.keys(repris).length, 15);
});
