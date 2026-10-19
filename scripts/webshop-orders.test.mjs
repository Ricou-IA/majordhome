import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORDER_BOARD_COLUMNS, ORDER_SIDE_STATUSES, canMoveTo, toCents, orderLines, linesSummary,
  orderTotalCents, orderBadges, statusPatch, matchesOrderSearch, formatCents,
} from '../src/lib/webshop/orders.js';

const NEW_MODEL = {
  id: 'o1', order_number: 'WEB-2026-0010', status: 'nouvelle', channel: 'particulier', order_type: 'vente_directe',
  first_name: 'Jean', last_name: 'Dupont', city: 'Gaillac', email: 'j@d.fr', total_ttc: null, total_ttc_cents: 81800,
  pallet_delivery_mode: 'delivery', parcel_delivery_mode: null, delivery_date: '2026-10-20',
  needs_manual_planning: false, delivery_slot_changed: true, shipped_at: null, delivered_at: null,
  items: [
    { product_name: 'Pellets Premium', qty: 2, unit_price_ttc_cents: 34900, line_total_ttc_cents: 69800, shipping_kind: 'pallet' },
    { product_name: 'Serviteur Arcadia', qty: 1, unit_price_ttc_cents: 11900, line_total_ttc_cents: 11900, shipping_kind: 'parcel' },
    { product_name: 'Range-bûches', qty: 1, unit_price_ttc_cents: 24990, line_total_ttc_cents: 24990, shipping_kind: 'parcel' },
  ],
};
const LEGACY = {
  id: 'o2', order_number: 'WEB-2026-0001', status: 'annulee', channel: 'pro', order_type: 'vente_installation',
  first_name: 'test', last_name: 'test', city: 'Toulouse', product_name: 'Borne V2C Trydan', product_id: 'p9',
  quantity: 1, unit_price_ttc: 1290, total_ttc: 1290, total_ttc_cents: null, items: [], needs_manual_planning: true,
};

