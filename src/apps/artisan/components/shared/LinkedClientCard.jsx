// src/apps/artisan/components/shared/LinkedClientCard.jsx
import { UserCircle } from 'lucide-react';

/**
 * Carte présentationnelle "Client lié" partagée (pipeline + entretien).
 * Pure : aucune logique métier. Le bouton d'action est passé en `children`
 * (slot à droite) → chaque appelant câble son propre comportement.
 *
 * @param {Object} props
 * @param {string} props.name           - Nom affiché (gras)
 * @param {string} [props.clientNumber] - N° client (ex. CLI-03304)
 * @param {string} [props.city]         - Ville (ligne secondaire)
 * @param {React.ReactNode} [props.children] - Bouton d'action (droite)
 */
export function LinkedClientCard({ name, clientNumber, city, children }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
      <UserCircle className="h-5 w-5 text-blue-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-blue-800 truncate block">{name}</span>
        {(city || clientNumber) && (
          <span className="text-xs text-blue-600">
            {clientNumber}{city ? ` — ${city}` : ''}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export default LinkedClientCard;
