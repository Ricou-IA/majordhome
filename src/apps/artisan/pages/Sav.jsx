/**
 * Sav.jsx - Page SAV
 * ============================================================================
 * Le SAV a son écran (Eric 2026-11-25), à part des entretiens. Une demande entre ici ;
 * elle en sort par une intervention (Réalisé), par l'entretien qu'on lui ajoute (la carte
 * passe côté Entretiens) ou par un devis de remplacement (chantier).
 *
 * La page assemble : le kanban est EntretienSAVKanban (zone="sav"), les règles de colonnes
 * et le résumé sont dans src/lib/kanbanEntretienSav.js.
 * ============================================================================
 */

import { useMemo } from 'react';
import { useAuth } from '@contexts/AuthContext';
import { useEntretienSAV } from '@hooks/useEntretienSAV';
import { EntretienSAVKanban } from '@apps/artisan/components/entretiens/EntretienSAVKanban';
import { PageHeader } from '@/components/ui/page-header';
import { Squelette } from '@/components/ui/squelette';
import { resumeSav } from '@/lib/kanbanEntretienSav';

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

export default function Sav() {
  const { organization, loading: authLoading } = useAuth();
  const orgId = organization?.id;
  // Même requête que le kanban (clé partagée) : pas de second chargement.
  const { items, isLoading, error } = useEntretienSAV(orgId);

  // Ce qui attend, en une ligne. Inconnu (chargement, échec) ⇒ rien d'affiché, jamais 0.
  const sousTitre = useMemo(() => {
    if (isLoading || error || !orgId) return null;
    const r = resumeSav(items);
    return [
      pluriel(r.demandes, 'demande à traiter', 'demandes à traiter'),
      pluriel(r.devis, 'devis envoyé', 'devis envoyés'),
      `${r.aPlanifier} à planifier`,
      pluriel(r.planifies, 'planifié', 'planifiés'),
    ].join(' · ');
  }, [items, isLoading, error, orgId]);

  if (authLoading || !orgId) {
    return (
      <div className="p-4 md:p-8 space-y-6">
        <Squelette className="h-8 w-40" />
        <Squelette className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-6">
      <PageHeader title="SAV" subtitle={sousTitre} />
      <EntretienSAVKanban zone="sav" />
    </div>
  );
}
