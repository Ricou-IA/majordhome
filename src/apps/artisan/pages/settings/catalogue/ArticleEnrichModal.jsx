// src/apps/artisan/pages/settings/catalogue/ArticleEnrichModal.jsx
// « Enrichir depuis le web » (fiche article, org_admin) : l'IA cherche photo, fiche technique PDF et caractéristiques
// (edge catalog-item-enrich), l'admin coche ce qu'il garde, puis on applique. Rien n'est écrit sans validation ; une
// valeur déjà saisie n'est jamais cochée d'office (cochesParDefaut). Décision d'Eric, 2026-10-25.
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, Sparkles, ExternalLink, FileText, Image as ImageIcon, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cochesParDefaut } from '@/lib/catalogue/enrichissement.js';

function valeurLisible(champ, v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  return champ?.unit ? `${v} ${champ.unit}` : String(v);
}

function Case({ checked, onChange, disabled }) {
  return <input type="checkbox" className="w-4 h-4 accent-primary-600" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />;
}

/**
 * @param {{ item: any, champs: Array<{ key: string, label: string, unit: string | null }>, onClose: () => void,
 *   propose: (itemId: string, champs: any[]) => Promise<any>, apply: (itemId: string, selection: any) => Promise<any>,
 *   applying?: boolean }} p
 */
