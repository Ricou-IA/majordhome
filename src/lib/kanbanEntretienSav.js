/**
 * kanbanEntretienSav.js — zones et colonnes des kanbans SAV et Entretiens
 * ============================================================================
 * Module PUR, testé `scripts/kanban-entretien-sav.test.mjs`.
 *
 * Deux écrans, deux kanbans (Eric 2026-11-25 : « ça devient trop fouillis ») :
 *   - SAV (`/sav`) : la demande entre ici — Demande · Devis envoyé · À planifier ·
 *     Planifié · Réalisé · Encaissé ;
 *   - Entretiens (`/entretiens`) : À planifier · Planifié · Réalisé · Encaissé.
 * Une carte SAV à laquelle on ajoute l'entretien (`includes_entretien`) quitte le SAV et
 * se suit côté Entretiens : un seul passage, une seule carte.
 *
 * Le statut d'une carte (`workflow_status`) ne change pas ; seul son AFFICHAGE change :
 *   - « Demande de contrat » n'a pas de colonne : une proposition de contrat se suit dans
 *     l'espace Contrats, pas dans le suivi des interventions ;
 *   - « Pièces commandées » n'a pas de colonne : la carte SAV va dans « À planifier »
 *     avec sa bande de date HACHURÉE tant que les pièces ne sont pas reçues — comme la
 *     pose provisoire d'un chantier (bande hachurée tant que les appros manquent) ;
 *   - côté Entretiens, une carte SAV encore en « Demande » ou « Devis envoyé » est rangée
 *     dans « À planifier » (ces colonnes n'existent que dans le SAV).
 * ============================================================================
 */

/** Les deux kanbans. */
export const ZONES = ['sav', 'entretien'];

/** Colonnes de chaque kanban, dans l'ordre d'affichage (valeurs de `KANBAN_COLUMNS`). */
export const COLONNES_PAR_ZONE = {
  sav: ['demande', 'devis_envoye', 'a_planifier', 'planifie', 'realise', 'facture'],
  entretien: ['a_planifier', 'planifie', 'realise', 'facture'],
};

/**
 * Kanban où se suit une carte : un SAV dans le SAV, sauf si l'entretien lui a été ajouté ;
 * un entretien dans Entretiens.
 * @param {{ intervention_type?: string, includes_entretien?: (boolean|null) } | null | undefined} item
 * @returns {'sav' | 'entretien' | null}
 */
export function zoneDeCarte(item) {
  if (!item) return null;
  if (item.intervention_type === 'sav' && !item.includes_entretien) return 'sav';
  return 'entretien';
}

/**
 * Colonne affichée d'une carte ; null = la carte n'est pas montrée dans le kanban.
 * Une demande SAV reliée à un projet (devis de remplacement, `item.projet` posé par
 * `etatProjet` de savProjet.js) suit ce projet : devis en attente ou chantier créé → hors
 * kanban, même planifiée (le projet se suit dans Leads et Chantiers, Eric 2026-11-25/26),
 * sauf réalisée ou facturée ; devis refusé → « Demande » si elle n'était pas planifiée ;
 * projet pas encore lu → « Devis envoyé » (jamais masquée sur une lecture inconnue).
 *
 * @param {{ workflow_status?: (string|null), projet?: ({ etat?: string } | null) } | null | undefined} item
 * @param {'sav' | 'entretien' | null} [zone] kanban affiché (défaut : colonnes du SAV)
 * @returns {string | null}
 */
export function colonneDeCarte(item, zone = null) {
  const statut = item?.workflow_status;
  if (!statut || statut === 'demande_contrat') return null;
  if (statut === 'pieces_commandees') return 'a_planifier';
  const avantPlanification = ['demande', 'devis_envoye'].includes(statut);
  if (zone === 'entretien') return avantPlanification ? 'a_planifier' : statut;
  const projet = item.projet?.etat;
  // Passée en projet (devis en attente ou chantier) : suivie dans Leads / Chantiers, même
  // planifiée (BOYER, Eric 2026-11-26). Seule une carte réalisée ou facturée reste ici.
  if ((projet === 'chantier' || projet === 'en_cours') && !['realise', 'facture'].includes(statut)) return null;
  if (avantPlanification) {
    if (projet === 'perdu') return 'demande';
    if (projet === 'inconnu') return 'devis_envoye';
  }
  return statut;
}