test('colonnes : 5 au tableau, 2 repliées', () => {
  assert.deepEqual(ORDER_BOARD_COLUMNS.map((c) => c.id), ['nouvelle', 'confirmee', 'transmise_fournisseur', 'expediee', 'livree']);
  assert.deepEqual(ORDER_SIDE_STATUSES, ['en_attente_paiement', 'annulee']);
});
test('canMoveTo : seulement entre colonnes du tableau, pas sur place', () => {
  assert.equal(canMoveTo('nouvelle', 'expediee'), true);
  assert.equal(canMoveTo('livree', 'confirmee'), true);
  assert.equal(canMoveTo('nouvelle', 'nouvelle'), false);
  assert.equal(canMoveTo('en_attente_paiement', 'nouvelle'), false);
  assert.equal(canMoveTo('nouvelle', 'annulee'), false);
  assert.equal(canMoveTo('nouvelle', undefined), false);
});
test('toCents / formatCents', () => {
  assert.equal(toCents(249.9), 24990);
  assert.equal(toCents(null), null);
  assert.equal(formatCents(129050).replace(/\s/g, ' '), '1 290,50 €');
  assert.equal(formatCents(11900).replace(/\s/g, ' '), '119 €');
});
test('orderLines : nouveau modèle', () => {
  const l = orderLines(NEW_MODEL);
  assert.equal(l.length, 3);
  assert.deepEqual(l[0], { name: 'Pellets Premium', qty: 2, unitCents: 34900, totalCents: 69800, shippingKind: 'pallet' });
});
test('orderLines : repli ancien modèle (sans lignes)', () => {
  assert.deepEqual(orderLines(LEGACY), [{ name: 'Borne V2C Trydan', qty: 1, unitCents: 129000, totalCents: 129000, shippingKind: null }]);
  assert.deepEqual(orderLines({ items: [] }), []);
});
test('linesSummary : tronqué au-delà de max', () => {
  assert.equal(linesSummary(orderLines(NEW_MODEL)), 'Pellets Premium ×2, Serviteur Arcadia ×1 +1');
  assert.equal(linesSummary(orderLines(LEGACY)), 'Borne V2C Trydan ×1');
  assert.equal(linesSummary([]), '');
});
test('orderTotalCents : centimes en priorité, sinon total_ttc', () => {
  assert.equal(orderTotalCents(NEW_MODEL), 81800);
  assert.equal(orderTotalCents(LEGACY), 129000);
  assert.equal(orderTotalCents({}), 0);
});
test('orderBadges', () => {
  const keys = (o) => orderBadges(o, orderLines(o)).map((b) => b.key);
  assert.deepEqual(keys(NEW_MODEL), ['pallet', 'parcel', 'slot_changed']);
  assert.equal(orderBadges(NEW_MODEL, orderLines(NEW_MODEL))[0].label, 'Palette · 20/10');
  assert.deepEqual(keys(LEGACY), ['pro', 'install', 'manual_planning']);
  assert.deepEqual(keys({ ...NEW_MODEL, pallet_delivery_mode: 'pickup', delivery_slot_changed: false }), ['pallet', 'parcel', 'pickup']);
});
test('statusPatch : dates posées une seule fois', () => {
  const now = new Date('2026-10-13T10:00:00Z');
  assert.deepEqual(statusPatch(NEW_MODEL, 'expediee', now), { status: 'expediee', shipped_at: now.toISOString() });
  assert.deepEqual(statusPatch({ ...NEW_MODEL, shipped_at: 'x' }, 'expediee', now), { status: 'expediee' });
  assert.deepEqual(statusPatch(NEW_MODEL, 'livree', now), { status: 'livree', delivered_at: now.toISOString() });
  assert.deepEqual(statusPatch(NEW_MODEL, 'confirmee', now), { status: 'confirmee' });
});
test('matchesOrderSearch : numéro, nom, ville, email, insensible aux accents', () => {
  assert.equal(matchesOrderSearch(NEW_MODEL, '0010'), true);
  assert.equal(matchesOrderSearch(NEW_MODEL, 'dupont'), true);
  assert.equal(matchesOrderSearch({ ...NEW_MODEL, city: 'Lisle-sur-Tarn' }, 'lisle'), true);
  assert.equal(matchesOrderSearch({ ...NEW_MODEL, last_name: 'Géraud' }, 'geraud'), true);
  assert.equal(matchesOrderSearch(NEW_MODEL, 'zzz'), false);
  assert.equal(matchesOrderSearch(NEW_MODEL, ''), true);
});

// ── Relecture finale ──────────────────────────────────────────────────────
import { reactivationPatch } from '../src/lib/webshop/orders.js';
test('reactivationPatch : une commande jamais payée retourne en attente de paiement, motif effacé', () => {
  assert.deepEqual(reactivationPatch({ status: 'annulee', paid_at: null, cancel_reason: 'x' }), { status: 'en_attente_paiement', cancel_reason: null });
  assert.deepEqual(reactivationPatch({ status: 'annulee', paid_at: '2026-10-01T10:00:00Z', cancel_reason: 'x' }), { status: 'nouvelle', cancel_reason: null });
});

// ── Étape 2 : journal des envois (Task 4) ─────────────────────────────────
import {
  libelleErreurAction, libelleErreurProcess, libelleEvenementAction, resumeTransition, peutRejouer, issueAction,
} from '../src/lib/webshop/orders.js';

const ACTION = (over = {}) => ({
  id: 'a1', order_id: 'o1', action: 'email_client', envoi: 'colis', evenement: 'expediee',
  gabarit: 'webshop_expedition_colis', status: 'sent', error_code: null, error_message: null, recipient: 'j@d.fr', ...over,
});

