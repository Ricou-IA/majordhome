/**
 * EquipmentKindIcons.jsx - Majord'home Artisan
 * ============================================================================
 * Icônes d'identité visuelle des équipements d'un client :
 *   sapin (bois) / flamme (granulés) / flocon (clim & PAC).
 * 1 icône par équipement identifiable — rien si le type n'est pas saisi
 * (règle produit : jamais de devinette bois vs granulés).
 *
 * Icônes Lucide à la couleur du texte (currentColor) : lisibles sur les blocs
 * planning colorés comme sur une carte blanche. Le libellé de l'équipement est
 * porté par `title` et `aria-label`, jamais par la couleur.
 *
 * Autonome : lit le cache partagé useClientEquipmentKinds (1 requête par org,
 * dédoublonnée par React Query) — se pose dans n'importe quelle carte/ligne
 * sans prop drilling. Classement : src/lib/equipmentIcons.js (module pur testé).
 *
 * Surfaces : ClientCard, ContractCard, Programmation (ContractRow), Planning.
 * ============================================================================
 */

import { Flame, Snowflake, TreePine } from 'lucide-react';
import { useClientEquipmentKinds } from '@hooks/useClients';

const KIND_ICON = {
  buche: TreePine,
  flamme: Flame,
  flocon: Snowflake,
};

// 12 px en `xs` (planning, tableaux : texte de 11-12 px, interligne 13 px) :
// l'icône ne rend jamais une ligne plus haute. 16 px en `sm` (cartes).
const SIZE_CLASSES = {
  xs: 'h-3 w-3',
  sm: 'h-4 w-4',
};

/**
 * @param {Object} props
 * @param {string} props.clientId - Client dont on affiche les équipements
 * @param {'xs'|'sm'} [props.size='sm'] - Taille des icônes
 * @param {string} [props.className]
 */
export function EquipmentKindIcons({ clientId, size = 'sm', className = '' }) {
  const { kindsByClientId } = useClientEquipmentKinds();
  const kinds = clientId ? kindsByClientId?.get(clientId) : null;

  if (!kinds?.length) return null;

  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.sm;

  return (
    <span className={`inline-flex items-center gap-px flex-shrink-0 leading-none ${className}`}>
      {kinds.map(({ kind, label }, i) => {
        const Icone = KIND_ICON[kind];
        if (!Icone) return null;
        return (
          <span key={`${kind}-${i}`} title={label} role="img" aria-label={label} className="inline-flex">
            <Icone className={`inline-block ${sizeClass} align-[-1px] shrink-0`} aria-hidden="true" />
          </span>
        );
      })}
    </span>
  );
}

export default EquipmentKindIcons;
