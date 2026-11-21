/**
 * rechercheGlobale.js - Majord'home
 * ============================================================================
 * Règles de la recherche globale (Ctrl K) et du menu « Créer » : quelles pages
 * répondent à une saisie, comment un client ou un lead devient une ligne de
 * résultat, où mène chaque ligne, comment on se déplace au clavier, et quelles
 * créations sont proposées selon les droits. Module PUR (aucun import React /
 * Supabase / alias), testé par scripts/recherche-globale.test.mjs.
 *
 * La recherche elle-même n'est pas ici : clients par `useClientSearch`, leads par
 * `useLeadSearch` (RPC `lead_search`, insensible aux accents) — une seule
 * définition de « trouver un client » dans l'application.
 * ============================================================================
 */

/** Nombre de caractères à partir duquel clients et leads sont cherchés (comme les hooks). */
export const SAISIE_MINIMALE = 2;
const PAGES_MAX = 5;

/** Minuscules sans accents, pour comparer une saisie à un libellé. */
export function normaliser(texte) {
  return String(texte ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Pages du menu qui répondent à la saisie (tous les mots saisis dans le libellé).
 * @param {Array<{ name: string, href: string }>} pages  entrées VISIBLES du menu (droits déjà appliqués)
 * @param {string} saisie
 * @returns {Array<{ name: string, href: string }>}  au plus cinq ; rien pour une saisie vide
 */
export function pagesCorrespondantes(pages = [], saisie = '') {
  const mots = normaliser(saisie).split(/\s+/).filter(Boolean);
  if (mots.length === 0) return [];
  return (pages || [])
    .filter((page) => {
      const libelle = normaliser(page.name);
      return mots.every((mot) => libelle.includes(mot));
    })
    .slice(0, PAGES_MAX);
}

const lieu = (codePostal, ville) => [codePostal, ville].filter(Boolean).join(' ');
const joindre = (...parties) => parties.filter(Boolean).join(' · ');

/**
 * Lignes de résultat, dans l'ordre d'affichage : clients, leads, pages.
 * @param {object} p
 * @param {Array<object>} [p.clients]  lignes de `searchClients`
 * @param {Array<object>} [p.leads]  lignes de `searchLeads`
 * @param {Array<{ name: string, href: string }>} [p.pages]  cf. pagesCorrespondantes
 * @returns {Array<{ cle: string, groupe: 'Clients'|'Leads'|'Pages', titre: string, detail: string, href: string }>}
 */
export function lignesDeResultat({ clients = [], leads = [], pages = [] } = {}) {
  return [
    ...(clients || []).map((c) => ({
      cle: `client-${c.id}`,
      groupe: 'Clients',
      titre: c.display_name || 'Client sans nom',
      detail: joindre(c.client_number, lieu(c.postal_code, c.city), c.has_active_contract ? 'Contrat actif' : null),
      href: `/clients/${c.id}`,
    })),
    ...(leads || []).map((l) => ({
      cle: `lead-${l.id}`,
      groupe: 'Leads',
      titre: l.display_name || [l.last_name, l.first_name].filter(Boolean).join(' ') || 'Lead sans nom',
      detail: joindre(l.status_label, lieu(l.postal_code, l.city), l.source_name),
      href: `/pipeline?tab=kanban&lead=${l.id}`,
    })),
    ...(pages || []).map((p) => ({
      cle: `page-${p.href}`,
      groupe: 'Pages',
      titre: p.name,
      detail: '',
      href: p.href,
    })),
  ];
}

/**
 * Ligne suivante ou précédente au clavier, en boucle.
 * @param {number} index  ligne active (-1 = aucune)
 * @param {number} total
 * @param {1|-1} sens
 * @returns {number}  -1 s'il n'y a aucune ligne
 */
export function indexVoisin(index, total, sens) {
  if (total <= 0) return -1;
  if (index < 0) return sens > 0 ? 0 : total - 1;
  return (index + sens + total) % total;
}

/**
 * Créations proposées par le menu « Créer », selon les droits de la personne.
 * @param {{ rdv?: boolean, lead?: boolean, client?: boolean }} droits
 * @returns {Array<{ cle: string, libelle: string, href: string }>}
 */
export function actionsCreer({ rdv = false, lead = false, client = false } = {}) {
  return [
    rdv && { cle: 'rdv', libelle: 'Nouveau RDV', href: '/planning?nouveau=1' },
    lead && { cle: 'lead', libelle: 'Nouveau lead', href: '/pipeline?tab=kanban&new=1' },
    client && { cle: 'client', libelle: 'Nouveau client', href: '/clients?new=1' },
  ].filter(Boolean);
}