/** Colonnes du registre qui n'ont plus de colonne à l'écran. */
export const COLONNES_SANS_COLONNE = ['demande_contrat', 'pieces_commandees'];

/**
 * SAV en attente de pièces : commandées (ou devis accepté, pièces à commander) et pas
 * encore reçues. La carte reste planifiable ; sa bande est hachurée.
 * @param {{ intervention_type?: string, workflow_status?: string, parts_order_status?: (string|null) } | null | undefined} item
 * @returns {boolean}
 */
export function piecesEnAttente(item) {
  if (!item || item.intervention_type !== 'sav') return false;
  if (['realise', 'facture'].includes(item.workflow_status)) return false;
  if (item.parts_order_status === 'recu') return false;
  return item.parts_order_status === 'commande' || item.workflow_status === 'pieces_commandees';
}

/**
 * Statut visé quand une carte est déposée dans une colonne. Un SAV « Devis envoyé » déposé
 * dans « À planifier » passe par l'acceptation du devis (statut `pieces_commandees`,
 * affiché dans « À planifier »).
 * @param {{ workflow_status?: string }} item
 * @param {string} colonne  colonne de dépôt
 * @returns {string}
 */
export function statutViseParDepot(item, colonne) {
  if (colonne === 'a_planifier' && item?.workflow_status === 'devis_envoye') return 'pieces_commandees';
  return colonne;
}

/**
 * Statut d'une carte SAV quand ses pièces sont notées « Reçu » : une carte qui attendait
 * (demande, devis envoyé, pièces commandées) devient « À planifier ». Une carte déjà planifiée,
 * réalisée ou encaissée ne bouge pas — sinon le RDV posé resterait au planning avec une carte
 * revenue « À planifier » (vécu LENDRIN, 2026-11-25).
 * @param {{ workflow_status?: (string|null) } | null | undefined} item
 * @returns {string | null} statut à écrire, null = rien à changer
 */
export function statutApresPiecesRecues(item) {
  return ['demande', 'devis_envoye', 'pieces_commandees'].includes(item?.workflow_status) ? 'a_planifier' : null;
}

/**
 * Statut d'une carte SAV au moment où on lui ajoute l'entretien : une demande pas encore
 * traitée devient « À planifier » (le passage est décidé) ; tout autre statut est gardé.
 * @param {{ workflow_status?: (string|null) } | null | undefined} item
 * @returns {string | null} statut à écrire, null = rien à changer
 */
export function statutApresAjoutEntretien(item) {
  return item?.workflow_status === 'demande' ? 'a_planifier' : null;
}

/**
 * Carte SAV avec entretien dont le devis n'est pas tranché : côté Entretiens elle est dans
 * « À planifier » et doit pouvoir se planifier, ce que les transitions du SAV ne prévoient pas.
 * @param {{ intervention_type?: string, includes_entretien?: (boolean|null), workflow_status?: string } | null | undefined} item
 * @returns {boolean}
 */
export function planifiableAvecEntretien(item) {
  return !!item && item.intervention_type === 'sav' && !!item.includes_entretien
    && ['demande', 'devis_envoye'].includes(item.workflow_status);
}

/**
 * Ce qui attend dans le SAV, pour le sous-titre de la page : cartes du kanban SAV seulement.
 * @param {Array<object> | null | undefined} items  toutes les cartes (entretiens compris)
 * @returns {{ demandes: number, devis: number, aPlanifier: number, planifies: number }}
 */
export function resumeSav(items) {
  const resume = { demandes: 0, devis: 0, aPlanifier: 0, planifies: 0 };
  const cle = { demande: 'demandes', devis_envoye: 'devis', a_planifier: 'aPlanifier', planifie: 'planifies' };
  (items || []).forEach((item) => {
    if (zoneDeCarte(item) !== 'sav') return;
    const compteur = cle[colonneDeCarte(item, 'sav')];
    if (compteur) resume[compteur] += 1;
  });
  return resume;
}
