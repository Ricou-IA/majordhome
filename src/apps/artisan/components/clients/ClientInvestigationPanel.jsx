/**
 * ClientInvestigationPanel.jsx — Recherche dans les DPE publics (repli du bloc Logement)
 * ============================================================================
 * Ouvert depuis le bloc Logement de la fiche (« Chercher dans les DPE publics ») quand le corpus MonsieurDPE ne
 * trouve rien à l'adresse : interroge la BAN puis l'API publique de l'ADEME, à l'adresse puis dans le voisinage.
 * Un DPE trouvé ici ne se rattache JAMAIS tout seul : « C'est ce logement » le rattache à la main (origine
 * `choisi`, mention « voisinage » s'il vient d'un rayon), et la carte de la fiche est alors relue dans le corpus.
 *
 * Une adresse peut porter PLUSIEURS logements (immeuble) : on les liste tous, on n'en élit aucun.
 * Spec : docs/superpowers/specs/2026-11-12-logement-monsieurdpe-fiche-client-design.md §9.
 * ============================================================================
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  X, Loader2, Home, AlertCircle, RefreshCw, MapPin, Radius, ChevronLeft, ChevronRight, Check,
} from 'lucide-react';
import { useClientInvestigation } from '@hooks/useClientInvestigation';
import { useAuth } from '@contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { useDpeLien } from '@hooks/useDpeLien';
import { messageErreurDpeLien } from '@lib/dpeLien';
import { DpeNeighbourhoodMap } from './DpeNeighbourhoodMap';
import { DpeLogementCard } from './DpeLogementCard';
import { assessMatch, NEARBY_RADII_M } from '@/lib/dpeApi';

function RecordCard({ record, matchMode, clientAddress, onChoose, choosing, chosenNumber }) {
  const match = assessMatch(record, { matchMode, clientAddress });
  const entete = (
    <>
      {/* Adresse telle qu'écrite par le diagnostiqueur : c'est CE texte qu'il faut comparer à la fiche. */}
      {record.rawAddress && (
        <p className="text-xs text-secondary-500 -mt-1">
          Adresse au diagnostic : <span className="text-secondary-700">{record.rawAddress}</span>
        </p>
      )}
      {match.level === 'a_verifier' && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          Rattachement à vérifier — {match.reason}
          {Number.isFinite(record.banScore) && ` (indice ${record.banScore})`}.
          Comparez l’adresse ci-dessus à celle de la fiche avant de choisir ce logement.
        </p>
      )}
    </>
  );
  const dejaChoisi = Boolean(record.dpeNumber) && record.dpeNumber === chosenNumber;
  const actions = onChoose && record.dpeNumber ? (
    <button
      type="button"
      onClick={() => onChoose(record, matchMode === 'proximity')}
      disabled={choosing || dejaChoisi}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 transition-colors"
    >
      {choosing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
      {dejaChoisi ? 'Rattaché à la fiche' : 'C’est ce logement'}
    </button>
  ) : null;
  return <DpeLogementCard record={record} entete={entete} actions={actions} />;
}

function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="text-center py-10 px-4">
      <Icon className="w-8 h-8 mx-auto text-secondary-300" />
      <p className="mt-3 text-sm font-medium text-secondary-700">{title}</p>
      {/* <div> et non <p> : certains états y placent un bouton, et un <button>
          dans un <p> fait fermer le paragraphe par le navigateur. */}
      <div className="mt-1 text-sm text-secondary-500 max-w-sm mx-auto">{children}</div>
    </div>
  );
}

