/**
 * FeuilleDeRouteSection.jsx — Interventions du jour + itinéraire d'une personne
 * ============================================================================
 * Affichage seul : tout vient de `useFeuilleDeRoute` (modèle partagé avec le
 * PDF). Monté dans le panneau de remplissage (techniciens en tournée) et dans
 * `FeuilleDeRoutePanel` (techniciens planifiés à la main).
 *
 * Départ / Arrivée : un responsable peut imposer l'agence pour CE jour quand le
 * technicien part / rentre d'ailleurs (exception enregistrée, lue aussi par le
 * moteur de tournées).
 * ============================================================================
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Car, Loader2, MapPin, Navigation, Printer, Home } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useFeuilleDeRoute } from '@hooks/useFeuilleDeRoute';
import { formatDureeRoute, formatKm } from '@/lib/feuilleDeRoute';
import { resoudreExtremites } from '@/lib/tournee/extremites.js';
import { telechargerFeuilleDeRoute } from './feuilleDeRouteExport';

const LIBELLE_COTE = { depart: 'Départ', retour: 'Arrivée' };

/**
 * Ligne « Départ · … » / « Arrivée · … ». Avec un point personnel et le droit de
 * choisir : deux boutons Agence / Domicile ; sinon le libellé seul.
 */
function ExtremiteChoix({ cote, point, membre, exception, peutChoisir, onChange, disabled }) {
  // Libellé du point personnel seul (sans siège) — null s'il n'y en a pas.
  const perso = resoudreExtremites({ siege: null, membre })[cote];
  const libelle = point?.label || 'Agence';
  if (!peutChoisir || !perso) {
    return (
      <li className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
        <Home className="h-3.5 w-3.5" /> {LIBELLE_COTE[cote]} · {libelle}
      </li>
    );
  }
  const actif = point?.source === 'agence' ? 'agence' : 'perso';
  const choisir = (choix) => {
    if (choix === actif) return;
    // 'perso' = le réglage du technicien : on retire l'exception plutôt que de la stocker.
    onChange({
      depart: exception?.depart === 'agence' ? 'agence' : null,
      retour: exception?.retour === 'agence' ? 'agence' : null,
      [cote]: choix === 'agence' ? 'agence' : null,
    });
  };
  const bouton = (choix, texte) => (
    <button
      type="button"
      onClick={() => choisir(choix)}
      disabled={disabled}
      aria-pressed={actif === choix}
      className={`px-2 py-0.5 rounded-md border text-xs disabled:opacity-50 ${actif === choix
        ? 'bg-white border-gray-300 text-gray-900 font-medium shadow-sm'
        : 'border-transparent text-gray-500 hover:text-gray-800'}`}
    >
      {texte}
    </button>
  );
  return (
    <li className="flex items-center gap-1.5 text-xs font-medium text-gray-600 flex-wrap">
      <Home className="h-3.5 w-3.5" /> {LIBELLE_COTE[cote]}
      <span className="inline-flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5">
        {bouton('perso', perso.label)}
        {bouton('agence', 'Agence')}
      </span>
      {disabled && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
    </li>
  );
}

function Troncon({ troncon, label, estime }) {
  if (!troncon) return null;
  return (
    <div className="flex items-center gap-1.5 pl-3 py-1 text-xs text-gray-500">
      <Car className="h-3.5 w-3.5" />
      {label} {formatDureeRoute(troncon.minutes)} · {formatKm(troncon.km)}
      {estime && <span className="text-amber-700">(estimé)</span>}
    </div>
  );
}

/**
 * @param {{ date: string, memberIds: string[], person: { displayName: string, color?: string } }} props
 */
export function FeuilleDeRouteSection({ date, memberIds, person }) {
  const { organization } = useAuth();
  const { settings } = useOrgSettings();
  const {
    feuille, lienMaps, carteUrl, sansDepot, isLoading, error,
    depart, retour, membre, exception, setException, isSavingException, peutChoisir,
  } = useFeuilleDeRoute({
    orgId: organization?.id, date, memberIds, person,
  });

  const changerExtremites = async (next) => {
    try {
      await setException(next);
    } catch (err) {
      toast.error(`Point de départ / retour non enregistré : ${err?.message || 'erreur inconnue'}`);
    }
  };
  const choixProps = {
    membre, exception, peutChoisir, onChange: changerExtremites, disabled: isSavingException,
  };
  const [isPrinting, setIsPrinting] = useState(false);
  const [carteKo, setCarteKo] = useState(false);

  const imprimer = async () => {
    if (!feuille) return;
    setIsPrinting(true);
    try {
      await telechargerFeuilleDeRoute({ feuille, carteUrl, settings });
    } catch (err) {
      toast.error(`Impression impossible : ${err?.message || 'erreur inconnue'}`);
    } finally {
      setIsPrinting(false);
    }
  };

  if (error) {
    return (
      <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
        Feuille de route indisponible : {error.message || 'échec inconnu'}
      </div>
    );
  }
  if (isLoading || !feuille) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-3">
        <Loader2 className="h-4 w-4 animate-spin" /> Calcul de l&apos;itinéraire…
      </div>
    );
  }

  const n = feuille.items.length;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-medium text-gray-600">
          Feuille de route · {n === 0 ? 'aucune intervention' : `${n} intervention${n > 1 ? 's' : ''}`}
          {feuille.totaux && (
            <span className="text-gray-400 font-normal">
              {' '}· route {formatDureeRoute(feuille.totaux.minutes)} · {formatKm(feuille.totaux.km)}
            </span>
          )}
        </p>
        {n > 0 && (
          <div className="flex items-center gap-2">
            {lienMaps && (
              <a
                href={lienMaps}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:text-primary-900"
              >
                <Navigation className="h-3.5 w-3.5" /> Google Maps
              </a>
            )}
            <button
              type="button"
              onClick={imprimer}
              disabled={isPrinting}
              className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50"
            >
              {isPrinting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
              Imprimer
            </button>
          </div>
        )}
      </div>

      {sansDepot && n > 0 && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
          Configurez le siège dans <strong>Réglages → Organisation → Territoire</strong> pour calculer l&apos;itinéraire.
        </p>
      )}
      {feuille.estime && (
        <p className="flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          Temps de trajet estimés à vol d&apos;oiseau (calcul routier indisponible).
        </p>
      )}
      {feuille.nbNonLocalises > 0 && (
        <p className="text-xs text-amber-800">
          {feuille.nbNonLocalises === 1 ? '1 adresse non localisée' : `${feuille.nbNonLocalises} adresses non localisées`} :
          hors itinéraire et hors totaux.
        </p>
      )}

      {carteUrl && !carteKo && (
        <img
          src={carteUrl}
          alt={`Itinéraire de ${feuille.personName}`}
          onError={() => setCarteKo(true)}
          className="w-full rounded-lg border border-gray-200"
        />
      )}

      {n > 0 && (
        <ol className="text-sm">
          <ExtremiteChoix cote="depart" point={depart} {...choixProps} />
          {feuille.items.map((it) => (
            <li key={it.id}>
              {it.localise
                ? <Troncon troncon={it.trajetAvant} label="" estime={feuille.estime} />
                : (
                  <div className="flex items-center gap-1.5 pl-3 py-1 text-xs text-amber-700">
                    <MapPin className="h-3.5 w-3.5" /> Adresse non localisée — hors itinéraire
                  </div>
                )}
              <div className="flex gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
                <span
                  className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${it.localise ? 'bg-blue-600' : 'bg-gray-400'}`}
                >
                  {it.rang}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900">
                    <span className="tabular-nums">{it.time}</span> · {it.typeLabel}
                    {it.clientName && <span> · {it.clientName}</span>}
                  </p>
                  {it.address && <p className="text-xs text-gray-600">{it.address}</p>}
                  <p className="text-xs text-gray-500">
                    {[it.phone, it.sector && `Secteur ${it.sector}`].filter(Boolean).join(' · ')}
                  </p>
                  {it.equipments.length > 0 && (
                    <p className="text-xs text-gray-500">Équipements : {it.equipments.join(' · ')}</p>
                  )}
                </div>
              </div>
            </li>
          ))}
          {feuille.retour && (
            <li><Troncon troncon={feuille.retour} label="Retour" estime={feuille.estime} /></li>
          )}
          <ExtremiteChoix cote="retour" point={retour} {...choixProps} />
        </ol>
      )}
    </div>
  );
}
