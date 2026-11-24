/**
 * RepereCarte.jsx - Majord'home Artisan
 * ============================================================================
 * Pastilles de repère d'une carte de Kanban (après-vente d'un chantier réceptionné,
 * suites d'un entretien réalisé) : une seule apparence pour les deux tableaux.
 * L'état se lit à l'icône et au remplissage, jamais à la couleur seule.
 *
 *   fait      : plein vert + coche
 *   en_cours  : bleu pâle + horloge
 *   attention : ambre + triangle
 *   a_faire   : blanc, libellé gris
 *   inconnu   : pointillés (liste non chargée)
 *
 * Dans une rangée `RangeeReperes` trop étroite pour les libellés, seules les icônes restent
 * (le libellé passe dans l'infobulle) : règle CSS `.mdh-reperes[data-serree]` dans index.css (recette H22).
 * ============================================================================
 */

import { useLayoutEffect, useRef } from 'react';
import { Check, Clock, AlertTriangle, Loader2 } from 'lucide-react';

const REPERE_STYLES = {
  fait: { css: 'bg-st-ok text-white border-st-ok', Icone: Check },
  en_cours: { css: 'bg-st-info-bg text-st-info border-st-info/20', Icone: Clock },
  attention: { css: 'bg-st-attente-bg text-st-attente border-st-attente/30', Icone: AlertTriangle },
  a_faire: { css: 'bg-white text-secondary-400 border-secondary-200', Icone: null },
  inconnu: { css: 'bg-secondary-50 text-secondary-300 border-dashed border-secondary-200', Icone: null },
};

/** Infobulle : le libellé d'abord (il disparaît quand la rangée est serrée), puis l'explication. */
const infobulle = (repere) => (repere.titre && repere.titre !== repere.libelle ? `${repere.libelle} : ${repere.titre}` : repere.libelle);

const BASE = 'inline-flex min-w-0 items-center gap-0.5 text-caption leading-4 px-1 py-0.5 rounded-full font-bold border';

/**
 * Repère en lecture seule.
 * @param {{ repere: { etat: string, libelle: string, titre?: string } }} props
 */
export function RepereCarte({ repere }) {
  const { css, Icone } = REPERE_STYLES[repere.etat] || REPERE_STYLES.a_faire;
  return (
    <span className={`${BASE} ${css}`} title={infobulle(repere)}>
      {Icone && <Icone className="h-2.5 w-2.5 shrink-0" />}
      {/* Sans icône, le libellé reste toujours visible (une pastille vide ne dirait rien). */}
      <span className={`${Icone ? 'mdh-repere-libelle ' : ''}truncate`}>{repere.libelle}</span>
    </span>
  );
}

/**
 * Repère cliquable (une action) : même pastille, bordure plus marquée au survol.
 * Un repère « à faire » qui porte une action prend une icône pour se distinguer d'un simple état.
 * @param {{ repere: { etat: string, libelle: string, titre?: string }, onClick: Function,
 *   disabled?: boolean, enCours?: boolean, icone?: import('react').ComponentType }} props
 */
export function RepereBouton({ repere, onClick, disabled = false, enCours = false, icone: IconeAction = null }) {
  const { css, Icone } = REPERE_STYLES[repere.etat] || REPERE_STYLES.a_faire;
  const aFaire = repere.etat === 'a_faire';
  const IconeAffichee = enCours ? Loader2 : (Icone || IconeAction);
  return (
    <button
      type="button"
      disabled={disabled || enCours}
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      onKeyDown={(e) => e.stopPropagation()}
      title={infobulle(repere)}
      aria-label={infobulle(repere)}
      className={`${BASE} shrink-0 ${css} ${aFaire ? 'text-secondary-700 border-secondary-300 hover:bg-secondary-50 hover:border-secondary-400' : 'hover:brightness-95'} disabled:opacity-60 disabled:cursor-default`}
    >
      {IconeAffichee && <IconeAffichee className={`h-2.5 w-2.5 shrink-0 ${enCours ? 'animate-spin' : ''}`} />}
      <span className={`${IconeAffichee ? 'mdh-repere-libelle ' : ''}truncate`}>{repere.libelle}</span>
    </button>
  );
}

/**
 * Rangée de repères à largeur fixe : si les libellés débordent, ils sont masqués et seules les
 * icônes restent. Mesure faite seulement quand `actif` (colonne Réalisé : peu de cartes), sans
 * état React : le basculement ne change pas la largeur de la rangée, donc pas de boucle.
 * @param {{ actif?: boolean, className?: string, children: import('react').ReactNode }} props
 */
export function RangeeReperes({ actif = true, className = '', children }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!actif || !el) return undefined;
    const mesurer = () => {
      el.dataset.serree = 'false';
      el.dataset.serree = el.scrollWidth > el.clientWidth + 1 ? 'true' : 'false';
    };
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(el);
    return () => observateur.disconnect();
  });
  return <div ref={ref} className={`mdh-reperes ${className}`}>{children}</div>;
}
