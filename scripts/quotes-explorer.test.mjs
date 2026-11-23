import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPLORER_QUOTE_STATUSES,
  EXPLORER_VIEWS,
  buildExplorerRows,
  filterExplorerRows,
  sansReponseDepuis,
  compterVues,
} from '../src/lib/quotesExplorer.js';

const NOW = Date.parse('2026-08-05T12:00:00Z');
const recent = '2026-07-20';
const old = '2026-01-10';

function quote(over = {}) {
  return {
    id: 1,
    quote_number: 'DEV-001',
    label: 'Poêle',
    date: recent,
    amount_ht: 4200,
    amount_ttc: 4620,
    status: 'pending',
    pdf_url: 'https://pl/x.pdf',
    customer_id: 77,
    customer_name: 'DUPONT',
    ...over,
  };
}

const base = { minAmountHt: 1000, sinceDays: 90, nowMs: NOW };

test('draft est exclu (brouillon non envoyé, pas une anomalie)', () => {
  const rows = buildExplorerRows({ quotes: [quote({ status: 'draft' })], ...base });
  assert.equal(rows.length, 0);
});

test('les 4 statuts de EXPLORER_QUOTE_STATUSES passent', () => {
  const quotes = EXPLORER_QUOTE_STATUSES.map((status, i) => quote({ id: i + 1, status }));
  const rows = buildExplorerRows({ quotes, ...base });
  assert.equal(rows.length, 4);
});

test('un devis sous le seuil est exclu', () => {
  const rows = buildExplorerRows({ quotes: [quote({ amount_ht: 999 })], ...base });
  assert.equal(rows.length, 0);
});

test('un devis hors fenêtre est exclu', () => {
  const rows = buildExplorerRows({ quotes: [quote({ date: old })], ...base });
  assert.equal(rows.length, 0);
});

test('un devis sans montant est exclu (pas de faux positif à 0)', () => {
  const rows = buildExplorerRows({ quotes: [quote({ amount_ht: null })], ...base });
  assert.equal(rows.length, 0);
});

test('le lead rattaché est reporté sur la ligne', () => {
  const rows = buildExplorerRows({
    quotes: [quote()],
    linkByQuoteId: new Map([[1, { lead_id: 'lead-a', lead_name: 'DUPONT Jean' }]]),
    ...base,
  });
  assert.equal(rows[0].lead_id, 'lead-a');
  assert.equal(rows[0].lead_name, 'DUPONT Jean');
  assert.equal(rows[0].is_orphan, false);
});

test('sans lien, la ligne est orpheline', () => {
  const rows = buildExplorerRows({ quotes: [quote()], ...base });
  assert.equal(rows[0].lead_id, null);
  assert.equal(rows[0].is_orphan, true);
});

test('un devis écarté est tagué is_dismissed', () => {
  const rows = buildExplorerRows({
    quotes: [quote()],
    dismissedIds: new Set([1]),
    ...base,
  });
  assert.equal(rows[0].is_dismissed, true);
});

test('vue ORPHANS : ni rattachés ni écartés', () => {
  const rows = buildExplorerRows({
    quotes: [quote({ id: 1 }), quote({ id: 2 }), quote({ id: 3 })],
    linkByQuoteId: new Map([[2, { lead_id: 'l', lead_name: 'X' }]]),
    dismissedIds: new Set([3]),
    ...base,
  });
  const view = filterExplorerRows(rows, EXPLORER_VIEWS.ORPHANS);
  assert.deepEqual(view.map(r => r.id), [1]);
});

test('vue ALL : rattachés inclus, écartés exclus', () => {
  const rows = buildExplorerRows({
    quotes: [quote({ id: 1 }), quote({ id: 2 }), quote({ id: 3 })],
    linkByQuoteId: new Map([[2, { lead_id: 'l', lead_name: 'X' }]]),
    dismissedIds: new Set([3]),
    ...base,
  });
  const view = filterExplorerRows(rows, EXPLORER_VIEWS.ALL);
  assert.deepEqual(view.map(r => r.id).sort(), [1, 2]);
});

test('vue DISMISSED : uniquement les écartés', () => {
  const rows = buildExplorerRows({
    quotes: [quote({ id: 1 }), quote({ id: 3 })],
    dismissedIds: new Set([3]),
    ...base,
  });
  const view = filterExplorerRows(rows, EXPLORER_VIEWS.DISMISSED);
  assert.deepEqual(view.map(r => r.id), [3]);
});

test('les lignes sont triées par date décroissante', () => {
  const rows = buildExplorerRows({
    quotes: [
      quote({ id: 1, date: '2026-06-01' }),
      quote({ id: 2, date: '2026-07-30' }),
      quote({ id: 3, date: '2026-07-01' }),
    ],
    ...base,
  });
  assert.deepEqual(rows.map(r => r.id), [2, 3, 1]);
});

test('sansReponseDepuis : devis en attente ou expiré daté de plus de 21 jours', () => {
  const auj = '2026-11-23';
  assert.equal(sansReponseDepuis({ status: 'pending', date: '2026-11-01' }, auj), true); // 22 j
  assert.equal(sansReponseDepuis({ status: 'pending', date: '2026-11-02' }, auj), false); // 21 j
  assert.equal(sansReponseDepuis({ status: 'expired', date: '2026-10-01' }, auj), true);
  assert.equal(sansReponseDepuis({ status: 'accepted', date: '2026-10-01' }, auj), false);
  assert.equal(sansReponseDepuis({ status: 'pending', date: null }, auj), false);
  assert.equal(sansReponseDepuis({ status: 'pending', date: 'pas une date' }, auj), false);
  assert.equal(sansReponseDepuis({ status: 'pending', date: '2026-11-10' }, auj, 7), true);
});

test('compterVues : un compteur par vue, cohérent avec filterExplorerRows', () => {
  const rows = [
    { is_dismissed: false, is_orphan: true },
    { is_dismissed: false, is_orphan: false },
    { is_dismissed: true, is_orphan: true },
  ];
  assert.deepEqual(compterVues(rows), {
    [EXPLORER_VIEWS.ORPHANS]: filterExplorerRows(rows, EXPLORER_VIEWS.ORPHANS).length,
    [EXPLORER_VIEWS.ALL]: filterExplorerRows(rows, EXPLORER_VIEWS.ALL).length,
    [EXPLORER_VIEWS.DISMISSED]: filterExplorerRows(rows, EXPLORER_VIEWS.DISMISSED).length,
  });
  assert.deepEqual(compterVues([]), { orphans: 0, all: 0, dismissed: 0 });
});
