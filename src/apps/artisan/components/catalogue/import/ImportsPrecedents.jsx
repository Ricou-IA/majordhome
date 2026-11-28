/**
 * ImportsPrecedents.jsx - Import d'articles
 * Liste des imports déjà faits (date, auteur, compteurs, statut) et retrait d'un import : les articles déjà utilisés
 * ailleurs (devis, ligne fournisseur reprise par un relevé…) sont conservés. Rien n'est affiché tant qu'aucun import
 * n'existe. La page masque cette liste pendant un envoi.
 */

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LignesSquelette } from '@/components/ui/squelette';
import { formatDateTimeFR } from '@/lib/utils';
import { messageErreurImportArticles } from '@/lib/importArticles/lots';
import { texteRetraitArticles } from '@/lib/importArticles/libelles';
import { useCatalogImports, useCatalogRemovalPreview, useRetirerImportArticles } from '@hooks/useCatalogImports';

const RETIRABLE = ['termine', 'en_cours'];
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
const nombre = (v) => (Number.isFinite(v) ? v : null);

function libelleEtat(imp) {
  if (imp.status === 'retire') return `Retiré le ${formatDateTimeFR(imp.removed_at)}`;
  if (imp.status === 'en_cours') return 'En cours';
  return imp.counts?.arrete ? 'Arrêté' : 'Terminé';
}

/**
 * Compteurs d'un import : articles créés, lignes fournisseur, puis ce qu'un retrait a laissé. Un import encore
 * « en cours » (jamais clos) ne porte que le bilan PRÉVU à l'ouverture : il est dit tel quel.
 */
function resume(imp) {
  const c = imp.counts || {};
  const parties = [];
  const enCours = imp.status === 'en_cours';
  if (nombre(c.importees) !== null) parties.push(enCours ? pluriel(c.importees, 'article prévu', 'articles prévus') : pluriel(c.importees, 'article', 'articles'));
  if (nombre(c.lignes_fournisseur) !== null && c.lignes_fournisseur > 0) {
    parties.push(enCours ? pluriel(c.lignes_fournisseur, 'ligne fournisseur prévue', 'lignes fournisseur prévues') : pluriel(c.lignes_fournisseur, 'ligne fournisseur', 'lignes fournisseur'));
  }
  if (nombre(c.retirees) !== null && c.retirees > 0) parties.push(pluriel(c.retirees, 'retiré', 'retirés'));
  if (nombre(c.conservees) !== null && c.conservees > 0) parties.push(pluriel(c.conservees, 'conservé', 'conservés'));
  return parties.join(' · ');
}

function texteRetraitFait({ retirees, conservees }) {
  const retrait = retirees > 0 ? `${pluriel(retirees, 'article retiré', 'articles retirés')}.` : 'Import retiré de la liste.';
  return conservees > 0 ? `${retrait} ${pluriel(conservees, 'article conservé', 'articles conservés')} : déjà utilisés ailleurs.` : retrait;
}

/** Fenêtre de confirmation : l'aperçu n'est demandé que pour l'import dont la fenêtre est ouverte. */
function RetraitDialog({ orgId, imp, onClose }) {
  const apercu = useCatalogRemovalPreview(orgId, imp.id);
  const retrait = useRetirerImportArticles(orgId);
  const enCours = useRef(false); // garde synchrone : isPending n'est à jour qu'au rendu suivant

  let description;
  if (apercu.isLoading || apercu.isFetching) description = 'Calcul des articles concernés en cours.';
  else if (apercu.error || !apercu.data) description = messageErreurImportArticles(apercu.error);
  else description = texteRetraitArticles(apercu.data);

  const confirmer = async () => {
    if (enCours.current || retrait.isPending) return;
    enCours.current = true;
    try {
      // Seul le total FINAL des articles conservés est dit : un compte intermédiaire peut être surestimé.
      const totaux = await retrait.mutateAsync(imp.id);
      toast.success(texteRetraitFait(totaux));
    } catch (e) {
      toast.error(`Retrait interrompu : ${messageErreurImportArticles(e)}`);
    }
    onClose();
  };

  return (
    <ConfirmDialog
      open
      onOpenChange={(ouvert) => { if (!ouvert && !retrait.isPending) onClose(); }}
      title="Retirer cet import"
      description={description}
      confirmLabel={retrait.isPending ? 'Retrait en cours' : 'Retirer cet import'}
      variant="destructive"
      onConfirm={confirmer}
      loading={retrait.isPending}
      texteASaisir={imp.file_name}
      /* Fermé seulement quand des articles restent et qu'aucun ne peut partir ; un import vide se retire de la liste. */
      confirmDisabled={apercu.isFetching || !apercu.data || (apercu.data.retirables <= 0 && apercu.data.conservees > 0)}
    />
  );
}

export default function ImportsPrecedents({ orgId }) {
  const { imports, isLoading, error } = useCatalogImports(orgId);
  const [aRetirer, setARetirer] = useState(null);

  if (isLoading) {
    return (
      <Card className="p-6">
        <LignesSquelette nombre={2} libelle="Chargement des imports précédents" />
      </Card>
    );
  }
  if (error) {
    return <p className="text-sm text-secondary-600">Les imports précédents n&apos;ont pas pu être lus.</p>;
  }
  if (!imports || imports.length === 0) return null;

  return (
    <Card as="section" aria-labelledby="imports-articles-precedents">
      <CardHeader title={<span id="imports-articles-precedents">Imports précédents</span>} />
      <ul className="divide-y divide-secondary-100 px-5 pb-4">
        {imports.map((imp) => (
          <li key={imp.id} className="py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 text-sm">
              <p className="font-medium text-secondary-900 truncate">{imp.file_name}</p>
              <p className="text-secondary-600">
                {formatDateTimeFR(imp.created_at)}
                {imp.created_by_name ? ` · ${imp.created_by_name}` : ''}
                {imp.status !== 'retire' && resume(imp) ? ` · ${resume(imp)}` : ''}
                {` · ${libelleEtat(imp)}`}
              </p>
            </div>
            {RETIRABLE.includes(imp.status) && (
              <Button type="button" variant="danger" size="sm" onClick={() => setARetirer(imp)}>
                Retirer cet import
              </Button>
            )}
          </li>
        ))}
      </ul>
      {aRetirer && <RetraitDialog orgId={orgId} imp={aRetirer} onClose={() => setARetirer(null)} />}
    </Card>
  );
}