function Body({
  result, isLoading, hasAddress, onRetry,
  onSearchNearby, nearbySearched, selectedId, onSelect, onStep,
  nearbyRadius, onRadiusChange, clientAddress, onChoose, choosing, chosenNumber,
}) {
  if (!hasAddress) {
    return (
      <EmptyState icon={MapPin} title="Pas d'adresse sur cette fiche">
        L&apos;investigation part de l&apos;adresse postale. Renseignez-la dans l&apos;onglet
        Informations pour pouvoir interroger la donnée bâtiment.
      </EmptyState>
    );
  }

  if (isLoading && !result) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-secondary-500">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="mt-3 text-sm">Interrogation de la BAN puis du fichier DPE…</p>
      </div>
    );
  }

  if (!result) return null;

  if (result.status === 'error') {
    return (
      <EmptyState icon={AlertCircle} title="Service indisponible">
        Impossible d&apos;interroger la donnée publique ({result.error}). Rien n&apos;est
        cassé côté fiche client — réessayez dans un instant.
      </EmptyState>
    );
  }

  if (result.status === 'address_not_found') {
    return (
      <EmptyState icon={MapPin} title="Adresse non reconnue">
        La Base Adresse Nationale ne trouve pas cette adresse. Une orthographe
        approximative ou un lieu-dit suffit à la faire échouer.
      </EmptyState>
    );
  }

  if (result.status === 'no_dpe') {
    return (
      <EmptyState icon={Home} title="Aucun DPE à cette adresse">
        Ce n&apos;est pas une erreur : un logement n&apos;apparaît au fichier DPE que s&apos;il
        en a fait établir un — vente, location ou audit. Environ un logement sur
        deux n&apos;y figure pas.
        {onSearchNearby && !nearbySearched && (
          <>
            {/* Surtout PAS `onClick={onSearchNearby}` : React passerait
                l'événement en 1ᵉʳ argument, qui atterrissait dans le rayon —
                `geo_distance=lon,lat,[object Object]` → HTTP 400. */}
            <button
              onClick={() => onSearchNearby()}
              className="mt-4 inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-secondary-700 bg-secondary-100 hover:bg-secondary-200 rounded-lg transition-colors"
            >
              <Radius className="w-4 h-4" />
              Chercher dans le voisinage
            </button>
            <span className="block mt-2 text-xs text-secondary-400">
              Les DPE trouvés seront ceux des logements alentour : n’en rattachez un que si
              vous savez que c’est bien le logement du client (adresse mal saisie, lieu-dit).
            </span>
          </>
        )}
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      {result.matchMode === 'proximity' && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <span className="font-semibold">Ce ne sont PAS les DPE de ce client.</span> Aucun
          diagnostic n’existe à son adresse ; voici ceux des logements alentour. N’en rattachez un
          que si vous savez que c’est bien son logement.
        </p>
      )}
      {/* Voisinage : la carte porte la sélection. Plusieurs DPE peuvent exister
          dans le rayon — on ne devine pas lequel concerne le client, il le
          désigne sur la carte. En correspondance exacte, tous les logements
          sont à la même adresse : une carte n'apprendrait rien, on les liste. */}
      {result.matchMode === 'proximity' ? (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs text-secondary-500">Rayon de recherche</span>
            <div className="flex gap-1">
              {NEARBY_RADII_M.map((r) => (
                <button
                  key={r}
                  onClick={() => onRadiusChange(r)}
                  className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                    r === nearbyRadius
                      ? 'bg-secondary-800 text-white'
                      : 'bg-secondary-100 text-secondary-600 hover:bg-secondary-200'
                  }`}
                >
                  {r} m
                </button>
              ))}
            </div>
          </div>

          <DpeNeighbourhoodMap
            records={result.records}
            clientPoint={result.ban}
            selectedId={selectedId}
            onSelect={onSelect}
          />

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-secondary-500">
              {result.total} diagnostic{result.total > 1 ? 's' : ''} dans {nearbyRadius} m
              {/* Troncature JAMAIS muette : sans ça, 12 sur 75 se lit « le secteur est vide ». */}
              {result.total > result.records.length && (
                <span className="text-amber-800">
                  {' '}— les {result.records.length} plus proches sont affichés
                </span>
              )}
            </p>

            {/* Navigation séquentielle : parcourir les diagnostics sans avoir à
                viser un repère sur la carte, qui elle ne bouge pas. */}
            {result.records.length > 1 && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => onStep(-1)}
                  className="p-1 rounded-md text-secondary-500 hover:text-secondary-800 hover:bg-secondary-100 transition-colors"
                  title="Diagnostic précédent"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-secondary-600 tabular-nums">
                  repère{' '}
                  <span className="font-semibold text-secondary-800">
                    {result.records.findIndex((r) => r.id === selectedId) + 1}
                  </span>
                  {' / '}{result.records.length}
                </span>
                <button
                  onClick={() => onStep(1)}
                  className="p-1 rounded-md text-secondary-500 hover:text-secondary-800 hover:bg-secondary-100 transition-colors"
                  title="Diagnostic suivant"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
          {result.records
            .filter((r) => r.id === selectedId)
            .map((record) => (
              <RecordCard
                key={record.id}
                record={record}
                matchMode={result.matchMode}
                clientAddress={clientAddress}
                onChoose={onChoose}
                choosing={choosing}
                chosenNumber={chosenNumber}
              />
            ))}
        </>
      ) : (
        <>
          {result.records.length > 1 && (
            <p className="text-xs text-secondary-500">
              {result.records.length} logements à cette adresse
              {result.total > result.records.length && ` (sur ${result.total})`}.
            </p>
          )}
          {result.records.map((record, i) => (
            <RecordCard
              key={record.id || i}
              record={record}
              matchMode={result.matchMode}
              clientAddress={clientAddress}
              onChoose={onChoose}
              choosing={choosing}
              chosenNumber={chosenNumber}
            />
          ))}
        </>
      )}
      {/* Idem : `refetch` de React Query prend un objet d'options en 1ᵉʳ
          argument, on ne lui passe pas l'événement. */}
      <button
        onClick={() => onRetry()}
        className="inline-flex items-center gap-2 text-xs text-secondary-500 hover:text-secondary-700"
      >
        <RefreshCw className="w-3 h-3" />
        Rafraîchir
      </button>
    </div>
  );
}

export function ClientInvestigationPanel({ client, isOpen, onClose }) {
  const {
    result, isLoading, hasAddress, refetch, tally,
    includeNearby, searchNearby, nearbyRadius, setNearbyRadius,
  } = useClientInvestigation(client, { enabled: isOpen });
  const { organization } = useAuth();
  const { can } = useCanAccess();
  const { ligne, choisir, enCours } = useDpeLien({ orgId: organization?.id, clientId: client?.id, actif: isOpen });
  const [pickedId, setPickedId] = useState(null);

  // À défaut de choix explicite sur la carte, le plus proche fait foi.
  const records = result?.records ?? [];
  const selectedId = records.some((r) => r.id === pickedId) ? pickedId : records[0]?.id ?? null;

  // Navigation séquentielle, circulaire : arrivé au dernier, on repart au premier.
  const step = (delta) => {
    if (records.length === 0) return;
    const i = records.findIndex((r) => r.id === selectedId);
    const next = (i + delta + records.length) % records.length;
    setPickedId(records[next].id);
  };

  // Rattachement À LA MAIN d'un DPE trouvé ici : la carte de la fiche est relue dans le corpus par l'edge.
  const handleChoose = async (record, voisinage) => {
    try {
      await choisir({ numero: record.dpeNumber, voisinage });
      toast.success(`DPE ${record.dpeNumber} rattaché à la fiche`);
      onClose();
    } catch (e) {
      toast.error(messageErreurDpeLien(e));
    }
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[60]" onClick={onClose} />

      <aside className="fixed right-0 top-0 bottom-0 z-[61] w-full max-w-lg bg-secondary-50 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        <header className="px-5 py-4 bg-white border-b border-secondary-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-secondary-900">Recherche dans les DPE publics</h2>
              <p className="mt-0.5 text-sm text-secondary-500 truncate">
                {result?.ban?.label || [client?.address, client?.postal_code, client?.city].filter(Boolean).join(' ') || '—'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-secondary-400 hover:text-secondary-600 hover:bg-secondary-100 transition-colors shrink-0"
              title="Fermer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {result?.lowConfidence && (
            <p className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              Adresse géocodée avec un faible niveau de confiance — le rattachement peut être faux.
            </p>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <Body
            result={result}
            isLoading={isLoading}
            hasAddress={hasAddress}
            onRetry={refetch}
            onSearchNearby={searchNearby}
            nearbySearched={includeNearby}
            selectedId={selectedId}
            onSelect={setPickedId}
            onStep={step}
            nearbyRadius={nearbyRadius}
            onRadiusChange={setNearbyRadius}
            clientAddress={client}
            onChoose={can('clients', 'edit') ? handleChoose : null}
            choosing={enCours}
            chosenNumber={ligne?.dpe_number || null}
          />
        </div>

        <footer className="px-5 py-3 bg-white border-t border-secondary-200 text-xs text-secondary-500 flex items-center justify-between gap-3">
          <span>Sources : BAN · fichier DPE ADEME</span>
          {tally.total > 0 && (
            <span title="Adresses investiguées depuis l'ouverture de l'onglet — sert à décider si on généralise">
              Taux de réponse{' '}
              <span className="font-semibold text-secondary-700">
                {tally.withData}/{tally.total}
              </span>
            </span>
          )}
        </footer>
      </aside>
    </>
  );
}
