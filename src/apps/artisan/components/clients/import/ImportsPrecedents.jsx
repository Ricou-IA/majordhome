/**
 * ImportsPrecedents.jsx - Import des clients
 * Liste des imports déjà faits, avec le retrait complet d'un import (les fiches qui ont déjà un contrat,
 * une intervention ou un e-mail envoyé sont conservées). Rien n'est affiché tant qu'aucun import n'existe.
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatDateTimeFR } from '@/lib/utils';
import { messageErreurImport } from '@/lib/importClients/lots';
import { texteRetrait, texteRetraitFait } from '@/lib/importClients/libelles';
import { useClientImports, useRemovalPreview, useRemoveClientImport } from '@hooks/useClientImports';

const RETIRABLE = ['termine', 'en_cours'];

function libelleEtat(imp) {
  if (imp.status === 'retire') return `Retiré le ${formatDateTimeFR(imp.removed_at)}`;
  return imp.status === 'en_cours' ? 'En cours' : 'Terminé';
}

function libelleCreees(counts) {
  const n = counts?.importees;
  if (typeof n !== 'number') return 'import interrompu';
  return `${n.toLocaleString('fr-FR')} ${n > 1 ? 'fiches créées' : 'fiche créée'}`;
}

/** Fenêtre de confirmation : l'aperçu n'est demandé que pour l'import dont la fenêtre est ouverte. */
function RetraitDialog({ orgId, imp, onClose }) {
  const apercu = useRemovalPreview(orgId, imp.id);
  const retrait = useRemoveClientImport(orgId);

  let description;
  if (apercu.isLoading) description = 'Calcul des fiches concernées…';
  else if (apercu.error || !apercu.data) description = messageErreurImport(apercu.error);
  else description = texteRetrait(apercu.data);

  const confirmer = async () => {
    try {
      const totaux = await retrait.mutateAsync(imp.id);
      toast.success(texteRetraitFait(totaux));
    } catch (e) {
      toast.error(e?.message || messageErreurImport(e));
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
      confirmDisabled={!apercu.data || apercu.data.retirables <= 0}
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
                {` · ${libelleCreees(imp.counts)}`}
                {` · ${libelleEtat(imp)}`}
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
