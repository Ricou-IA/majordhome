/**
 * EtapeResultat.jsx - Import des clients, étape 4
 * Avancement de l'écriture, puis bilan ; une coupure laisse reprendre là où l'envoi s'est arrêté.
 */

import { AlertCircle, CheckCircle2, Download, Loader2, RefreshCw, Users, ArrowLeft, FilePlus2, Square } from 'lucide-react';

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
const BOUTON_PRINCIPAL = 'inline-flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors shadow-sm';
const BOUTON_SECONDAIRE = 'inline-flex items-center gap-2 px-4 py-2.5 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors';

function Barre({ faits, total }) {
  const pct = total > 0 ? Math.round((faits / total) * 100) : 0;
  return (
    <div className="space-y-2">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={faits}
        aria-label="Fiches créées"
        className="h-2 w-full bg-gray-200 rounded-full overflow-hidden"
      >
        <div className="h-full bg-primary-700 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-gray-700">{faits} fiches créées sur {total}</p>
    </div>
  );
}

function BoutonEcartees({ onClick }) {
  return (
    <button type="button" onClick={onClick} className={BOUTON_SECONDAIRE}>
      <Download className="w-4 h-4" aria-hidden="true" />
      Télécharger les lignes écartées
    </button>
  );
}

export default function EtapeResultat({
  etat, progression, bilan, erreur, aDesEcartees,
  onReprendre, onArreter, onVoirClients, onNouvelImport, onTelechargerEcartees, onRetourApercu,
}) {
  if (etat === 'termine' && bilan) {
    const ecart = bilan.importees !== bilan.prevues;
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          <CheckCircle2 className="w-5 h-5 text-green-600" aria-hidden="true" />
          Import terminé
        </h2>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><dt className="text-gray-600">Lignes lues</dt><dd className="text-xl font-semibold text-gray-900">{bilan.lues}</dd></div>
          <div><dt className="text-gray-600">Fiches créées</dt><dd className="text-xl font-semibold text-gray-900">{bilan.importees}</dd></div>
          <div><dt className="text-gray-600">Doublons écartés</dt><dd className="text-xl font-semibold text-gray-900">{bilan.doublons_ecartes}</dd></div>
          <div><dt className="text-gray-600">Écartées</dt><dd className="text-xl font-semibold text-gray-900">{bilan.ecartees}</dd></div>
        </dl>
        {ecart && (
          <p role="alert" className="flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            {pluriel(bilan.prevues, 'fiche était prévue', 'fiches étaient prévues')}, {bilan.importees} {bilan.importees > 1 ? 'ont été créées' : 'a été créée'}.
          </p>
        )}
        <p className="text-sm text-gray-600">Les adresses seront placées sur la carte dans les heures qui viennent.</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={onVoirClients} className={BOUTON_PRINCIPAL}>
            <Users className="w-4 h-4" aria-hidden="true" />
            Voir les clients
          </button>
          <button type="button" onClick={onNouvelImport} className={BOUTON_SECONDAIRE}>
            <FilePlus2 className="w-4 h-4" aria-hidden="true" />
            Nouvel import
          </button>
          {aDesEcartees && <BoutonEcartees onClick={onTelechargerEcartees} />}
        </div>
      </div>
    );
  }

  if (etat === 'interrompu') {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          <AlertCircle className="w-5 h-5 text-red-600" aria-hidden="true" />
          Import interrompu
        </h2>
        <p role="alert" className="text-sm text-red-700">{erreur}</p>
        <p className="text-sm text-gray-700">
          {progression.faits === 0
            ? "Aucune fiche n'a encore été créée."
            : `${pluriel(progression.faits, 'fiche est déjà créée', 'fiches sont déjà créées')} sur ${progression.total}. Reprendre ne les recrée pas.`}
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={onReprendre} className={BOUTON_PRINCIPAL}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Reprendre
          </button>
          <button type="button" onClick={onArreter} className={BOUTON_SECONDAIRE}>
            <Square className="w-4 h-4" aria-hidden="true" />
            Arrêter l&apos;import
          </button>
        </div>
      </div>
    );
  }

  // L'ouverture de l'import a été refusée : rien n'a été écrit.
  if (etat === 'repos' && erreur) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          <AlertCircle className="w-5 h-5 text-red-600" aria-hidden="true" />
          L&apos;import n&apos;a pas démarré
        </h2>
        <p role="alert" className="text-sm text-red-700">{erreur}</p>
        <p className="text-sm text-gray-700">Aucune fiche n&apos;a été créée.</p>
        <button type="button" onClick={onRetourApercu} className={BOUTON_SECONDAIRE}>
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Revenir à l&apos;aperçu
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
        <Loader2 className="w-5 h-5 text-primary-700 animate-spin" aria-hidden="true" />
        Import en cours
      </h2>
      <Barre faits={progression.faits} total={progression.total} />
      <p className="text-sm text-gray-600">Gardez cette page ouverte jusqu&apos;à la fin.</p>
    </div>
  );
}