test('orderBadges : une action failed → pastille « Envoi échoué » en dernier', () => {
  const lines = orderLines(NEW_MODEL);
  const withFailed = orderBadges(NEW_MODEL, lines, [ACTION(), ACTION({ id: 'a2', status: 'failed', error_code: 'template_missing' })]);
  assert.deepEqual(withFailed.at(-1), { key: 'action_failed', label: 'Envoi échoué', tone: 'warning' });
  assert.deepEqual(orderBadges(NEW_MODEL, lines, [ACTION(), ACTION({ status: 'skipped', error_code: 'no_email' })]).map((b) => b.key), ['pallet', 'parcel', 'slot_changed']);
  assert.deepEqual(orderBadges(NEW_MODEL, lines).map((b) => b.key), ['pallet', 'parcel', 'slot_changed']);
  assert.deepEqual(orderBadges(NEW_MODEL, lines, null).map((b) => b.key), ['pallet', 'parcel', 'slot_changed']);
});
test('libelleErreurAction : codes de l\'edge en français, code inconnu → code brut', () => {
  assert.equal(libelleErreurAction('template_missing'), 'gabarit manquant');
  assert.equal(libelleErreurAction('prestataire_missing'), 'aucun prestataire colis renseigné');
  assert.equal(libelleErreurAction('no_email'), 'client sans e-mail');
  assert.equal(libelleErreurAction('no_from_email'), 'adresse d\'expédition non configurée');
  assert.equal(libelleErreurAction('resend_failed'), 'refusé par le service d\'envoi');
  assert.equal(libelleErreurAction('already_sent'), 'déjà envoyé');
  assert.equal(libelleErreurAction('reserve_failed'), 'réservation de l\'envoi impossible');
  assert.equal(libelleErreurAction('template_read_failed'), 'lecture du gabarit impossible');
  assert.equal(libelleErreurAction('internal_error'), 'erreur interne');
  assert.equal(libelleErreurAction('zzz_inconnu'), 'zzz_inconnu');
  assert.equal(libelleErreurAction(null), '');
});
test('libelleErreurProcess : erreurs de requête, repli sur les codes d\'action puis code brut', () => {
  assert.equal(libelleErreurProcess('invalid_transition'), 'changement de colonne refusé (statut modifié entre-temps ?)');
  assert.equal(libelleErreurProcess('forbidden'), 'droit insuffisant');
  assert.equal(libelleErreurProcess('not_found'), 'introuvable');
  assert.equal(libelleErreurProcess('already_sent'), 'déjà envoyé');
  assert.equal(libelleErreurProcess('boom'), 'boom');
});
test('libelleEvenementAction : statuts et événements de tournée', () => {
  assert.equal(libelleEvenementAction('expediee'), 'Expédiée');
  assert.equal(libelleEvenementAction('tournee_partie'), 'Tournée partie');
  assert.equal(libelleEvenementAction('tournee_livree'), 'Tournée livrée');
  assert.equal(libelleEvenementAction('xx'), 'xx');
});
test('resumeTransition : succès seulement si rien n\'a échoué', () => {
  assert.deepEqual(resumeTransition('expediee', []), { tone: 'success', message: 'Commande Expédiée' });
  assert.deepEqual(resumeTransition('expediee', [ACTION()]), { tone: 'success', message: 'Commande Expédiée — e-mail client envoyé' });
  assert.deepEqual(
    resumeTransition('expediee', [ACTION({ status: 'failed', error_code: 'template_missing' })]),
    { tone: 'warning', message: 'Commande Expédiée — e-mail client en échec (gabarit manquant)' },
  );
  assert.deepEqual(
    resumeTransition('transmise_fournisseur', [
      ACTION({ action: 'ordre_colis', status: 'failed', error_code: 'prestataire_missing' }),
      ACTION({ status: 'skipped', error_code: 'no_email' }),
    ]),
    { tone: 'warning', message: 'Commande Transmise fournisseur — ordre colis en échec (aucun prestataire colis renseigné), e-mail client non envoyé (client sans e-mail)' },
  );
  assert.deepEqual(
    resumeTransition('expediee', [ACTION({ id: null, status: 'skipped', error_code: 'already_sent' })]),
    { tone: 'success', message: 'Commande Expédiée — e-mail client déjà envoyé' },
  );
});
test('peutRejouer : failed et skipped (hors already_sent), jamais sent ni pending', () => {
  assert.equal(peutRejouer(ACTION({ status: 'failed' })), true);
  assert.equal(peutRejouer(ACTION({ status: 'skipped', error_code: 'no_email' })), true);
  assert.equal(peutRejouer(ACTION({ status: 'sent' })), false);
  assert.equal(peutRejouer(ACTION({ status: 'pending' })), false);
  assert.equal(peutRejouer(ACTION({ id: null, status: 'skipped', error_code: 'already_sent' })), false);
});

