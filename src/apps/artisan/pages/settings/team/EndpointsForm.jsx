/**
 * EndpointsForm.jsx — Départ / Retour d'un membre (fiche membre, Settings → Équipe)
 * ============================================================================
 * D'où part et où rentre la personne chaque jour (feuille de route, tournées).
 * Par défaut l'agence ; « Autre adresse » = son domicile en général. Une exception
 * pour un jour donné se pose depuis la feuille de route (« Départ : Agence »).
 * Enregistrement immédiat, comme le reste de la fiche.
 * Spec : docs/superpowers/specs/2026-10-14-depart-retour-technicien-design.md
 * ============================================================================
 */

import { useState } from 'react';
import { Home } from 'lucide-react';
import AddressSearch from '../organization/components/AddressSearch';
import { pointValide } from '@/lib/tournee/extremites.js';

const LIGNES = [
  { cote: 'depart', titre: 'Départ', champ: 'depart_point', patchPoint: 'departPoint', patchReset: 'resetDepart' },
  { cote: 'retour', titre: 'Retour', champ: 'retour_point', patchPoint: 'retourPoint', patchReset: 'resetRetour' },
];

function LigneExtremite({ ligne, point, departPoint, canEdit, onSave, disabled }) {
  const perso = pointValide(point);
  const [ouvert, setOuvert] = useState(false);
  const [libelle, setLibelle] = useState(point?.label || 'Domicile');
  const mode = perso || ouvert ? 'perso' : 'agence';

  const choisirAgence = () => {
    setOuvert(false);
    if (perso) onSave({ [ligne.patchReset]: true });
  };
  const choisirAdresse = (res) => {
    onSave({ [ligne.patchPoint]: { label: (libelle || 'Domicile').trim(), address: res.label, lat: res.lat, lng: res.lng } });
  };
  const enregistrerLibelle = () => {
    const l = (libelle || '').trim() || 'Domicile';
    if (perso && l !== point.label) onSave({ [ligne.patchPoint]: { ...point, label: l } });
  };

  if (!canEdit) {
    return (
      <p className="text-sm text-secondary-700">
        <span className="font-medium">{ligne.titre} :</span>{' '}
        {perso ? `${point.label || 'Domicile'} — ${point.address || ''}` : 'Agence'}
      </p>
    );
  }

  const bouton = (valeur, texte, onClick) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={mode === valeur}
      className={`px-3 py-1 text-sm rounded-md border disabled:opacity-50 ${mode === valeur
        ? 'bg-white border-secondary-300 text-secondary-900 font-medium shadow-sm'
        : 'border-transparent text-secondary-500 hover:text-secondary-800'}`}
    >
      {texte}
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="w-14 text-sm font-medium text-secondary-800">{ligne.titre}</span>
        <span className="inline-flex items-center gap-0.5 rounded-lg bg-secondary-100 p-0.5">
          {bouton('agence', 'Agence', choisirAgence)}
          {bouton('perso', 'Autre adresse', () => setOuvert(true))}
        </span>
        {ligne.cote === 'retour' && pointValide(departPoint) && !(perso && point.lat === departPoint.lat && point.lng === departPoint.lng) && (
          <button
            type="button"
            onClick={() => onSave({ retourPoint: departPoint })}
            disabled={disabled}
            className="inline-flex items-center gap-1 text-xs text-primary-700 hover:text-primary-900 disabled:opacity-50"
          >
            <Home className="w-3.5 h-3.5" /> Même adresse que le départ
          </button>
        )}
      </div>
      {mode === 'perso' && (
        <div className="pl-[4.25rem] grid gap-2 sm:grid-cols-[10rem_1fr]">
          <input
            type="text"
            value={libelle}
            onChange={(e) => setLibelle(e.target.value)}
            onBlur={enregistrerLibelle}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            disabled={disabled}
            placeholder="Domicile"
            aria-label={`Libellé du point de ${ligne.titre.toLowerCase()}`}
            className="px-2 py-1.5 text-sm border border-secondary-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50"
          />
          <AddressSearch
            initialValue={point?.address || ''}
            onSelect={choisirAdresse}
            placeholder="Rechercher l’adresse…"
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.teamMember   majordhome_team_members (depart_point, retour_point)
 * @param {boolean} props.canEdit     org_admin
 * @param {Function} props.onSave     (patch) => void — `{ departPoint }`, `{ resetDepart: true }`, `{ retourPoint }`, `{ resetRetour: true }`
 * @param {boolean} [props.isSaving]
 */
export function EndpointsForm({ teamMember, canEdit, onSave, isSaving = false }) {
  return (
    <div className="space-y-3">
      {LIGNES.map((ligne) => (
        <LigneExtremite
          key={`${ligne.cote}-${teamMember.id}`}
          ligne={ligne}
          point={teamMember[ligne.champ]}
          departPoint={teamMember.depart_point}
          canEdit={canEdit}
          onSave={onSave}
          disabled={isSaving}
        />
      ))}
    </div>
  );
}

export default EndpointsForm;
