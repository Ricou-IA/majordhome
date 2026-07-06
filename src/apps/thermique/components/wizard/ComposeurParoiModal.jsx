// src/apps/thermique/components/wizard/ComposeurParoiModal.jsx
// Modale « Composer la paroi » (étape 3 wizard Thermique) : empile des couches de matériaux
// (materiaux.json Th-U, via MateriauPicker), calcule le U en direct (uParoiDepuisCouches) et le
// remonte au composant famille. Charger/enregistrer une paroi nommée dans la bibliothèque ORG
// (core.organizations.settings.thermique.parois_bibliotheque, via useOrgSettings). Pattern modale
// du repo (overlay + panneau fixed, cf. UwHelperModal). Le moteur reste INTACT : on ne produit que
// { u, couches } ; la bibliothèque ne stocke que des compositions nommées réutilisables.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { X, Trash2, Save, Plus } from 'lucide-react';
import { useOrgSettings } from '@hooks/useOrgSettings';
import MateriauPicker from './MateriauPicker';
import { uParoiDepuisCouches, ajouteParoiBibliotheque } from '../../lib/composeurParois';
import { buildThermiqueConfig } from '../../lib/thermiqueConfig';

export default function ComposeurParoiModal({ famille, label, couchesInitiales, onApply, onClose }) {
  // Copie profonde des couches d'entrée (jamais muter la prop) ; vide sinon.
  const [couches, setCouches] = useState(
    () => (Array.isArray(couchesInitiales) ? couchesInitiales.map((c) => ({ ...c })) : []),
  );
  const [nomBiblio, setNomBiblio] = useState('');
  const [pickerOuvert, setPickerOuvert] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { settings, save, isSaving } = useOrgSettings();
  const config = buildThermiqueConfig(settings);
  const bibliothequeFamille = config.parois_bibliotheque.filter((p) => p.famille === famille);

  const ajoute = (m) => {
    setCouches((prev) => [...prev, { materiauNom: m.nom, lambda: m.lambda, e: 10 }]);
    setPickerOuvert(false); // couche ajoutée → on referme le sélecteur (cause → effet clair)
  };
  const setEpaisseur = (i, brut) => setCouches((prev) => prev.map((c, j) => (
    j === i ? { ...c, e: brut === '' ? '' : Number(brut) } : c
  )));
  const supprime = (i) => setCouches((prev) => prev.flatMap((c, j) => (j === i ? [] : [c])));

  const chargerDepuisBiblio = (id) => {
    const entree = config.parois_bibliotheque.find((p) => p.id === id);
    if (entree) setCouches((entree.couches ?? []).map((c) => ({ ...c })));
  };

  const { u, erreur } = uParoiDepuisCouches(couches, famille);

  const enregistrerBiblio = async () => {
    const { bibliotheque, erreur: errAjout } = ajouteParoiBibliotheque(
      config.parois_bibliotheque, { nom: nomBiblio, famille, u, couches }, crypto.randomUUID(),
    );
    if (errAjout) { toast.error(errAjout); return; }
    try {
      // ⚠ org_update_settings merge JSONB niveau 1 → sauver l'objet `thermique` COMPLET.
      await save({ thermique: { ...(settings?.thermique ?? {}), parois_bibliotheque: bibliotheque } });
      toast.success('Paroi enregistrée dans la bibliothèque');
      setNomBiblio('');
    } catch {
      toast.error('Enregistrement impossible');
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Composer la paroi — ${label}`}
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-lg rounded-xl border border-secondary-200 bg-white p-5 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-secondary-900">Composer la paroi — {label}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-secondary-500 hover:bg-secondary-100 rounded-lg"
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {bibliothequeFamille.length > 0 && (
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-secondary-700">Charger depuis la bibliothèque</label>
            <select
              value=""
              onChange={(e) => chargerDepuisBiblio(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-secondary-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">— Choisir une paroi enregistrée —</option>
              {bibliothequeFamille.map((p) => (
                <option key={p.id} value={p.id}>{p.nom} — U {p.u}</option>
              ))}
            </select>
          </div>
        )}

        {/* Couches de la paroi (de l'extérieur vers l'intérieur) */}
        {couches.length === 0 ? (
          <p className="text-sm text-secondary-500">
            Aucune couche pour l’instant. Ajoutez les matériaux de l’extérieur vers l’intérieur.
          </p>
        ) : (
          <ul className="divide-y divide-secondary-100 border border-secondary-100 rounded-lg">
            {couches.map((c, i) => (
              <li key={`${c.materiauNom}-${i}`} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-secondary-900 truncate">{c.materiauNom}</p>
                  <p className="text-xs text-secondary-500">
                    λ {c.lambda}
                    {Number.isFinite(c.e) && c.e > 0 && ` · R ${(c.e / 100 / c.lambda).toFixed(3)} m²·K/W`}
                  </p>
                </div>
                <label className="flex items-center gap-1 text-xs text-secondary-600">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={c.e}
                    onChange={(e) => setEpaisseur(i, e.target.value)}
                    className="w-16 px-2 py-1.5 text-sm border border-secondary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    aria-label="Épaisseur (cm)"
                  />
                  cm
                </label>
                <button
                  type="button"
                  onClick={() => supprime(i)}
                  className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg flex-shrink-0"
                  title="Supprimer la couche"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Ajouter une couche : bouton explicite « + » → sélecteur de matériau (auto-focus). */}
        {pickerOuvert ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-secondary-700">Choisir un matériau</label>
              <button
                type="button"
                onClick={() => setPickerOuvert(false)}
                className="text-xs text-secondary-500 hover:text-secondary-700"
              >
                Fermer
              </button>
            </div>
            <MateriauPicker famille={null} onSelect={ajoute} autoFocus />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPickerOuvert(true)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-primary-700 border border-dashed border-primary-300 rounded-lg hover:bg-primary-50"
          >
            <Plus className="w-4 h-4" /> Ajouter une couche
          </button>
        )}

        <div
          className={`px-3 py-2 rounded-lg border text-sm ${
            erreur
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-secondary-50 border-secondary-200 text-secondary-900'
          }`}
        >
          {erreur ? erreur : <>U = <span className="font-semibold">{u}</span> W/(m²·K)</>}
        </div>

        {/* Enregistrer la composition courante comme paroi réutilisable (org). */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={nomBiblio}
            onChange={(e) => setNomBiblio(e.target.value)}
            placeholder="Nom pour la bibliothèque…"
            className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-secondary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button
            type="button"
            onClick={enregistrerBiblio}
            disabled={u == null || nomBiblio.trim() === '' || isSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-secondary-700 border border-secondary-300 rounded-lg hover:bg-secondary-50 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
          >
            <Save className="w-3.5 h-3.5" /> Enregistrer
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-secondary-700 border border-secondary-300 rounded-lg hover:bg-secondary-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => onApply({ u, couches })}
            disabled={u == null}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Utiliser cette paroi
          </button>
        </div>
      </div>
    </>
  );
}