export default function ArticleEnrichModal({ item, champs, onClose, propose, apply, applying = false }) {
  const [etat, setEtat] = useState('recherche');
  const [erreur, setErreur] = useState('');
  const [prop, setProp] = useState(null);
  const [photo, setPhoto] = useState(false);
  const [fiche, setFiche] = useState(false);
  const [specs, setSpecs] = useState(new Set());
  const lance = useRef(false);
  const actuel = useMemo(() => item?.specs?.canonical || {}, [item]);
  const parCle = useMemo(() => new Map(champs.map((c) => [c.key, c])), [champs]);

  // monté ou non : suivi à part, car le nettoyage du double effet du mode strict jetterait sinon le seul résultat
  const monte = useRef(true);
  useEffect(() => { monte.current = true; return () => { monte.current = false; }; }, []);

  // une seule recherche par ouverture (le double effet du mode strict relancerait un appel payant)
  useEffect(() => {
    if (lance.current) return;
    lance.current = true;
    propose(item.id, champs).then((p) => {
      if (!monte.current) return;
      setProp(p);
      setPhoto(!!p.photo_url && !p.photo_refus && !item.image_url);
      setFiche(!!p.fiche_url && !p.fiche_refus);
      setSpecs(cochesParDefaut(actuel, p.specs));
      setEtat('choix');
    }).catch((e) => { if (monte.current) { setErreur(e?.message || 'Recherche impossible'); setEtat('erreur'); } });
  }, [item, champs, actuel, propose]);

  const clesProposees = Object.keys(prop?.specs || {});
  const rien = prop && !prop.photo_url && !prop.fiche_url && clesProposees.length === 0;
  const nbChoix = (photo ? 1 : 0) + (fiche ? 1 : 0) + specs.size;

  const basculer = (k, oui) => setSpecs((s) => { const n = new Set(s); if (oui) n.add(k); else n.delete(k); return n; });

  const appliquer = async () => {
    const acceptees = Object.fromEntries([...specs].map((k) => [k, prop.specs[k]]));
    try {
      const r = await apply(item.id, { photoUrl: photo ? prop.photo_url : null, ficheUrl: fiche ? prop.fiche_url : null, specs: acceptees });
      const faits = [r.photo && 'photo', r.document && 'fiche technique', r.specs_appliquees && `${r.specs_appliquees} caractéristique${r.specs_appliquees > 1 ? 's' : ''}`].filter(Boolean);
      if (faits.length) toast.success(`Article enrichi : ${faits.join(', ')}`);
      (r.erreurs || []).forEach((e) => toast.error(e));
      onClose();
    } catch (e) { toast.error(e?.message || 'Application refusée'); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col m-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-secondary-900 flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-primary-600" /> Enrichir depuis le web</h3>
            <p className="text-xs text-secondary-400 break-words">« {item.name} » — rien n&apos;est enregistré sans votre validation</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-secondary-100 rounded"><X className="w-5 h-5 text-secondary-500" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {etat === 'recherche' && (
            <div className="flex flex-col items-center gap-2 py-10 text-sm text-secondary-500">
              <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
              Recherche sur le web… (jusqu&apos;à deux minutes)
            </div>
          )}
          {etat === 'erreur' && <p className="text-sm text-red-700 bg-red-50 rounded px-3 py-2">{erreur}</p>}

          {etat === 'choix' && prop && (
            <>
              {rien && <p className="text-sm text-secondary-500">Rien de fiable trouvé pour cet article. Complétez la marque ou la référence, puis relancez.</p>}
              {prop.remarque && <p className="text-xs text-secondary-600 bg-secondary-50 rounded px-3 py-2">{prop.remarque}</p>}
              {prop.source_url && (
                <a href={prop.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-700 hover:underline inline-flex items-center gap-1 break-all">
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" /> Page source : {prop.source_url}
                </a>
              )}

              <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="border rounded-lg p-3 space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-secondary-800">
                    <Case checked={photo} onChange={setPhoto} disabled={!prop.photo_url || !!prop.photo_refus} /> <ImageIcon className="w-4 h-4" /> Photo
                  </label>
                  {prop.photo_url && !prop.photo_refus && <img src={prop.photo_url} alt="" className="w-28 h-28 object-contain rounded border bg-white" />}
                  {prop.photo_refus && <p className="text-xs text-amber-700 flex gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {prop.photo_refus}</p>}
                  {photo && item.image_url && <p className="text-[11px] text-secondary-500">Remplacera la photo actuelle.</p>}
                </div>
                <div className="border rounded-lg p-3 space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-secondary-800">
                    <Case checked={fiche} onChange={setFiche} disabled={!prop.fiche_url || !!prop.fiche_refus} /> <FileText className="w-4 h-4" /> Fiche technique (PDF)
                  </label>
                  {prop.fiche_url && (
                    <a href={prop.fiche_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-700 hover:underline break-all">{prop.fiche_url}</a>
                  )}
                  {prop.fiche_refus && <p className="text-xs text-amber-700 flex gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {prop.fiche_refus}</p>}
                  {fiche && <p className="text-[11px] text-secondary-500">Téléchargée et rangée dans les documents de l&apos;article.</p>}
                </div>
              </section>

              {clesProposees.length > 0 && (
                <section className="space-y-1.5">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary-500">Caractéristiques</h4>
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-secondary-400"><th className="w-8" /><th className="py-1">Caractéristique</th><th>Actuelle</th><th>Trouvée</th></tr></thead>
                    <tbody>
                      {clesProposees.map((k) => {
                        const c = parCle.get(k);
                        return (
                          <tr key={k} className="border-t border-secondary-100">
                            <td className="py-1.5"><Case checked={specs.has(k)} onChange={(v) => basculer(k, v)} /></td>
                            <td className="py-1.5 text-secondary-800">{c?.label || k}</td>
                            <td className="py-1.5 text-secondary-500">{valeurLisible(c, actuel[k])}</td>
                            <td className="py-1.5 font-medium text-secondary-900">{valeurLisible(c, prop.specs[k])}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="text-[11px] text-secondary-400">Une valeur déjà saisie n&apos;est cochée que si vous le décidez.</p>
                </section>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t">
          <button type="button" onClick={onClose} className="btn-secondary btn-sm">Fermer</button>
          {etat === 'choix' && (
            <button type="button" onClick={appliquer} disabled={!nbChoix || applying} className="btn-primary btn-sm">
              {applying ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null} Appliquer la sélection{nbChoix ? ` (${nbChoix})` : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
