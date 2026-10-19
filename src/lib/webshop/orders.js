/**
 * orders.js — Webshop : logique PURE des commandes (kanban, lignes, pastilles).
 * Testé : node --test scripts/webshop-orders.test.mjs
 */

export const ORDER_STATUS_LABELS = {
  en_attente_paiement: 'En attente de paiement',
  nouvelle: 'Nouvelle',
  confirmee: 'Confirmée',
  transmise_fournisseur: 'Transmise fournisseur',
  expediee: 'Expédiée',
  livree: 'Livrée',
  annulee: 'Annulée',
};

export const ORDER_BOARD_COLUMNS = [
  { id: 'nouvelle', label: 'Nouvelle', color: '#3b82f6' },
  { id: 'confirmee', label: 'Confirmée', color: '#6366f1' },
  { id: 'transmise_fournisseur', label: 'Transmise fournisseur', color: '#f59e0b' },
  { id: 'expediee', label: 'Expédiée', color: '#8b5cf6' },
  { id: 'livree', label: 'Livrée', color: '#0ea5e9' },
];

export const ORDER_SIDE_STATUSES = ['en_attente_paiement', 'annulee'];

const BOARD_IDS = new Set(ORDER_BOARD_COLUMNS.map((c) => c.id));

export function canMoveTo(from, to) {
  return BOARD_IDS.has(from) && BOARD_IDS.has(to) && from !== to;
}

export function toCents(n) {
  if (n === null || n === undefined || n === '') return null;
  return Math.round(Number(n) * 100);
}

export function formatCents(cents) {
  const euros = (Number(cents) || 0) / 100;
  const hasDecimals = Math.round(euros * 100) % 100 !== 0;
  return euros.toLocaleString('fr-FR', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  }) + ' €';
}

/** Lignes de commande ; repli sur le produit unique de l'ancien modèle borne. */
export function orderLines(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (items.length > 0) {
    return items.map((it) => ({
      name: it.product_name,
      qty: it.qty,
      unitCents: it.unit_price_ttc_cents,
      totalCents: it.line_total_ttc_cents,
      shippingKind: it.shipping_kind ?? null,
    }));
  }
  if (order?.product_id || order?.product_name) {
    const qty = order.quantity ?? 1;
    return [{
      name: order.product_name ?? 'Produit',
      qty,
      unitCents: toCents(order.unit_price_ttc),
      totalCents: toCents(order.total_ttc) ?? (toCents(order.unit_price_ttc) ?? 0) * qty,
      shippingKind: null,
    }];
  }
  return [];
}

export function linesSummary(lines, max = 2) {
  const shown = lines.slice(0, max).map((l) => `${l.name} ×${l.qty}`).join(', ');
  return lines.length > max ? `${shown} +${lines.length - max}` : shown;
}

export function orderTotalCents(order) {
  if (order?.total_ttc_cents !== null && order?.total_ttc_cents !== undefined) return order.total_ttc_cents;
  return toCents(order?.total_ttc) ?? 0;
}

function shortDate(iso) {
  const [, m, d] = String(iso).slice(0, 10).split('-');
  return d && m ? `${d}/${m}` : '';
}

/**
 * Pastilles de carte, ordre stable : livraison → canal → alertes → envoi échoué.
 * @param {any} order
 * @param {Array<{ shippingKind: string | null }>} lines
 * @param {Array<{ status: string }> | null} [actions] journal des envois de CETTE commande
 * @returns {Array<{ key: string, label: string, tone: string }>}
 */
export function orderBadges(order, lines, actions) {
  const badges = [];
  const hasPallet = lines.some((l) => l.shippingKind === 'pallet') || Boolean(order.pallet_delivery_mode);
  const hasParcel = lines.some((l) => l.shippingKind === 'parcel');
  if (hasPallet) {
    badges.push({ key: 'pallet', label: order.delivery_date ? `Palette · ${shortDate(order.delivery_date)}` : 'Palette', tone: 'info' });
  }
  if (hasParcel) badges.push({ key: 'parcel', label: 'Colis', tone: 'neutral' });
  if (order.pallet_delivery_mode === 'pickup' || order.parcel_delivery_mode === 'pickup') {
    badges.push({ key: 'pickup', label: order.pickup_point_name ? `Retrait · ${order.pickup_point_name}` : 'Retrait', tone: 'neutral' });
  }
  if (order.channel === 'pro') badges.push({ key: 'pro', label: 'Pro', tone: 'neutral' });
  if (order.order_type === 'vente_installation') badges.push({ key: 'install', label: 'Installation', tone: 'info' });
  if (order.needs_manual_planning) badges.push({ key: 'manual_planning', label: 'Planification manuelle', tone: 'warning' });
  if (order.delivery_slot_changed) badges.push({ key: 'slot_changed', label: 'Créneau modifié', tone: 'warning' });
  if (Array.isArray(actions) && actions.some((a) => a?.status === 'failed')) {
    badges.push({ key: 'action_failed', label: 'Envoi échoué', tone: 'warning' });
  }
  return badges;
}

