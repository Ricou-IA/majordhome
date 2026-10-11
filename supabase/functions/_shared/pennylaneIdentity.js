// supabase/functions/_shared/pennylaneIdentity.js
// Synchro BIDIRECTIONNELLE de l'identité client Majord'home ⇄ Pennylane — règles PURES.
// Aucun import (Deno, Supabase, réseau) : testé par `node --test scripts/pennylane-identity.test.mjs`
// et importé tel quel par les edges (`pennylane-customer-push`, `pennylane-sync-quote-status`).
//
// Décision Eric 2026-10-11 : la fiche peut être modifiée des DEUX côtés. On ne propage que des
// CHANGEMENTS, jamais un état complet :
//   - MDH → PL : au save de la fiche, les seules colonnes modifiées sont poussées (PUT partiel,
//     vérifié par sonde le 2026-10-11 : les champs absents du corps restent intacts, `emails`
//     REMPLACE la liste, `billing_address` partiel fusionne).
//   - PL → MDH : le journal `/changelogs/customers` désigne les clients modifiés ; on compare la
//     fiche PL fraîche à la DERNIÈRE fiche PL connue (cache `pennylane_customer_lookup`, base
//     posée par ces edges) et on n'écrit dans MDH que les champs que Pennylane a changés.
//   - Conflit (même champ modifié des deux côtés entre deux passages) : n'existe que pour un champ
//     MDH dont le push a échoué (« en attente »). Le plus récent gagne : date de la saisie MDH
//     contre `updated_at` Pennylane. Un push réussi a déjà écrit la valeur MDH dans PL ET dans le
//     cache : Pennylane n'y voit donc aucun changement (pas d'écho).

/** Champs d'identité comparés entre la fiche PL et la fiche MDH (noms des colonnes MDH). */
export const IDENTITY_FIELDS = ['first_name', 'last_name', 'email', 'phone', 'address', 'postal_code', 'city'];

/**
 * Colonnes MDH dont la modification part dans Pennylane. `address_complement` voyage avec
 * `address` (PL n'a qu'une ligne, cf. buildPennylaneCustomer à la création) ; `company_name` /
 * `display_name` portent le nom d'une société.
 */
export const PUSHABLE_COLUMNS = [
  'first_name', 'last_name', 'company_name', 'display_name',
  'email', 'phone', 'address', 'address_complement', 'postal_code', 'city',
];

