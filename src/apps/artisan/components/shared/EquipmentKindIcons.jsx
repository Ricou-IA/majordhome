/**
 * EquipmentKindIcons.jsx - Majord'home Artisan
 * ============================================================================
 * Icônes d'identité visuelle des équipements d'un client :
 *   bûche (bois) / flamme (granulés) / flocon (clim & PAC).
 * 1 icône par équipement identifiable — rien si le type n'est pas saisi
 * (règle produit : jamais de devinette bois vs granulés).
 *
 * Autonome : lit le cache partagé useClientEquipmentKinds (1 requête par org,
 * dédoublonnée par React Query) — se pose dans n'importe quelle carte/ligne
 * sans prop drilling. Classement : src/lib/equipmentIcons.js (module pur testé).
 *
 * Surfaces : ClientCard, ContractCard, Programmation (ContractRow), Planning.
 * ============================================================================
 */

import { Flame, FlameKindling, Snowflake } from 'lucide-react';
import { useClientEquipmentKinds } from '@hooks/useClients';

const KIND_ICONS = {
  buche: { Icon: FlameKindling, colorClass: 'text-amber-700' },
  flamme: { Icon: Flame, colorClass: 'text-orange-600' },
  flocon: { Icon: Snowflake, colorClass: 'text-sky-600' },
};

const SIZE_CLASSES = {
  xs: 'w-3 h-3',
  sm: 'w-3.5 h-3.5',
};

/**
 * @param {Object} props
 * @param {string} props.clientId - Client dont on affiche les équipements
 * @param {'xs'|'sm'} [props.size='sm'] - Taille des icônes
 * @param {boolean} [props.monochrome=false] - Hérite la couleur du texte (planning : blanc sur bloc coloré)
 * @param {string} [props.className]
 */
export function EquipmentKindIcons({ clientId, size = 'sm', monochrome = false, className = '' }) {
  const { kindsByClientId } = useClientEquipmentKinds();
  const kinds = clientId ? kindsByClientId?.get(clientId) : null;

  if (!kinds?.length) return null;

  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.sm;

  return (
    <span className={`inline-flex items-center gap-0.5 flex-shrink-0 ${className}`}>
      {kinds.map(({ kind, label }, i) => {
        const conf = KIND_ICONS[kind];
        if (!conf) return null;
        const { Icon, colorClass } = conf;
        return (
          <span key={`${kind}-${i}`} title={label} className="inline-flex">
            <Icon className={`${sizeClass} ${monochrome ? '' : colorClass}`} aria-label={label} />
          </span>
        );
      })}
    </span>
  );
}

export default EquipmentKindIcons;