/** @type {Record<string, string>} codes d'action renvoyés par l'edge webshop-process */
const ACTION_ERROR_LABELS = {
  template_missing: 'gabarit manquant',
  prestataire_missing: 'aucun prestataire colis renseigné',
  no_email: 'client sans e-mail',
  no_from_email: 'adresse d\'expédition non configurée',
  resend_failed: 'refusé par le service d\'envoi',
  already_sent: 'déjà envoyé',
  reserve_failed: 'réservation de l\'envoi impossible',
  template_read_failed: 'lecture du gabarit impossible',
  internal_error: 'erreur interne',
};

/** @type {Record<string, string>} erreurs de requête de l'edge webshop-process */
const PROCESS_ERROR_LABELS = {
  invalid_transition: 'changement de colonne refusé (statut modifié entre-temps ?)',
  forbidden: 'droit insuffisant',
  not_found: 'introuvable',
  bad_request: 'requête invalide',
  invalid_event: 'événement de tournée invalide',
  slot_not_closed: 'tournée non clôturée',
  slot_not_departed: 'tournée pas encore partie',
  slot_cancelled: 'tournée annulée',
};

/**
 * Libellé FR d'un code d'action du journal ; code inconnu → code brut (jamais avalé).
 * @param {string | null | undefined} code
 * @returns {string}
 */
export function libelleErreurAction(code) {
  if (!code) return '';
  return ACTION_ERROR_LABELS[code] ?? code;
}

/**
 * Libellé FR d'une erreur de requête de l'edge (repli sur les codes d'action, puis code brut).
 * @param {string | null | undefined} code
 * @returns {string}
 */
export function libelleErreurProcess(code) {
  if (!code) return '';
  return PROCESS_ERROR_LABELS[code] ?? libelleErreurAction(code);
}

/** @type {Record<string, string>} */
const EVENT_LABELS = { tournee_partie: 'Tournée partie', tournee_livree: 'Tournée livrée' };

/**
 * Libellé d'un `evenement` du journal (statut cible ou événement de tournée).
 * @param {string} evenement
 * @returns {string}
 */
export function libelleEvenementAction(evenement) {
  return ORDER_STATUS_LABELS[evenement] ?? EVENT_LABELS[evenement] ?? evenement;
}

/** @type {Record<string, string>} */
const ACTION_LABELS = { email_client: 'e-mail client', ordre_colis: 'ordre colis' };

/**
 * Libellé d'une action du journal (« e-mail client », « ordre colis »).
 * @param {string} action
 * @returns {string}
 */
export function libelleAction(action) {
  return ACTION_LABELS[action] ?? action;
}

/**
 * Issue d'une action en mots (« envoyé », « en échec (gabarit manquant) »…).
 * @param {{ status: string, error_code?: string | null }} a
 * @returns {string}
 */
export function issueAction(a) {
  if (a.status === 'sent') return 'envoyé';
  if (a.status === 'skipped' && a.error_code === 'already_sent') return 'déjà envoyé';
  if (a.status === 'pending') return 'en cours';
  const raison = libelleErreurAction(a.error_code);
  const base = a.status === 'failed' ? 'en échec' : 'non envoyé';
  return raison ? `${base} (${raison})` : base;
}

/**
 * Toast d'une transition : « Commande Expédiée — e-mail client envoyé ».
 * Jamais `success` si une action a échoué ou n'est pas partie (hors « déjà envoyé »).
 * @param {string} to statut posé
 * @param {Array<{ action: string, status: string, error_code?: string | null }> | null} actions
 * @returns {{ tone: 'success' | 'warning', message: string }}
 */
export function resumeTransition(to, actions) {
  const list = Array.isArray(actions) ? actions : [];
  const head = `Commande ${ORDER_STATUS_LABELS[to] ?? to}`;
  const parts = list.map((a) => `${libelleAction(a.action)} ${issueAction(a)}`);
  const ok = list.every((a) => a.status === 'sent' || (a.status === 'skipped' && a.error_code === 'already_sent'));
  return { tone: ok ? 'success' : 'warning', message: parts.length ? `${head} — ${parts.join(', ')}` : head };
}

/**
 * Une ligne du journal se rejoue si elle n'est pas partie : failed, ou skipped autre que « déjà envoyé ».
 * @param {{ id?: string | null, status: string, error_code?: string | null }} a
 * @returns {boolean}
 */
export function peutRejouer(a) {
  if (!a?.id) return false;
  return a.status === 'failed' || (a.status === 'skipped' && a.error_code !== 'already_sent');
}

/** Patch d'un changement de statut : shipped_at / delivered_at posés une seule fois. */
export function statusPatch(order, to, now = new Date()) {
  const patch = { status: to };
  if (to === 'expediee' && !order.shipped_at) patch.shipped_at = now.toISOString();
  if (to === 'livree' && !order.delivered_at) patch.delivered_at = now.toISOString();
  return patch;
}

/** Réactiver une commande annulée : jamais payée → retour en attente de paiement, motif effacé. */
export function reactivationPatch(order) {
  return { status: order.paid_at ? 'nouvelle' : 'en_attente_paiement', cancel_reason: null };
}

function fold(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function matchesOrderSearch(order, query) {
  const q = fold(query).trim();
  if (!q) return true;
  return [order.order_number, order.first_name, order.last_name, order.city, order.email, order.company_name]
    .some((v) => fold(v).includes(q));
}
