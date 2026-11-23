/**
 * Chantiers.jsx - Majord'home Artisan
 * ============================================================================
 * Page de suivi des chantiers (workflow post-vente).
 * Kanban 5 colonnes : Gagné → Commande à faire → Commande reçue → Planification → Réalisé
 *
 * @version 1.0.0 - Sprint 6 Chantiers
 * ============================================================================
 */

import { ChantierKanban } from '@apps/artisan/components/chantiers/ChantierKanban';
import { PageHeader } from '@/components/ui/page-header';

export default function Chantiers() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader title="Chantiers" />

      {/* Kanban */}
      <ChantierKanban />
    </div>
  );
}
