/**
 * Chantiers.jsx - Majord'home Artisan
 * ============================================================================
 * Page de suivi des chantiers (workflow post-vente).
 * Kanban 5 colonnes : Gagné → Commande à faire → Commande reçue → Planification → Réalisé
 *
 * @version 1.0.0 - Sprint 6 Chantiers
 * ============================================================================
 */

import { HardHat } from 'lucide-react';
import { ChantierKanban } from '@apps/artisan/components/chantiers/ChantierKanban';

export default function Chantiers() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
          <HardHat className="w-7 h-7 text-amber-600" />
          Chantiers
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Suivi post-vente : commandes, planification et réalisation
        </p>
      </div>

      {/* Kanban */}
      <ChantierKanban />
    </div>
  );
}
