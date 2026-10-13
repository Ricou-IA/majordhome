/**
 * tournees.js — Modèle PUR des tournées de livraison palettes (onglet Webshop → Tournées)
 * ============================================================================
 * Aucun import React / Supabase / alias : testé par `node --test scripts/webshop-tournees.test.mjs`.
 *
 * Le moteur de livraison vit côté site (dépôt Landing Page - Mayer) ; ce module ne fait
 * que lire ses données pour l'écran :
 *   - libellés et état d'une tournée (ouverte / fermée / annulée, feuille envoyée) ;
 *   - tournées où une commande peut aller (même secteur, place suffisante) — la base
 *     re-vérifie tout dans `webshop_order_move_slot`, ceci n'est que l'affichage ;
 *   - feuille de route : reprise de `construireFeuilleDeRoute` du site
 *     (lib/boutique/livraison/feuille-de-route.ts) — un arrêt par adresse normalisée,
 *     ordre des commandes, itinéraire Google Maps dépôt → arrêts → dépôt.
 *     ⚠️ Copie : une évolution du gabarit côté site est à reporter ici.
 * ============================================================================
 */

/** Statuts de majordhome.webshop_delivery_slots (CHECK). */
export const SLOT_STATUS = {
  open: { label: 'Ouverte', tone: 'blue' },
  closed: { label: 'Fermée', tone: 'slate' },
  shipped: { label: 'Livrée', tone: 'slate' },
  cancelled: { label: 'Annulée', tone: 'amber' },
};

export const CLOSE_REASONS = {
  capacity: 'pleine (emplacements)',
  stops: 'pleine (arrêts)',
  j_minus_2: 'J-2',
  manual: 'à la main',
};

/** Ligne d'état lisible : « Fermée — J-2 ». */
export function slotStatusLabel(slot) {
  const base = SLOT_STATUS[slot?.status]?.label ?? slot?.status ?? '—';
  if (slot?.status === 'closed' && slot.close_reason) return `${base} — ${CLOSE_REASONS[slot.close_reason] ?? slot.close_reason}`;
  return base;
}

/** Date ISO (YYYY-MM-DD) du jour à Paris — même référence que la base. */
export function todayParis(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(now);
}

