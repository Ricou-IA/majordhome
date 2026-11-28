/**
 * EtapeResultat.jsx - Import d'articles, étapes 4 et 5
 * Avancement de l'écriture, puis compte rendu ; une coupure laisse reprendre au lot refusé.
 */

import {
  AlertCircle, CheckCircle2, Download, Loader2, RefreshCw, Boxes, ArrowLeft, FilePlus2, Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Encadre } from './Encadres';

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

function Barre({ faits, total }) {
  const pct = total > 0 ? Math.round((faits / total) * 100) : 0;
  return (
    <div className="space-y-2">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={faits}
        aria-label="Articles écrits"
        className="h-2 w-full bg-secondary-200 rounded-full overflow-hidden"
      >
        <div className="h-full bg-primary-600 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-secondary-700">{faits} articles écrits sur {total}</p>
    </div>
  );
}

function BoutonEcartees({ onClick }) {
  return (
    <Button type="button" variant="secondary" onClick={onClick}>
      <Download aria-hidden="true" />
      Télécharger les lignes écartées
    </Button>
  );
}

function Valeur({ libelle, valeur }) {
  return (
    <div>
      <dt className="text-secondary-600">{libelle}</dt>
      <dd className="text-xl font-semibold text-secondary-900">{valeur ?? '—'}</dd>
    </div>
  );
}

export default function EtapeResultat({
  etat, progression, bilan, erreur, fournisseurs, aDesEcartees,
  onReprendre, onArreter, onVoirArticles, onNouvelImport, onTelechargerEcartees, onRetourApercu,
}) {
  if (etat === 'termine' && bilan) {
    const ecart = bilan.importees !== bilan.prevues;
    const crees = (fournisseurs || []).filter((f) => f.cree).map((f) => f.nom);
    return (
      <Card className="p-6 space-y-4">
        <h2 className="flex items-center gap-2 font-display text-section text-secondary-900">
          <CheckCircle2 className="w-5 h-5 text-st-ok" aria-hidden="true" />
          Import terminé
        </h2>
        <dl className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
          <Valeur libelle="Lignes lues" valeur={bilan.lues} />
          <Valeur libelle="Articles créés" valeur={bilan.importees} />
          <Valeur libelle="Lignes fournisseur" valeur={bilan.lignes_fournisseur} />
          <Valeur libelle="Doublons écartés" valeur={bilan.doublons} />
          <Valeur libelle="Écartées" valeur={bilan.ecartees} />
        </dl>
        {ecart && (
          <Encadre ton="attention" role="alert">
            {pluriel(bilan.prevues, 'article était prévu', 'articles étaient prévus')}, {bilan.importees} {bilan.importees > 1 ? 'ont été écrits' : 'a été écrit'}.
          </Encadre>
        )}
        {crees.length > 0 && (
          <p className="text-sm text-secondary-700">
            {crees.length > 1 ? 'Fournisseurs créés' : 'Fournisseur créé'} : {crees.join(', ')}.
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="secondary" onClick={onNouvelImport}>
            <FilePlus2 aria-hidden="true" />
            Nouvel import
          </Button>
          {aDesEcartees && <BoutonEcartees onClick={onTelechargerEcartees} />}
          <Button type="button" onClick={onVoirArticles}>
            <Boxes aria-hidden="true" />
            Voir les articles
          </Button>
        </div>
      </Card>
    );
  }

  if (etat === 'interrompu') {
    return (
      <Card className="p-6 space-y-4">
        <h2 className="flex items-center gap-2 font-display text-section text-secondary-900">
          <AlertCircle className="w-5 h-5 text-st-alerte" aria-hidden="true" />
          Import interrompu
        </h2>
        <p role="alert" className="text-sm text-st-alerte">{erreur}</p>
        <p className="text-sm text-secondary-700">
          {progression.faits === 0
            ? "Aucun article n'a encore été écrit."
            : `${pluriel(progression.faits, 'article est déjà écrit', 'articles sont déjà écrits')} sur ${progression.total}. Reprendre ne les recrée pas.`}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="secondary" onClick={onArreter}>
            <Square aria-hidden="true" />
            Arrêter l&apos;import
          </Button>
          <Button type="button" onClick={onReprendre}>
            <RefreshCw aria-hidden="true" />
            Reprendre
          </Button>
        </div>
      </Card>
    );
  }

  // L'ouverture de l'import a été refusée, ou les lignes n'ont pas pu être préparées : rien n'a été écrit.
  if (etat === 'repos' && erreur) {
    return (
      <Card className="p-6 space-y-4">
        <h2 className="flex items-center gap-2 font-display text-section text-secondary-900">
          <AlertCircle className="w-5 h-5 text-st-alerte" aria-hidden="true" />
          L&apos;import n&apos;a pas démarré
        </h2>
        <p role="alert" className="text-sm text-st-alerte">{erreur}</p>
        <p className="text-sm text-secondary-700">Aucun article n&apos;a été écrit.</p>
        <Button type="button" variant="secondary" onClick={onRetourApercu}>
          <ArrowLeft aria-hidden="true" />
          Revenir à l&apos;aperçu
        </Button>
      </Card>
    );
  }

  return (
    <Card className="p-6 space-y-4">
      <h2 className="flex items-center gap-2 font-display text-section text-secondary-900">
        <Loader2 className="w-5 h-5 text-primary-600 animate-spin" aria-hidden="true" />
        Import en cours
      </h2>
      <Barre faits={progression.faits} total={progression.total} />
      <p className="text-sm text-secondary-600">Gardez cette page ouverte jusqu&apos;à la fin.</p>
    </Card>
  );
}