// ── Correction 1 : pagination du journal, action pending bloquée ───────────
import { fetchAllPages } from '../src/lib/postgrestUtils.js';
import { actionBloquee } from '../src/lib/webshop/orders.js';

function fakePages(total, { failAt = null } = {}) {
  const calls = [];
  const rows = Array.from({ length: total }, (_, i) => ({ i }));
  const fetchPage = async (from, to) => {
    calls.push([from, to]);
    if (failAt !== null && from >= failAt) return { data: null, error: new Error('boom') };
    return { data: rows.slice(from, to + 1), error: null };
  };
  return { fetchPage, calls };
}

test('fetchAllPages : pagine jusqu\'à épuisement (au-delà du plafond de 1000 lignes)', async () => {
  const { fetchPage, calls } = fakePages(2500);
  const out = await fetchAllPages(fetchPage, 1000);
  assert.equal(out.length, 2500);
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});
test('fetchAllPages : page pile pleine → on demande la suivante (vide) avant de conclure', async () => {
  const { fetchPage, calls } = fakePages(1000);
  assert.equal((await fetchAllPages(fetchPage, 1000)).length, 1000);
  assert.deepEqual(calls, [[0, 999], [1000, 1999]]);
  const vide = fakePages(0);
  assert.deepEqual(await fetchAllPages(vide.fetchPage, 1000), []);
});
test('fetchAllPages : page suivante en échec après une page pleine → erreur explicite, jamais un résultat tronqué', async () => {
  const { fetchPage } = fakePages(2500, { failAt: 1000 });
  await assert.rejects(() => fetchAllPages(fetchPage, 1000), /page 2.*1000 lignes déjà lues/);
});
test('actionBloquee / peutRejouer : pending de plus de 10 min = bloquée et rejouable', () => {
  const now = new Date('2026-10-19T10:00:00Z');
  const vieux = ACTION({ status: 'pending', updated_at: '2026-10-19T09:49:00Z' });
  const recent = ACTION({ status: 'pending', updated_at: '2026-10-19T09:55:00Z' });
  assert.equal(actionBloquee(vieux, now), true);
  assert.equal(actionBloquee(recent, now), false);
  assert.equal(actionBloquee(ACTION({ status: 'failed', updated_at: '2026-10-19T09:00:00Z' }), now), false);
  assert.equal(peutRejouer(vieux, now), true);
  assert.equal(peutRejouer(recent, now), false);
  assert.equal(issueAction(vieux, now), 'envoi bloqué');
  assert.equal(issueAction(recent, now), 'en cours');
});

import { AVERTISSEMENT_REJEU_BLOQUE } from '../src/lib/webshop/orders.js';

test('rejeu d’un envoi bloqué : avertissement du double envoi possible', () => {
  assert.match(AVERTISSEMENT_REJEU_BLOQUE, /peut-être déjà parti/);
  assert.match(AVERTISSEMENT_REJEU_BLOQUE, /historique des e-mails/);
  assert.match(AVERTISSEMENT_REJEU_BLOQUE, /2ᵉ fois/);
});
