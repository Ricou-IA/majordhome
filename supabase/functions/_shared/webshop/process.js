// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/webshop/process.js — ne pas éditer.
// src/lib/webshop/process.js
// ============================================================================
// Process du webshop (étape 2) — module PUR : quelles actions déclencher, pour
// quel envoi, et avec quelles variables d'e-mail. Le client est prévenu PAR
// ENVOI : colis = transitions de la commande (réglées dans settings.webshop.process),
// palette = événements de tournée « partie » / « livrée ». Chaque e-mail ne parle
// que des lignes de son envoi.
// Aucun import hors ./orders.js, ./reglages.js et ./emailTemplates.js. Copié pour Deno
// (_shared/webshop/) par scripts/sync-tournee-engine.mjs — ne pas éditer la copie.
// Testé : node --test scripts/webshop-process.test.mjs
// ============================================================================
import { canMoveTo, formatCents, ORDER_BOARD_COLUMNS } from './orders.js';
import { blocsConfirmation } from './emailTemplates.js';

/**
 * Ligne de commande telle que produite par `orderLines` (orders.js). `weightKg` est optionnel
 * (enrichi par l'appelant depuis le catalogue pour l'ordre colis).
 * @typedef {{ name: string, qty: number, unitCents: number | null, totalCents: number | null,
 *   shippingKind: 'parcel' | 'pallet' | null, weightKg?: number | null }} LigneCommande
 * @typedef {'colis' | 'palette'} Envoi
 * @typedef {{ envoi: 'colis', evenement: string, action: 'email_client' | 'ordre_colis', gabarit: string }} ActionTransition
 * @typedef {{ envoi: 'palette', evenement: string, action: 'email_client', gabarit: string }} ActionTournee
 */

/** Gabarit de l'ordre d'expédition envoyé au prestataire colis. */
export const GABARIT_ORDRE_COLIS = 'webshop_ordre_colis';

/** @type {Record<string, 'expediee' | 'livree'>} */
const CIBLE_TOURNEE = { partie: 'expediee', livree: 'livree' };

const RANG = new Map(ORDER_BOARD_COLUMNS.map((c, i) => [c.id, i]));

/**
 * Sépare les lignes par envoi. `shippingKind` null (hors boutique / ancien modèle) : ignorée.
 * @param {LigneCommande[] | null | undefined} lines
 * @returns {{ colis: LigneCommande[], palette: LigneCommande[] }}
 */
export function envoisDeCommande(lines) {
  const l = Array.isArray(lines) ? lines : [];
  return {
    colis: l.filter((x) => x?.shippingKind === 'parcel'),
    palette: l.filter((x) => x?.shippingKind === 'pallet'),
  };
}

/**
 * Actions de l'envoi COLIS déclenchées par le passage de la commande au statut `to`.
 * `[]` si la commande n'a pas de ligne colis ou si la transition n'a pas de réglage.
 * L'ordre colis utilise toujours le gabarit `webshop_ordre_colis`.
 * @param {{ process?: any } | null | undefined} cfg configuration issue de `buildWebshopConfig`
 * @param {any} order commande (non lue aujourd'hui, gardée pour la signature commune)
 * @param {LigneCommande[]} lines
 * @param {string} to statut cible
 * @returns {ActionTransition[]}
 */
export function actionsPourTransition(cfg, order, lines, to) {
  if (envoisDeCommande(lines).colis.length === 0) return [];
  const reglage = cfg?.process?.transitions?.[to];
  if (!reglage) return [];
  /** @type {ActionTransition[]} */
  const actions = [];
  if (reglage.email_client) {
    actions.push({ envoi: 'colis', evenement: to, action: 'email_client', gabarit: reglage.email_client });
  }
  if (reglage.ordre_colis === true) {
    actions.push({ envoi: 'colis', evenement: to, action: 'ordre_colis', gabarit: GABARIT_ORDRE_COLIS });
  }
  return actions;
}

/**
 * Actions de l'envoi PALETTE pour un événement de tournée, et statut à poser sur la carte.
 * Rien si la commande n'est pas payée, est annulée, ou n'a pas de ligne palette.
 * `statutCible` (partie → `expediee`, livrée → `livree`) seulement si la commande n'a QUE des
 * lignes palette, que `canMoveTo` l'autorise et que c'est un pas EN AVANT sur le board (une
 * commande déjà livrée ne revient jamais à expédiée). Une commande mixte n'est jamais déplacée.
 * @param {{ process?: any } | null | undefined} cfg
 * @param {any} order
 * @param {LigneCommande[]} lines
 * @param {'partie' | 'livree'} event
 * @returns {{ actions: ActionTournee[], statutCible: 'expediee' | 'livree' | null }}
 */
export function actionsPourTournee(cfg, order, lines, event) {
  const rien = { actions: [], statutCible: null };
  const cible = CIBLE_TOURNEE[event];
  if (!cible || !order?.paid_at || order.status === 'annulee') return rien;
  const { colis, palette } = envoisDeCommande(lines);
  if (palette.length === 0) return rien;

  /** @type {ActionTournee[]} */
  const actions = [];
  const gabarit = cfg?.process?.tournee?.[event]?.email_client;
  if (gabarit) actions.push({ envoi: 'palette', evenement: `tournee_${event}`, action: 'email_client', gabarit });

  const enAvant = (RANG.get(cible) ?? -1) > (RANG.get(order.status) ?? Infinity);
  const statutCible = colis.length === 0 && canMoveTo(order.status, cible) && enAvant ? cible : null;
  return { actions, statutCible };
}

/**
 * Clé d'idempotence d'une action : une action `sent` pour cette clé ne repart jamais.
 * @param {{ orderId: string, envoi: string, evenement: string, action: string }} a
 * @returns {string}
 */
