/**
 * AppareilAControlerFiche.jsx — une fiche d'appareil créée sur le terrain, dans la file de contrôle de
 * l'administrateur : la voir (photo, caractéristiques, documents, sources, clients), puis Valider, Corriger ou
 * Fusionner avec une fiche existante. Règles et droits : RPC equipment_model_review / equipment_model_merge.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Package, Check, Pencil, GitMerge, ExternalLink, FileText, Loader2 } from 'lucide-react';
import { useEquipmentModelImages, useModelFiles, useModelReview, useEquipmentModelsForBrand } from '@hooks/useEquipmentModels';
import { useEquipmentReferential } from '@hooks/useEquipmentReferential';
import { filtrerModeles } from '@/lib/catalogue/nomenclature';
import { messageErreurAppareil } from '@/lib/equipements/saisieAppareil';
import { formatDateShortFR } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import LecteurEnLigne from '../equipements/LecteurEnLigne';

const INPUT = 'w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg';

/**
 * @param {{ fiche: object, onDone: () => void }} p
 */
export default function AppareilAControlerFiche({ fiche, onDone }) {
  const [mode, setMode] = useState('voir'); // voir | corriger | fusionner
  const [form, setForm] = useState({ brand: fiche.brand, model_name: fiche.model_name, reference: fiche.reference, equipment_type_id: fiche.equipment_type_id || '' });
  const [retirerPhoto, setRetirerPhoto] = useState(false);
  const [docsRetires, setDocsRetires] = useState([]);
  const [recherche, setRecherche] = useState('');
  const [cible, setCible] = useState(null);
  const [consulte, setConsulte] = useState(null);
  const { photo } = useEquipmentModelImages(fiche, !!fiche.photo_path);
  const { documents } = useModelFiles(fiche.id);
  const { review, merge, isSaving } = useModelReview();
  const { equipmentTypes } = useEquipmentReferential();
  const { modeles } = useEquipmentModelsForBrand(fiche.brand, mode === 'fusionner');
  const candidats = useMemo(() => filtrerModeles(modeles.filter((m) => m.id !== fiche.id), recherche).slice(0, 30), [modeles, fiche.id, recherche]);
  const typeLabel = equipmentTypes.find((t) => t.id === fiche.equipment_type_id)?.label || null;
  const specs = Object.entries(fiche.specs || {});

  const valider = async (patch = {}) => {
    try {
      await review({ modelId: fiche.id, patch });
      toast.success('Fiche contrôlée');
      onDone();
    } catch (err) { toast.error(messageErreurAppareil(err)); }
  };

  const corriger = () => valider({
    brand: form.brand, model_name: form.model_name, reference: form.reference,
    equipment_type_id: form.equipment_type_id || '', retirer_photo: retirerPhoto, documents_retires: docsRetires,
  });

  const fusionner = async () => {
    try {
      const r = await merge({ absorbedId: fiche.id, survivorId: cible.id });
      toast.success(`Fiche fusionnée : ${r?.equipements ?? 0} équipement(s) déplacé(s)`);
      setCible(null);
      onDone();
    } catch (err) { toast.error(messageErreurAppareil(err)); }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <div className="w-28 h-28 flex-shrink-0 rounded-lg border border-gray-200 bg-white overflow-hidden flex items-center justify-center">
          {photo && !retirerPhoto ? <img src={photo} alt="" className="w-full h-full object-contain" /> : <Package className="w-8 h-8 text-gray-300" />}
        </div>
        <div className="min-w-0 space-y-0.5">
          <p className="text-base font-semibold text-gray-900">{fiche.brand} · {fiche.model_name}</p>
          <p className="text-sm text-gray-600">Réf. {fiche.reference}{fiche.category ? ` · ${fiche.category}` : ''}{fiche.lifecycle === 'arrete' ? ' · plus vendu' : ''}</p>
          {typeLabel && <p className="text-xs text-gray-500">Type : {typeLabel}</p>}
          <p className="text-xs text-gray-500">Trouvée sur le web par {fiche.created_by_name || 'un membre'} le {formatDateShortFR(fiche.created_at)}</p>
        </div>
      </div>

      {specs.length > 0 && (
        <div className="text-xs text-gray-700">
          <p className="font-medium text-gray-500 uppercase tracking-wide mb-1">Caractéristiques lues</p>
          <p>{specs.map(([k, v]) => `${k} : ${v}`).join(' · ')}</p>
        </div>
      )}

      <div className="space-y-1">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Documents</p>
        {documents.length === 0 && <p className="text-xs text-gray-500">Aucun document.</p>}
        {documents.map((d) => (
          <div key={d.id} className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm">
            <button type="button" onClick={() => setConsulte((c) => (c?.id === d.id ? null : d))} className="inline-flex items-center gap-1.5 text-indigo-700 hover:text-indigo-900">
              <FileText className="w-4 h-4" />{d.label || d.file_name}
            </button>
            {mode === 'corriger' && (
              <label className="ml-auto inline-flex items-center gap-1 text-xs text-gray-600">
                <input type="checkbox" checked={docsRetires.includes(d.id)} onChange={(e) => setDocsRetires((p) => (e.target.checked ? [...p, d.id] : p.filter((x) => x !== d.id)))} />
                Retirer
              </label>
            )}
          </div>
          {consulte?.id === d.id && <LecteurEnLigne doc={d} onClose={() => setConsulte(null)} />}
          </div>
        ))}
        {(fiche.source_urls || []).length > 0 && (
          <p className="flex flex-wrap gap-x-3 text-xs">
            {fiche.source_urls.map((u) => (
              <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800">
                <ExternalLink className="w-3 h-3" />{(() => { try { return new URL(u).hostname; } catch { return 'source'; } })()}
              </a>
            ))}
          </p>
        )}
      </div>

      <div className="text-sm">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Installée chez</p>
        {(fiche.clients || []).length === 0
          ? <p className="text-xs text-gray-500">Aucun client (saisie abandonnée) : validez-la ou fusionnez-la.</p>
          : <p className="flex flex-wrap gap-x-3">{fiche.clients.map((c) => <Link key={c.client_id} to={`/clients/${c.client_id}`} className="text-indigo-700 hover:text-indigo-900">{c.display_name} ({c.client_number})</Link>)}</p>}
      </div>

      {mode === 'corriger' && (
        <div className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-gray-50">
          <label className="text-xs text-gray-600">Marque<input className={INPUT} value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></label>
          <label className="text-xs text-gray-600">Modèle<input className={INPUT} value={form.model_name} onChange={(e) => setForm({ ...form, model_name: e.target.value })} /></label>
          <label className="text-xs text-gray-600">Référence fabricant<input className={INPUT} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></label>
          <label className="text-xs text-gray-600">Type d&apos;équipement
            <select className={INPUT} value={form.equipment_type_id} onChange={(e) => setForm({ ...form, equipment_type_id: e.target.value })}>
              <option value="">Non précisé</option>
              {equipmentTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          {fiche.photo_path && (
            <label className="col-span-2 inline-flex items-center gap-1.5 text-xs text-gray-600">
              <input type="checkbox" checked={retirerPhoto} onChange={(e) => setRetirerPhoto(e.target.checked)} />Retirer la photo
            </label>
          )}
        </div>
      )}

      {mode === 'fusionner' && (
        <div className="space-y-2 p-3 rounded-lg bg-gray-50">
          <input className={INPUT} value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder={`Chercher une fiche ${fiche.brand} (nom ou référence)`} />
          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {candidats.map((m) => (
              <button key={m.id} type="button" onClick={() => setCible(m)} className="w-full text-left px-2 py-1.5 rounded hover:bg-white text-sm">
                {m.model_name || m.name} <span className="text-xs text-gray-500">· réf. {m.reference}{m.origin === 'releve_fabricant' ? ' · fabricant' : ''}</span>
              </button>
            ))}
            {candidats.length === 0 && <p className="text-xs text-gray-500 px-2">Aucune autre fiche {fiche.brand}.</p>}
          </div>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-gray-100">
        {isSaving && <Loader2 className="w-4 h-4 animate-spin text-gray-400 self-center" />}
        {mode !== 'voir' && <button type="button" onClick={() => setMode('voir')} className="btn-secondary btn-sm">Annuler</button>}
        {mode === 'voir' && <>
          <button type="button" onClick={() => setMode('fusionner')} className="btn-secondary btn-sm inline-flex items-center gap-1.5"><GitMerge className="w-4 h-4" />Fusionner avec…</button>
          <button type="button" onClick={() => setMode('corriger')} className="btn-secondary btn-sm inline-flex items-center gap-1.5"><Pencil className="w-4 h-4" />Corriger</button>
          <button type="button" disabled={isSaving} onClick={() => valider()} className="btn-primary btn-sm inline-flex items-center gap-1.5"><Check className="w-4 h-4" />Valider</button>
        </>}
        {mode === 'corriger' && <button type="button" disabled={isSaving} onClick={corriger} className="btn-primary btn-sm">Corriger et valider</button>}
      </div>

      <ConfirmDialog
        open={!!cible} onOpenChange={(o) => { if (!o) setCible(null); }}
        title="Fusionner cette fiche"
        description={cible ? `« ${fiche.model_name} » sera absorbée par « ${cible.model_name || cible.name} » : ${fiche.nb_equipements} équipement(s) et ses documents passeront sur cette fiche.` : ''}
        confirmLabel="Fusionner" variant="default" onConfirm={fusionner} loading={isSaving}
      />
    </div>
  );
}
