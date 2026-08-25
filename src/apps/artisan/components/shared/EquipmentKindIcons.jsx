/**
 * EquipmentKindIcons.jsx - Majord'home Artisan
 * ============================================================================
 * Icônes d'identité visuelle des équipements d'un client :
 *   🪵 bûche (bois) / 🔥 flamme (granulés) / ❄️ flocon (clim & PAC).
 * 1 icône par équipement identifiable — rien si le type n'est pas saisi
 * (règle produit : jamais de devinette bois vs granulés).
 *
 * Emoji natifs (pas de Lucide) : rendus colorés par la police système,
 * lisibles aussi sur les blocs planning colorés. ⚠️ 🪵 (U+1FAB5, Unicode 13)
 * n'existe pas sous Windows 10 (carré vide) — assumé, parc Mayer = Win11/tablettes.
 *
 * Autonome : lit le cache partagé useClientEquipmentKinds (1 requête par org,
 * dédoublonnée par React Query) — se pose dans n'importe quelle carte/ligne
 * sans prop drilling. Classement : src/lib/equipmentIcons.js (module pur testé).
 *
 * Surfaces : ClientCard, ContractCard, Programmation (ContractRow), Planning.
 * ============================================================================
 */

import { useClientEquipmentKinds } from '@hooks/useClients';

const KIND_EMOJI = {
  buche: '\u{1FAB5}', // 🪵
  flamme: '\u{1F525}', // 🔥
  flocon: '❄️', // ❄️ (VS16 : force le rendu emoji coloré)
};

const SIZE_CLASSES = {
  xs: 'text-[11px]',
  sm: 'text-[13px]',
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
    <span className={`inline-flex items-center gap-0.5 flex-shrink-0 leading-none ${sizeClass} ${className}`}>
      {kinds.map(({ kind, label }, i) => {
        const emoji = KIND_EMOJI[kind];
        if (!emoji) return null;
        return (
          <span key={`${kind}-${i}`} title={label} role="img" aria-label={label}>
            {emoji}
          </span>
        );
      })}
    </span>
  );
}

export default EquipmentKindIcons;
