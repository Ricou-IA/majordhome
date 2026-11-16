/**
 * leadCardDate.js — la date affichée sur une carte du pipeline.
 * ============================================================================
 * Module PUR (aucun import). La date dépend de la COLONNE où la carte est posée,
 * pas du statut du lead : sur une org Pennylane, une carte est en Gagné / Perdu
 * parce que ses devis le sont, alors que `leads.status_id` est resté en
 * « Devis envoyé ».
 *
 * Règle (Eric, 2026-11-17) :
 *   Nouveau      → création de la carte
 *   Contacté     → dernier contact (appel, relance, interaction notée)
 *   RDV planifié → date du RDV
 *   Devis envoyé → date du PREMIER devis transmis
 *   Gagné        → passage en gagné
 *   Perdu        → passage en perdu
 *
 * Une date inconnue reste `null` : la carte affiche alors une icône, jamais une
 * autre date à la place (une date de création sous l'étiquette « Perdu le »
 * serait un mensonge).
 * ============================================================================
 */

/**
 * @typedef {Object} DateDeCarte
 * @property {string|null} date       valeur brute (`YYYY-MM-DD` ou horodatage ISO), `null` si inconnue
 * @property {string} libelle         ce que la date représente (« Créé le », « Premier devis le »…)
 * @property {boolean} aReplanifier   colonne RDV planifié sans RDV actif au planning
 */

const temps = (valeur) => {
  if (!valeur) return null;
  const t = new Date(valeur).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * La plus récente des dates fournies (valeur brute conservée), `null` si aucune n'est lisible.
 * @param {Array<string|null|undefined>} valeurs
 * @returns {string|null}
 */
export function plusRecente(valeurs) {
  let meilleure = null;
  let meilleurTemps = null;
  for (const v of valeurs) {
    const t = temps(v);
    if (t === null) continue;
    if (meilleurTemps === null || t > meilleurTemps) {
      meilleure = v;
      meilleurTemps = t;
    }
  }
  return meilleure;
}

/** Le statut porté par le lead est-il « Perdu » (final et non gagné) ? */
const statutPerdu = (lead) => lead?.status_is_final === true && lead?.status_is_won !== true;

/**
 * @param {Object} p
 * @param {string} p.columnKey  colonne où la carte est affichée (`nouveau`, `contacte`, `rdv_planifie`,
 *                              `devis_envoye`, `gagne`, `perdu`)
 * @param {Object} p.lead       ligne de `majordhome_leads`
 * @param {Object|null} [p.card] ligne de `majordhome_kanban_cards` (absente pour une carte sans vue)
 * @returns {DateDeCarte}
 */
export function dateDeCarte({ columnKey, lead, card = null }) {
  const sans = { aReplanifier: false };
  if (!lead) return { date: null, libelle: '', ...sans };

  switch (columnKey) {
    case 'nouveau':
      return { date: lead.created_date || lead.created_at || null, libelle: 'Créé le', ...sans };

    case 'contacte':
      return {
        date: plusRecente([lead.last_call_date, lead.last_followup_date, lead.last_interaction_at]),
        libelle: 'Dernier contact le',
        ...sans,
      };

    case 'rdv_planifie': {
      // La vue dit si un RDV commercial actif existe. Sans carte de la vue (ou carte
      // encore rangée ailleurs, le temps d'un rechargement), on s'en tient au lead.
      const vueEnRdv = card?.column_key === 'rdv_planifie';
      if (vueEnRdv && !card.has_active_rdv) {
        return { date: null, libelle: 'RDV à replanifier', aReplanifier: true };
      }
      return {
        date: (vueEnRdv && card.next_rdv_date) || lead.appointment_date || null,
        libelle: 'RDV le',
        ...sans,
      };
    }

    case 'devis_envoye':
      return {
        date: card?.first_quote_date || lead.quote_sent_date || null,
        libelle: 'Premier devis le',
        ...sans,
      };

    case 'gagne':
      return {
        date: lead.won_date
          || card?.quotes_validated_at
          || (lead.status_is_won === true ? lead.status_changed_at : null)
          || null,
        libelle: 'Gagné le',
        ...sans,
      };

    case 'perdu': {
      // Carte portée par des devis Pennylane : la perte est le dernier refus. Sinon
      // (ou si le miroir ne connaît pas ce devis) : le jour où le statut est passé en Perdu.
      const parDevis = (Number(card?.devis_count) || 0) > 0 ? card.quotes_refused_at : null;
      return {
        date: parDevis || (statutPerdu(lead) ? lead.status_changed_at : null) || null,
        libelle: 'Perdu le',
        ...sans,
      };
    }

    default:
      return { date: lead.created_date || lead.created_at || null, libelle: 'Créé le', ...sans };
  }
}
