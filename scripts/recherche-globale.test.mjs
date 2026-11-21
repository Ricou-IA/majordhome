import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normaliser, pagesCorrespondantes, lignesDeResultat, indexVoisin, actionsCreer,
} from '../src/lib/rechercheGlobale.js';

const PAGES = [
  { name: 'Dashboard', href: '/' }, { name: 'Planning', href: '/planning' }, { name: 'Clients', href: '/clients' },
  { name: 'Pipeline', href: '/pipeline' }, { name: 'Entretiens', href: '/entretiens' }, { name: 'Cédants', href: '/cedants' },
  { name: 'Meta Ads', href: '/meta-ads' }, { name: 'Chantiers', href: '/chantiers' }, { name: 'Chantier Gaillac', href: '/chantier-gaillac' },
];

test('normaliser : minuscules, sans accents, sans espaces autour', () => {
  assert.equal(normaliser('  Cédants '), 'cedants');
  assert.equal(normaliser('ROZIÈRES'), 'rozieres');
  assert.equal(normaliser(null), '');
});

test('pagesCorrespondantes : accents ignorés, tous les mots requis, rien pour une saisie vide', () => {
  assert.deepEqual(pagesCorrespondantes(PAGES, 'cedan').map((p) => p.href), ['/cedants']);
  assert.deepEqual(pagesCorrespondantes(PAGES, 'CHANTIER').map((p) => p.href), ['/chantiers', '/chantier-gaillac']);
  assert.deepEqual(pagesCorrespondantes(PAGES, 'chantier gail').map((p) => p.href), ['/chantier-gaillac']);
  assert.deepEqual(pagesCorrespondantes(PAGES, '   '), []);
  assert.deepEqual(pagesCorrespondantes(PAGES, 'zzz'), []);
  assert.deepEqual(pagesCorrespondantes(undefined, 'a'), []);
});

test('pagesCorrespondantes : cinq pages au plus', () => {
  const beaucoup = Array.from({ length: 9 }, (_, i) => ({ name: `Page ${i}`, href: `/p${i}` }));
  assert.equal(pagesCorrespondantes(beaucoup, 'page').length, 5);
});

test('lignesDeResultat : clients, puis leads, puis pages, chacun avec sa destination', () => {
  const lignes = lignesDeResultat({
    clients: [{ id: 'c1', display_name: 'DUPONT Jean', client_number: 'CLI-00012', postal_code: '81600', city: 'Gaillac', has_active_contract: true }],
    leads: [{ id: 'l1', display_name: 'MARTIN Paul', status_label: 'Devis envoyé', postal_code: '81000', city: 'Albi', source_name: 'Site web' }],
    pages: [{ name: 'Planning', href: '/planning' }],
  });
  assert.deepEqual(lignes, [
    { cle: 'client-c1', groupe: 'Clients', titre: 'DUPONT Jean', detail: 'CLI-00012 · 81600 Gaillac · Contrat actif', href: '/clients/c1' },
    { cle: 'lead-l1', groupe: 'Leads', titre: 'MARTIN Paul', detail: 'Devis envoyé · 81000 Albi · Site web', href: '/pipeline?tab=kanban&lead=l1' },
    { cle: 'page-/planning', groupe: 'Pages', titre: 'Planning', detail: '', href: '/planning' },
  ]);
});

test('lignesDeResultat : champs manquants = pas de séparateur orphelin, nom de repli', () => {
  const [client, lead] = lignesDeResultat({
    clients: [{ id: 'c2', display_name: '', city: 'Albi' }],
    leads: [{ id: 'l2', last_name: 'DURAND', first_name: 'Léa' }],
  });
  assert.equal(client.titre, 'Client sans nom');
  assert.equal(client.detail, 'Albi');
  assert.equal(lead.titre, 'DURAND Léa');
  assert.equal(lead.detail, '');
  assert.deepEqual(lignesDeResultat(), []);
  assert.deepEqual(lignesDeResultat({ clients: null, leads: undefined }), []);
});

test('indexVoisin : en boucle, première ou dernière ligne depuis « aucune »', () => {
  assert.equal(indexVoisin(-1, 3, 1), 0);
  assert.equal(indexVoisin(-1, 3, -1), 2);
  assert.equal(indexVoisin(0, 3, 1), 1);
  assert.equal(indexVoisin(2, 3, 1), 0);
  assert.equal(indexVoisin(0, 3, -1), 2);
  assert.equal(indexVoisin(0, 0, 1), -1);
});

test('actionsCreer : seulement ce que les droits permettent', () => {
  assert.deepEqual(actionsCreer({ rdv: true, lead: true, client: true }).map((a) => a.cle), ['rdv', 'lead', 'client']);
  assert.deepEqual(actionsCreer({ rdv: true }).map((a) => a.libelle), ['Nouveau RDV']);
  assert.deepEqual(actionsCreer({}), []);
  assert.deepEqual(actionsCreer(), []);
});

test('chaque lien de création est lu par la page qu’il ouvre', () => {
  const lire = (chemin) => readFileSync(new URL(`../src/apps/artisan/pages/${chemin}`, import.meta.url), 'utf8');
  assert.match(lire('Planning.jsx'), /searchParams\.get\('nouveau'\)/, 'Planning.jsx ne lit pas ?nouveau=1');
  assert.match(lire('Pipeline.jsx'), /searchParams\.get\('new'\)/, 'Pipeline.jsx ne lit pas ?new=1');
  assert.match(lire('Pipeline.jsx'), /searchParams\.get\('lead'\)/, 'Pipeline.jsx ne lit pas ?lead=<id>');
  assert.match(lire('Clients.jsx'), /searchParams\.get\('new'\)/, 'Clients.jsx ne lit pas ?new=1');
});
