// Settings → Organisation → Territoire : siège sur la carte (départ des trajets), antennes
// commerciales, visibilité locale (fiche Google Business, département principal pour GeoGrid).
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { MAPBOX_CONFIG } from '@lib/mapbox';
import CenterEditor from './components/CenterEditor';
import DepartmentSelect from './components/DepartmentSelect';
import { useSettingsForm } from './components/useSettingsForm';
import { Field, INPUT_CLASS, SaveBar, SettingsLoading, SettingsSection, SettingsSurface } from './components/layout';

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
    errors.hq_coords = 'Position du siège obligatoire : recherchez l’adresse ou saisissez les coordonnées';
  }
  state.branches.forEach((b, idx) => {
    if (!b.label?.trim()) errors[`branch_label_${idx}`] = 'Nom de l’antenne obligatoire';
    if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) {
      errors[`branch_coords_${idx}`] = 'Position de l’antenne obligatoire';
    }
  });
  return errors;
}

export default function TerritoryTab() {
  const { form: state, setForm: setState, initial, setInitial, isDirty, save, isSaving, isLoading } = useSettingsForm(deserialize);
  const [editingBranchIdx, setEditingBranchIdx] = useState(null);

  const errors = useMemo(() => validate(state), [state]);
  const isValid = Object.keys(errors).length === 0;
  const patch = (p) => setState((s) => ({ ...s, ...p }));

  const handleSave = async () => {
    if (!isValid) {
      toast.error('Corrigez les erreurs avant d’enregistrer.');
      return;
    }
    try {
      await save({
        territoire_centers: serializeTerritoireCenters(state.headquarters, state.branches),
        google_place_id: state.google_place_id || null,
        geogrid_target_department: state.geogrid_target_department || null,
      });
      toast.success('Territoire enregistré');
      setInitial(state);
    } catch (err) {
      toast.error(err.message || 'Erreur lors de l’enregistrement');
    }
  };

  const handleDetectDepartment = async () => {
    const { lat, lng } = state.headquarters;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      toast.error('Renseignez d’abord la position du siège');
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
        patch({ geogrid_target_department: code });
        toast.success(`Département détecté : ${code}`);
      } else {
        toast.error('Impossible de détecter le département');
      }
    } catch {
      toast.error('Erreur lors de la détection');
    }
  };

  const addBranch = () => {
    setEditingBranchIdx(state.branches.length);
    setState((s) => ({ ...s, branches: [...s.branches, defaultBranch()] }));
  };

  const updateBranch = (idx, updated) => {
    setState((s) => ({ ...s, branches: s.branches.map((b, i) => (i === idx ? updated : b)) }));
  };

  const removeBranch = (idx) => {
    setState((s) => ({ ...s, branches: s.branches.filter((_, i) => i !== idx) }));
    if (editingBranchIdx === idx) setEditingBranchIdx(null);
  };

  if (isLoading) return <SettingsLoading />;

  return (
    <>
      <SettingsSurface>
        <SettingsSection
          title="Siège sur la carte"
          description="Point de départ des trajets et des tournées, centre de la carte du territoire."
        >
          <CenterEditor value={state.headquarters} onChange={(hq) => patch({ headquarters: hq })} />
          {(errors.hq_label || errors.hq_coords) && (
            <p className="text-xs text-red-700">{errors.hq_label || errors.hq_coords}</p>
          )}
        </SettingsSection>

        <SettingsSection
          title="Antennes commerciales"
          optional
          description="Pour un commercial basé ailleurs qu’au siège : ses trajets partent de son antenne."
        >
          {state.branches.length > 0 && (
            <ul className="rounded-lg border border-secondary-200 divide-y divide-secondary-100">
              {state.branches.map((b, idx) => {
                const isEditing = editingBranchIdx === idx;
                const branchErr = errors[`branch_label_${idx}`] || errors[`branch_coords_${idx}`];
                return (
                  <li key={idx}>
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <span className="text-xl" aria-hidden="true">{b.emoji || '📍'}</span>
                      <button
                        type="button"
                        onClick={() => setEditingBranchIdx(isEditing ? null : idx)}
                        aria-expanded={isEditing}
                        className="flex-1 min-w-0 text-left"
                      >
                        <span className="block text-sm font-medium text-secondary-900 truncate">
                          {b.label || <span className="text-secondary-400">Antenne sans nom</span>}
                        </span>
                        <span className="block text-xs text-secondary-500 tabular-nums">
                          {Number.isFinite(b.lat) && Number.isFinite(b.lng)
                            ? `${b.lat.toFixed(4)}, ${b.lng.toFixed(4)}`
                            : 'Position non renseignée'}
                        </span>
                        {branchErr && <span className="block mt-0.5 text-xs text-red-700">{branchErr}</span>}
                      </button>
                      <ChevronDown className={`w-4 h-4 text-secondary-400 transition-transform ${isEditing ? 'rotate-180' : ''}`} />
                      <button
                        type="button"
                        onClick={() => removeBranch(idx)}
                        className="p-1.5 text-secondary-400 hover:text-secondary-800 rounded"
                        aria-label="Supprimer l’antenne"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {isEditing && (
                      <div className="border-t border-secondary-100 bg-secondary-50/50 px-3 py-4">
                        <CenterEditor value={b} onChange={(u) => updateBranch(idx, u)} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <button type="button" onClick={addBranch} className="btn-secondary text-sm inline-flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Ajouter une antenne
          </button>
        </SettingsSection>

        <SettingsSection
          title="Visibilité locale"
          optional
          description="Utilisés par le suivi de positionnement Google (GeoGrid) : votre fiche et la zone à surveiller."
        >
          <Field
            label="Identifiant de la fiche Google Business"
            hint="Cherchez votre entreprise (pas l’adresse postale) dans l’outil Google, puis copiez l’identifiant ChIJ…"
          >
            <div className="flex gap-2">
              <input
                type="text"
                value={state.google_place_id}
                onChange={(e) => patch({ google_place_id: e.target.value })}
                placeholder="ChIJ…"
                className={`${INPUT_CLASS} font-mono`}
              />
              <a
                href={PLACE_ID_FINDER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary text-sm flex-shrink-0 inline-flex items-center gap-1.5"
              >
                Trouver <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </Field>
          <Field label="Département principal" hint="Les communes de ce département sont scannées par le suivi local.">
            <DepartmentSelect
              value={state.geogrid_target_department}
              onChange={(code) => patch({ geogrid_target_department: code })}
              onDetectFromHq={handleDetectDepartment}
            />
          </Field>
        </SettingsSection>
      </SettingsSurface>

      <SaveBar
        isDirty={isDirty}
        isValid={isValid}
        isSaving={isSaving}
        errorCount={Object.keys(errors).length}
        onSave={handleSave}
        onReset={() => setState(initial)}
      />
    </>
  );
}
