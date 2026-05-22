import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { ExternalLink, Plus, X } from 'lucide-react';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { MAPBOX_CONFIG } from '@lib/mapbox';
import CenterEditor from './components/CenterEditor';
import DepartmentSelect from './components/DepartmentSelect';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const ERROR_CLASS = 'mt-1 text-xs text-red-600';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';

const PLACE_ID_FINDER_URL = 'https://developers.google.com/maps/documentation/places/web-service/place-id?hl=fr#find-id';

function slugify(label) {
  return (
    (label || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || `center_${Date.now()}`
  );
}

function defaultCenter() {
  return { label: '', lat: null, lng: null, color: '#3b82f6', emoji: '🏢' };
}

function defaultBranch() {
  return { label: '', lat: null, lng: null, color: '#ef4444', emoji: '📍' };
}

// settings.territoire_centers est un objet keyed : 1ère entry = siège.
// On normalise en { headquarters, branches: [] } pour l'UI.
function deserialize(settings) {
  const centers = settings?.territoire_centers;
  const empty = {
    headquarters: defaultCenter(),
    branches: [],
    google_place_id: settings?.google_place_id || '',
    geogrid_target_department: settings?.geogrid_target_department || '',
  };
  if (!centers || typeof centers !== 'object') return empty;
  const entries = Object.entries(centers);
  if (entries.length === 0) return empty;
  const [, hq] = entries[0];
  const branches = entries.slice(1).map(([, c]) => c);
  return {
    headquarters: { ...defaultCenter(), ...hq },
    branches: branches.map((b) => ({ ...defaultBranch(), ...b })),
    google_place_id: settings?.google_place_id || '',
    geogrid_target_department: settings?.geogrid_target_department || '',
  };
}

// Reconstruit l'objet territoire_centers keyed (slug du label) à partir du state UI
function serializeTerritoireCenters(headquarters, branches) {
  const out = {};
  const hqKey = slugify(headquarters.label) || 'headquarters';
  out[hqKey] = headquarters;
  branches.forEach((b, idx) => {
    let key = slugify(b.label) || `branch_${idx}`;
    // Évite collision avec hqKey
    while (out[key]) key = `${key}_${idx + 1}`;
    out[key] = b;
  });
  return out;
}

function validate(state) {
  const errors = {};
  if (!state.headquarters.label?.trim()) errors.hq_label = 'Nom du siège obligatoire';
  if (!Number.isFinite(state.headquarters.lat) || !Number.isFinite(state.headquarters.lng)) {
    errors.hq_coords = 'Coordonnées du siège obligatoires (recherche adresse ou saisie manuelle)';
  }
  state.branches.forEach((b, idx) => {
    if (!b.label?.trim()) errors[`branch_label_${idx}`] = "Nom de l'antenne obligatoire";
    if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) {
      errors[`branch_coords_${idx}`] = "Coordonnées de l'antenne obligatoires";
    }
  });
  return errors;
}