/** @param {unknown} v @returns {string|null} */
function clean(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

/**
 * Ligne d'adresse PL d'un client MDH : `address, complément` — même règle qu'à la création.
 * @param {{ address?: string|null, address_complement?: string|null }} client
 * @returns {string|null}
 */
export function plAddressLine(client) {
  return clean([clean(client?.address), clean(client?.address_complement)].filter(Boolean).join(', '));
}

/**
 * Identité à plat d'un customer Pennylane V2 (ressource au ROOT, pas d'enveloppe).
 * `email` = premier de `emails[]`, adresse = `billing_address`.
 * @param {Record<string, any>} c
 * @returns {{ first_name: string|null, last_name: string|null, email: string|null, phone: string|null,
 *   address: string|null, postal_code: string|null, city: string|null, name: string|null,
 *   customer_type: string|null }}
 */
export function identityFromPlCustomer(c) {
  const ba = (c && typeof c.billing_address === 'object' && c.billing_address) || {};
  const firstEmail = Array.isArray(c?.emails) ? c.emails.find((e) => clean(e)) : null;
  const first = clean(c?.first_name);
  const last = clean(c?.last_name);
  return {
    first_name: first,
    last_name: last,
    email: clean(firstEmail) ?? clean(c?.billing_email) ?? clean(c?.email),
    phone: clean(c?.phone),
    address: clean(ba.address),
    postal_code: clean(ba.postal_code),
    city: clean(ba.city),
    name: clean(c?.name) ?? clean([first, last].filter(Boolean).join(' ')),
    customer_type: clean(c?.customer_type),
  };
}

/**
 * Champs d'identité qui diffèrent entre deux fiches PL (ancienne connue → fraîche).
 * Comparaison sur valeurs nettoyées, insensible à la casse pour l'e-mail.
 * @param {Record<string, any>} before
 * @param {Record<string, any>} after
 * @returns {string[]}
 */
export function changedIdentityFields(before, after) {
  return IDENTITY_FIELDS.filter((f) => {
    const a = clean(before?.[f]);
    const b = clean(after?.[f]);
    if (f === 'email') return (a ?? '').toLowerCase() !== (b ?? '').toLowerCase();
    return a !== b;
  });
}

/**
 * Corps du PUT partiel `/individual_customers/{id}` ou `/company_customers/{id}` pour les
 * colonnes MDH modifiées. Ne vide JAMAIS un champ Pennylane (valeur MDH vide = ignorée).
 * L'endpoint dépend du type PL (lu par GET /customers/{id}) : appeler `individual_customers`
 * avec l'id d'une société RÉUSSIT et corrompt la fiche (doc Pennylane).
 *
 * @param {{ client: Record<string, any>, columns: string[], plCustomer: Record<string, any> }} p
 * @returns {{ path: string, body: Record<string, any>, fields: string[] } | null}
 *   `fields` = champs d'identité (IDENTITY_FIELDS) effectivement envoyés ; null si rien à pousser.
 */
export function buildPlUpdate({ client, columns, plCustomer }) {
  const type = clean(plCustomer?.customer_type);
  if (type !== 'individual' && type !== 'company') return null;
  const cols = new Set(columns || []);
  const body = {};
  const fields = [];

  if (type === 'individual') {
    for (const f of ['first_name', 'last_name']) {
      const v = clean(client?.[f]);
      if (cols.has(f) && v) { body[f] = v; fields.push(f); }
    }
  } else if (cols.has('company_name') || cols.has('display_name')) {
    const name = clean(client?.company_name) ?? clean(client?.display_name);
    if (name) body.name = name;
  }

  const phone = clean(client?.phone);
  if (cols.has('phone') && phone) { body.phone = phone; fields.push('phone'); }

  const email = clean(client?.email);
  if (cols.has('email') && email) {
    // `emails` REMPLACE la liste : on ne touche que le premier, les autres sont conservés.
    const others = (Array.isArray(plCustomer?.emails) ? plCustomer.emails : [])
      .slice(1)
      .filter((e) => clean(e) && clean(e).toLowerCase() !== email.toLowerCase());
    body.emails = [email, ...others];
    fields.push('email');
  }

  const billing = {};
  const line = plAddressLine(client);
  if ((cols.has('address') || cols.has('address_complement')) && line) { billing.address = line; fields.push('address'); }
  for (const f of ['postal_code', 'city']) {
    const v = clean(client?.[f]);
    if (cols.has(f) && v) { billing[f] = v; fields.push(f); }
  }
  if (Object.keys(billing).length > 0) body.billing_address = billing;

  if (Object.keys(body).length === 0) return null;
  return {
    path: type === 'individual' ? `/individual_customers/${plCustomer.id}` : `/company_customers/${plCustomer.id}`,
    body,
    fields,
  };
}

/**
 * Champs à écrire dans MDH après un changement constaté côté Pennylane.
 *
 * @param {{
 *   changed: string[],                       // changedIdentityFields(cache, frais)
 *   plIdentity: Record<string, any>,         // identityFromPlCustomer(frais)
 *   plUpdatedAt: string|null,                // updated_at de la fiche PL fraîche
 *   client: Record<string, any>,             // fiche MDH courante
 *   pending: Record<string, string>|null,    // COLONNES MDH non poussées → date de la saisie
 * }} p
 * @returns {{ apply: Record<string, string>, dropPending: string[], conflictsKeptMdh: string[] }}
 *   `apply` : champs à écrire (jamais vide, jamais un nom de particulier sur une société) ;
 *   `dropPending` : colonnes en attente que Pennylane a modifiées plus récemment (MDH perd) ;
 *   `conflictsKeptMdh` : colonnes en attente plus récentes que PL (MDH gagne, le push repartira).
 */
export function planPullUpdate({ changed, plIdentity, plUpdatedAt, client, pending }) {
  const apply = {};
  const dropPending = [];
  const conflictsKeptMdh = [];
  const isCompany = plIdentity?.customer_type === 'company';
  const plTime = plUpdatedAt ? Date.parse(plUpdatedAt) : NaN;

  for (const f of changed || []) {
    if (isCompany && (f === 'first_name' || f === 'last_name')) continue;
    const v = clean(plIdentity?.[f]);
    if (!v) continue; // Pennylane a vidé le champ : on ne vide pas la fiche MDH

    // `pending` est indexé par COLONNE MDH : l'adresse PL couvre address + complément.
    const cols = f === 'address' ? ['address', 'address_complement'] : [f];
    const pendingCols = cols.filter((c) => pending && pending[c]);
    if (pendingCols.length > 0) {
      const mdhTime = Math.max(...pendingCols.map((c) => Date.parse(pending[c])).filter(Number.isFinite));
      if (Number.isFinite(mdhTime) && (!Number.isFinite(plTime) || mdhTime >= plTime)) {
        conflictsKeptMdh.push(...pendingCols);
        continue;
      }
      dropPending.push(...pendingCols);
    }

    // Écho de notre propre ligne « adresse, complément » : rien n'a changé côté MDH.
    if (f === 'address' && v === plAddressLine(client)) continue;
    if (clean(client?.[f]) === v) continue;
    apply[f] = v;
  }
  return { apply, dropPending, conflictsKeptMdh };
}

/**
 * Colonnes MDH modifiées entre deux états de la fiche, restreintes à PUSHABLE_COLUMNS.
 * @param {Record<string, any>} before
 * @param {Record<string, any>} after
 * @returns {string[]}
 */
export function changedPushableColumns(before, after) {
  return PUSHABLE_COLUMNS.filter((c) => (clean(before?.[c]) ?? '') !== (clean(after?.[c]) ?? ''));
}
