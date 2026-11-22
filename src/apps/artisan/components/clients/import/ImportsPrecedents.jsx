/**
 * ImportsPrecedents.jsx - Import des clients
 * Liste des imports déjà faits, avec le retrait d'un import (les fiches déjà utilisées ailleurs — contrat,
 * intervention, devis, e-mail envoyé… — sont conservées, et l'import reste dans la liste tant qu'il en a).
 * Rien n'est affiché tant qu'aucun import n'existe.
 */

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatDateTimeFR } from '@/lib/utils';
import { messageErreurImport } from '@/lib/importClients/lots';
import { texteRetrait, texteRetraitFait, messageEchecRetrait, resumeFichesImport } from '@/lib/importClients/libelles';
import { useClientImports, useRemovalPreview, useRemoveClientImport } from '@hooks/useClientImports';

const RETIRABLE = ['termine', 'en_cours'];

function libelleEtat(imp) {
  if (imp.status === 'retire') return `Retiré le ${formatDateTimeFR(imp.removed_at)}`;
  return imp.status === 'en_cours' ? 'En cours' : 'Terminé';
}

function libelleLigne(imp) {
  // Import retiré : il n'a plus aucune fiche, seule la date du retrait compte.
  if (imp.status === 'retire') return libelleEtat(imp);
  return `${resumeFichesImport(imp.counts)} · ${libelleEtat(imp)}`;
}

/** Fenêtre de confirmation : l'aperçu n'est demandé que pour l'import dont la fenêtre est ouverte. */
function RetraitDialog({ orgId, imp, onClose }) {
  const apercu = useRemovalPreview(orgId, imp.id);
  const retrait = useRemoveClientImport(orgId);
  const enCours = useRef(false); // garde synchrone : isPending n'est à jour qu'au rendu suivant

  let description;
  if (apercu.isLoading || apercu.isFetching) description = 'Calcul des fiches concernées…';
  else if (apercu.error || !apercu.data) description = messageErreurImport(apercu.error);
  else description = texteRetrait(apercu.data);

  const confirmer = async () => {
    if (enCours.current || retrait.isPending) return;
    enCours.current = true;
    try {
      const totaux = await retrait.mutateAsync(imp.id);
      toast.success(texteRetraitFait(totaux));
    } catch (e) {
      toast.error(messageEchecRetrait(messageErreurImport(e)));
    }
    onClose();
  };

  return (
    <ConfirmDialog
      open
      onOpenChange={(ouvert) => { if (!ouvert && !retrait.isPending) onClose(); }}
      title="Retirer cet import"
      description={description}
      confirmLabel={retrait.isPending ? 'Retrait en cours…' : 'Retirer cet import'}
      variant="destructive"
      onConfirm={confirmer}
      loading={retrait.isPending}
      /* Fermé seulement quand des fiches restent et qu'aucune ne peut partir ; un import sans fiche se retire de la liste. */
      confirmDisabled={apercu.isFetching || !apercu.data || (apercu.data.retirables <= 0 && apercu.data.conservees > 0)}
    />
  );
}

export default function ImportsPrecedents({ orgId }) {
  const { data: imports, isLoading, error } = useClientImports(orgId);
  const [aRetirer, setARetirer] = useState(null);

  if (isLoading) return null;
  if (error) {
    return <p className="text-sm text-gray-600">Les imports précédents n&apos;ont pas pu être lus.</p>;
  }
  if (!imports || imports.length === 0) return null;

  return (
    <section aria-labelledby="imports-precedents" className="bg-white rounded-lg border border-gray-200 p-6 space-y-3">
      <h2 id="imports-precedents" className="text-lg font-semibold text-gray-900">Imports précédents</h2>
      <ul className="divide-y divide-gray-100">
        {imports.map((imp) => (
          <li key={imp.id} className="py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 text-sm">
              <p className="font-medium text-gray-900 truncate">{imp.file_name}</p>
              <p className="text-gray-600">
                {formatDateTimeFR(imp.created_at)}
                {imp.created_by_name ? ` · ${imp.created_by_name}` : ''}
                {` · ${libelleLigne(imp)}`}
              </p>
            </div>
            {RETIRABLE.includes(imp.status) && (
              <button
                type="button"
                onClick={() => setARetirer(imp)}
                className="px-3 py-1.5 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
              >
                Retirer cet import
              </button>
            )}
          </li>
        ))}
      </ul>
      {aRetirer && <RetraitDialog orgId={orgId} imp={aRetirer} onClose={() => setARetirer(null)} />}
    </section>
  );
}