/** Ajoute n jours à une date ISO (calcul en UTC, sans dérive d'heure d'été). */
export function addDaysIso(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Clé d'arrêt : même règle que la base (adresse normalisée, sinon adresse, sinon la commande). */
export function stopKey(order) {
  return order?.normalized_address || (order?.address ? String(order.address).toLowerCase() : null) || `order:${order?.id}`;
}

/** Commande comptée dans une tournée : payée et non annulée. */
export function isCountedOrder(order) {
  return !!order?.paid_at && order.status !== 'annulee';
}

/**
 * Tournées proposées pour déplacer / planifier une commande.
 * @param {object} p
 * @param {Array}  p.slots      tournées (lignes majordhome_webshop_delivery_slots)
 * @param {object} p.order      commande (sector_id, delivery_slot_id, pallet_slots)
 * @param {Array}  [p.stopKeysBySlot] Map slotId → Set des clés d'arrêt déjà présentes (si connues)
 * @param {string} p.today      YYYY-MM-DD
 * @returns {Array<{ slot, fits: boolean, reason: string|null }>} triées par date
 */
export function moveTargets({ slots, order, stopKeysBySlot, today }) {
  const pallets = Number(order?.pallet_slots ?? 0);
  const key = stopKey(order);
  return (slots || [])
    .filter((s) => s.sector_id === order?.sector_id && s.id !== order?.delivery_slot_id
      && (s.status === 'open' || s.status === 'closed') && s.delivery_date >= today)
    .sort((a, b) => a.delivery_date.localeCompare(b.delivery_date))
    .map((slot) => {
      const known = stopKeysBySlot?.get?.(slot.id);
      const newStop = known ? !known.has(key) : true;
      let reason = null;
      if (slot.used_slots + pallets > slot.capacity_slots) reason = 'Plus assez d\'emplacements';
      else if (newStop && slot.used_stops + 1 > slot.capacity_stops) reason = 'Plus assez d\'arrêts';
      return { slot, fits: reason === null, reason };
    });
}

/** Itinéraire Google Maps dépôt → arrêts → dépôt (copie de `lienItineraire` du site). */
export function itineraryUrl(depotAddress, stops) {
  const point = (a) => (a.lat !== null && a.lat !== undefined && a.lon !== null && a.lon !== undefined ? `${a.lat},${a.lon}` : a.address);
  const origin = encodeURIComponent(depotAddress);
  const waypoints = (stops || []).map((a) => encodeURIComponent(point(a))).join('%7C');
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${origin}${waypoints ? `&waypoints=${waypoints}` : ''}&travelmode=driving`;
}

/**
 * Dépôts des secteurs (`webshop_sectors.depot` est un code). Reprend les défauts du site
 * (`DEPOT_ADDRESS` = « Castanet-Tolosan », libellé `DEPOT_LABEL`) : la base ne porte pas
 * encore d'adresse de dépôt. Code inconnu → le code lui-même, jamais un dépôt inventé.
 */
export const DEPOTS = {
  castanet: { label: 'Dépôt Castanet-Tolosan', address: 'Castanet-Tolosan' },
};

export function depotFor(code) {
  return DEPOTS[code] ?? { label: `Dépôt ${code ?? '—'}`, address: code ?? '' };
}

/** « lundi 2 novembre 2026 » (date ISO lue en UTC : pas de décalage de fuseau). */
export function dateLongFR(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(`${iso}T00:00:00Z`));
}

/**
 * Téléphone lisible : « 06 86 26 98 09 ». Un numéro français (+33 / 0033 / 0X…) est remis
 * au format national par paires ; tout autre numéro reste tel que saisi.
 */
export function formatPhoneFR(phone) {
  if (!phone) return phone ?? null;
  let d = String(phone).replace(/[^\d+]/g, '');
  if (d.startsWith('+33')) d = `0${d.slice(3)}`;
  else if (d.startsWith('0033')) d = `0${d.slice(4)}`;
  if (/^0\d{9}$/.test(d)) return d.replace(/(\d{2})(?=\d)/g, '$1 ');
  return String(phone).trim();
}

/** Adresse affichée d'une commande : libellé BAN, sinon adresse saisie. */
export function orderAddress(order) {
  return order?.geocoded_address?.label || [order?.address, order?.postal_code, order?.city].filter(Boolean).join(' ');
}

/**
 * Feuille de route d'une tournée (données, sans rendu) — reprise du site.
 * @param {object} p
 * @param {object} p.slot          tournée
 * @param {object} p.sector        secteur ({ code, label, max_km })
 * @param {Array}  p.orders        commandes de la tournée (toutes : filtrées ici)
 * @param {Array}  p.items         lignes webshop_order_items de ces commandes
 * Le dépôt (départ / retour) vient de `sector.depot` via `depotFor`.
 */
export function buildRouteSheet({ slot, sector, orders, items }) {
  const depot = depotFor(sector?.depot);
  const counted = (orders || []).filter(isCountedOrder)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const stops = [];
  const byKey = new Map();
  for (const o of counted) {
    const key = stopKey(o);
    let stop = byKey.get(key);
    if (!stop) {
      stop = {
        order: stops.length + 1,
        name: `${o.first_name ?? ''} ${o.last_name ?? ''}`.trim(),
        phone: formatPhoneFR(o.phone),
        address: orderAddress(o),
        lat: o.lat ?? null,
        lon: o.lon ?? null,
        pallets: 0,
        orders: [],
      };
      byKey.set(key, stop);
      stops.push(stop);
    }
    stop.pallets += Number(o.pallet_slots ?? 0);
    stop.orders.push({
      orderNumber: o.order_number,
      name: `${o.first_name ?? ''} ${o.last_name ?? ''}`.trim(),
      phone: formatPhoneFR(o.phone),
      email: o.email ?? null,
      comment: o.comments || null,
      instructions: o.delivery_instructions || null,
      lines: (items || []).filter((i) => i.order_id === o.id && i.shipping_kind === 'pallet')
        .map((i) => ({ name: i.product_name, qty: Number(i.qty) })),
    });
  }
  const km = slot?.km_estimated === null || slot?.km_estimated === undefined ? null : Number(slot.km_estimated);
  return {
    date: slot?.delivery_date,
    dateLabel: dateLongFR(slot?.delivery_date),
    sector: { code: sector?.code ?? '', label: sector?.label ?? '' },
    depot: depot.label,
    pallets: stops.reduce((s, a) => s + a.pallets, 0),
    stops,
    kmEstimated: km,
    maxKm: sector?.max_km ?? null,
    overKm: km !== null && sector?.max_km ? km > sector.max_km : false,
    itineraryUrl: itineraryUrl(depot.address, stops),
    filename: `feuille-de-route-${slot?.delivery_date}-${sector?.code ?? 'secteur'}.pdf`,
  };
}

/** Messages FR des refus des RPC tournées (codes RAISE EXCEPTION de 20261013_2). */
const ERROR_MESSAGES = {
  unauthenticated: 'Session expirée : reconnectez-vous.',
  team_leader_required: 'Réservé aux chefs d\'équipe et administrateurs.',
  slot_not_found: 'Tournée introuvable.',
  slot_not_open: 'La tournée n\'est pas ouverte.',
  slot_not_reopenable: 'Cette tournée ne peut pas être rouverte.',
  slot_too_late: 'Trop tard pour rouvrir : la tournée a lieu dans moins de 2 jours.',
  slot_full: 'Tournée pleine : impossible de la rouvrir.',
  slot_not_cancellable: 'Cette tournée ne peut pas être annulée.',
  note_required: 'Indiquez un motif.',
  order_not_found: 'Commande introuvable.',
  order_not_plannable: 'Commande non payée ou annulée : elle ne se planifie pas.',
  order_not_pallet_delivery: 'Cette commande n\'est pas une livraison de palettes.',
  sector_mismatch: 'La tournée choisie n\'est pas dans le secteur de la commande.',
  same_slot: 'La commande est déjà sur cette tournée.',
  slot_not_available: 'Tournée annulée ou terminée.',
  slot_past: 'Tournée passée.',
  capacity_exceeded: 'Plus assez d\'emplacements palette sur cette tournée.',
  stops_exceeded: 'Plus assez d\'arrêts sur cette tournée.',
  slot_not_sendable: 'Tournée annulée ou terminée : rien à envoyer.',
  slot_empty: 'Aucune commande payée sur cette tournée : rien à envoyer.',
  cron_secret_missing: 'Secret d\'envoi absent du coffre (Vault webshop_cron_secret) : envoi impossible.',
};

/** Message FR d'une erreur Supabase / PostgREST levée par une RPC tournée. */
export function tourneeErrorMessage(error) {
  const code = String(error?.message ?? error ?? '').trim();
  return ERROR_MESSAGES[code] ?? (code ? `Erreur : ${code}` : 'Erreur inconnue');
}