export default function TerritoryTab() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const [state, setState] = useState(() => deserialize({}));
  const [initial, setInitial] = useState(() => deserialize({}));
  const [editingBranchIdx, setEditingBranchIdx] = useState(null);

  useEffect(() => {
    const d = deserialize(settings);
    setState(d);
    setInitial(d);
  }, [settings]);

  const errors = useMemo(() => validate(state), [state]);
  const isDirty = useMemo(() => JSON.stringify(state) !== JSON.stringify(initial), [state, initial]);
  const isValid = Object.keys(errors).length === 0;

  const handleSave = async () => {
    if (!isValid) {
      toast.error('Corrige les erreurs avant d\'enregistrer.');
      return;
    }
    try {
      const patch = {
        territoire_centers: serializeTerritoireCenters(state.headquarters, state.branches),
        google_place_id: state.google_place_id || null,
        geogrid_target_department: state.geogrid_target_department || null,
      };
      await save(patch);
      toast.success('Territoire enregistré');
      setInitial(state);
    } catch (err) {
      toast.error(err.message || 'Erreur lors de l\'enregistrement');
    }
  };

  const handleReset = () => setState(initial);

  const handleDetectDepartment = async () => {
    const { lat, lng } = state.headquarters;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      toast.error('Configure d\'abord les coordonnées du siège');
      return;
    }
    try {
      const token = MAPBOX_CONFIG.accessToken;
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?country=fr&language=fr&types=region&access_token=${token}`;
      const res = await fetch(url);
      const data = await res.json();
      const region = data.features?.[0];
      const code = region?.properties?.short_code?.replace('FR-', '') || null;
      if (code) {
        setState({ ...state, geogrid_target_department: code });
        toast.success(`Département détecté : ${code}`);
      } else {
        toast.error('Impossible de détecter le département');
      }
    } catch {
      toast.error('Erreur lors de la détection');
    }
  };

  const addBranch = () => {
    setState({ ...state, branches: [...state.branches, defaultBranch()] });
    setEditingBranchIdx(state.branches.length);
  };

  const updateBranch = (idx, updated) => {
    const newBranches = [...state.branches];
    newBranches[idx] = updated;
    setState({ ...state, branches: newBranches });
  };

  const removeBranch = (idx) => {
    setState({ ...state, branches: state.branches.filter((_, i) => i !== idx) });
    if (editingBranchIdx === idx) setEditingBranchIdx(null);
  };

  if (isLoading) {
    return <div className="card text-sm text-secondary-500">Chargement…</div>;
  }

  return (
    <div className="card space-y-8">
      {/* Section 1 : Siège */}
      <section className="bg-secondary-50 -m-4 p-4 rounded-lg">
        <h3 className={SECTION_TITLE}>
          1. Siège social
          <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full normal-case font-medium">
            Obligatoire
          </span>
        </h3>
        <CenterEditor
          value={state.headquarters}
          onChange={(hq) => setState({ ...state, headquarters: hq })}
        />
        {errors.hq_label && <p className={ERROR_CLASS}>{errors.hq_label}</p>}
        {errors.hq_coords && <p className={ERROR_CLASS}>{errors.hq_coords}</p>}
      </section>

      {/* Section 2 : Référence Google */}
      <section>
        <h3 className={SECTION_TITLE}>
          2. Référence Google Business
          <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full normal-case font-medium">
            Recommandé
          </span>
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={state.google_place_id}
            onChange={(e) => setState({ ...state, google_place_id: e.target.value })}
            placeholder="ChIJ..."
            className={`${INPUT_CLASS} font-mono text-xs`}
          />
          <a
            href={PLACE_ID_FINDER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 px-3 py-2 bg-blue-50 text-blue-700 text-xs font-medium rounded-md hover:bg-blue-100 inline-flex items-center gap-1"
          >
            Trouver <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <p className={HINT_CLASS}>
          ℹ️ Identifiant unique de ta fiche Google Business. Sert au <strong>suivi de positionnement local</strong> (module GeoGrid).
          Clique "Trouver" et cherche <strong>ton entreprise</strong> (pas l'adresse postale).
        </p>
      </section>

      {/* Section 3 : Département principal */}
      <section>
        <h3 className={SECTION_TITLE}>
          3. Département principal
          <span className="ml-2 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded-full normal-case font-medium">
            Recommandé
          </span>
        </h3>
        <DepartmentSelect
          value={state.geogrid_target_department}
          onChange={(code) => setState({ ...state, geogrid_target_department: code })}
          onDetectFromHq={handleDetectDepartment}
        />
        <p className={HINT_CLASS}>
          ℹ️ Zone de visibilité prioritaire. Sert au <strong>suivi SEO local</strong> (scans des communes du département).
          Détecté automatiquement depuis le siège, modifiable.
        </p>
      </section>

      {/* Section 4 : Antennes */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className={`${SECTION_TITLE} mb-0`}>
            4. Antennes commerciales
            <span className="ml-2 text-secondary-400 normal-case font-normal">(Optionnel)</span>
          </h3>
          <button
            type="button"
            onClick={addBranch}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-primary-50 text-primary-700 rounded-md hover:bg-primary-100"
          >
            <Plus className="w-3 h-3" /> Ajouter une antenne
          </button>
        </div>

        {state.branches.length === 0 ? (
          <div className="text-center text-secondary-400 text-sm py-6 border border-dashed border-secondary-200 rounded-md">
            Ajoute une antenne si tu as un commercial basé ailleurs qu'au siège.
          </div>
        ) : (
          <div className="space-y-3">
            {state.branches.map((b, idx) => {
              const isEditing = editingBranchIdx === idx;
              const branchErr = errors[`branch_label_${idx}`] || errors[`branch_coords_${idx}`];
              return (
                <div key={idx} className="border border-secondary-200 rounded-md">
                  <div className="flex items-center gap-2 p-3">
                    <span className="text-xl">{b.emoji || '📍'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-secondary-900 truncate">
                        {b.label || <span className="text-secondary-400 italic">Antenne sans nom</span>}
                      </div>
                      <div className="text-xs text-secondary-500">
                        {Number.isFinite(b.lat) && Number.isFinite(b.lng)
                          ? `${b.lat.toFixed(4)}, ${b.lng.toFixed(4)}`
                          : 'Pas de coordonnées'}
                      </div>
                      {branchErr && <p className="mt-1 text-xs text-red-600">{branchErr}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingBranchIdx(isEditing ? null : idx)}
                      className="px-2 py-1 text-xs text-primary-600 hover:bg-primary-50 rounded"
                    >
                      {isEditing ? 'Fermer' : 'Éditer'}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeBranch(idx)}
                      className="p-1 text-red-500 hover:bg-red-50 rounded"
                      aria-label="Supprimer l'antenne"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {isEditing && (
                    <div className="border-t border-secondary-200 p-3">
                      <CenterEditor value={b} onChange={(u) => updateBranch(idx, u)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-4 border-t border-secondary-200">
        <button
          type="button"
          onClick={handleReset}
          disabled={!isDirty || isSaving}
          className="px-4 py-2 text-sm text-secondary-600 hover:bg-secondary-50 rounded-md disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || !isValid || isSaving}
          className="px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
        >
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