export function cleAction({ orderId, envoi, evenement, action }) {
  return [orderId, envoi, evenement, action].join(':');
}

/** @param {any} s @returns {string} */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/**
 * `YYYY-MM-DD…` → « mercredi 4 novembre 2026 » (calendrier, sans fuseau) ; invalide → ''.
 * @param {any} iso @returns {string}
 */
function dateFR(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3])) return '';
  return `${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** @param {number} kg @returns {string} */
function poidsFR(kg) {
  return `${String(Math.round(kg * 100) / 100).replace('.', ',')} kg`;
}

/**
 * Variables `{{VAR}}` d'un e-mail de commande, valeurs PRÊTES POUR DU HTML (texte échappé ;
 * `{{ITEMS}}` et `{{PARCELS_TABLE}}` sont du HTML construit ici, contenu échappé). Seules les
 * lignes de l'`envoi` sont citées ; sans `envoi`, toutes les lignes de la commande.
 * `{{DELIVERY_DATE}}` : date du créneau (`slot.date`) ou `order.delivery_date`, envoi palette
 * seulement (un colis n'a pas de date connue). Retrait : `{{DELIVERY_ADDRESS}}` = « Retrait : <point> ».
 * Poids inconnu sur une ligne → « non renseigné » (jamais 0 kg).
 * @param {{
 *   order: any, lines: LigneCommande[], envoi?: Envoi | null,
 *   company?: { name?: string, email?: string, phone?: string } | null,
 *   slot?: { date?: string } | null,
 *   depot?: { libelle?: string, adresse?: string } | null,
 *   siteUrl?: string | null,
 * }} p
 * @returns {Record<string, string>}
 */
export function variablesCommande({ order, lines, envoi = null, company = null, slot = null, depot = null, siteUrl = '' }) {
  const o = order ?? {};
  const toutes = Array.isArray(lines) ? lines : [];
  const parEnvoi = envoisDeCommande(toutes);
  const l = envoi === 'colis' ? parEnvoi.colis : envoi === 'palette' ? parEnvoi.palette : toutes;

  const items = `<ul>${l.map((x) => `<li>${esc(x.name)} × ${esc(x.qty)} — ${esc(formatCents(x.totalCents))}</li>`).join('')}</ul>`;

  const nom = [o.first_name, o.last_name].filter(Boolean).join(' ').trim() || o.company_name || '';
  const modeRetrait = envoi === 'colis' ? o.parcel_delivery_mode : envoi === 'palette' ? o.pallet_delivery_mode : null;
  const retrait = modeRetrait === 'pickup' || (!envoi && (o.parcel_delivery_mode === 'pickup' || o.pallet_delivery_mode === 'pickup'));
  const pointRetrait = retrait ? (o.pickup_point_name ?? '') : '';
  const ville = [o.postal_code, o.city].filter(Boolean).join(' ');
  const adresse = [o.address, ville].filter(Boolean).join(', ');

  const poidsConnus = l.length > 0 && l.every((x) => typeof x.weightKg === 'number' && Number.isFinite(x.weightKg));
  const poidsTotal = poidsConnus ? l.reduce((s, x) => s + /** @type {number} */ (x.weightKg) * (Number(x.qty) || 0), 0) : null;
  const valeur = l.reduce((s, x) => s + (Number(x.totalCents) || 0), 0);

  const tableau = [
    '<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse">',
    '<tr><th align="left">Article</th><th>Qté</th><th>Poids unitaire</th><th>Valeur</th></tr>',
    ...l.map((x) => `<tr><td>${esc(x.name)}</td><td align="center">${esc(x.qty)}</td>`
      + `<td align="right">${typeof x.weightKg === 'number' ? esc(poidsFR(x.weightKg)) : 'non renseigné'}</td>`
      + `<td align="right">${esc(formatCents(x.totalCents))}</td></tr>`),
    '</table>',
  ].join('');

  const blocs = blocsConfirmation({
    order: o, lines: toutes, slot: slot?.date ? slot : (o.delivery_date ? { date: o.delivery_date } : null),
    pickupPoint: o.pickup_point_name ? { name: o.pickup_point_name } : null, siteUrl,
  });

  return {
    '{{CLIENT_NAME}}': esc(nom),
    '{{ORDER_NUMBER}}': esc(o.order_number),
    '{{ITEMS}}': items,
    '{{DELIVERY_DATE}}': envoi === 'colis' ? '' : esc(dateFR(slot?.date ?? o.delivery_date)),
    // Point de retrait inconnu : vide, jamais un « Retrait : » orphelin.
    '{{DELIVERY_ADDRESS}}': retrait ? (pointRetrait ? `Retrait : ${esc(pointRetrait)}` : '') : esc(adresse),
    '{{PICKUP_POINT}}': esc(pointRetrait),
    '{{BRAND_NAME}}': esc(company?.name),
    '{{ORG_EMAIL}}': esc(company?.email),
    '{{ORG_PHONE}}': esc(company?.phone),
    '{{DEPOT_NAME}}': esc(depot?.libelle),
    '{{DEPOT_ADDRESS}}': esc(depot?.adresse),
    '{{PARCELS_TABLE}}': tableau,
    '{{TOTAL_WEIGHT}}': poidsTotal === null ? 'non renseigné' : esc(poidsFR(poidsTotal)),
    '{{DECLARED_VALUE}}': esc(formatCents(valeur)),
    '{{CLIENT_PHONE}}': esc(o.phone),
    '{{CLIENT_EMAIL}}': esc(o.email),
    // Confirmation (gabarit webshop_confirmation) : la commande entière, quel que soit l'envoi.
    '{{DELIVERY_INFO}}': blocs.livraisonHtml,
    '{{LEGAL_INFO}}': blocs.mentionsHtml,
  };
}
