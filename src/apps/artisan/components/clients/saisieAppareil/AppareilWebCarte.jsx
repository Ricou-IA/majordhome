/**
 * AppareilWebCarte.jsx — un appareil proposé par la recherche web. Nom et référence se corrigent avant
 * « C'est cet appareil » ; rien n'est enregistré avant ce clic.
 */

import { useState } from 'react';
import { Package, ExternalLink, FileText, Loader2, Check } from 'lucide-react';

/**
 * @param {{ appareil: object, champs?: Array<{ key: string, label: string, unit?: string|null }>, isCreating?: boolean,
 *   onValider: (appareil: object) => void }} p
 */
export default function AppareilWebCarte({ appareil, champs = [], isCreating = false, onValider }) {
  const [modelName, setModelName] = useState(appareil.model_name || '');
  const [reference, setReference] = useState(appareil.reference || '');
  const lus = champs.filter((c) => appareil.specs?.[c.key] != null);

  return (
    <div className="p-3 rounded-lg border border-gray-200 space-y-2">
      <div className="flex gap-3">
        <div className="w-16 h-16 flex-shrink-0 rounded-md bg-white border border-gray-200 overflow-hidden flex items-center justify-center">
          {appareil.photo_url ? <img src={appareil.photo_url} alt="" className="w-full h-full object-contain" /> : <Package className="w-6 h-6 text-gray-300" />}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs text-gray-500">{appareil.brand}{appareil.category ? ` · ${appareil.category}` : ''}{appareil.en_vente === false ? ' · plus vendu' : ''}</p>
          <input
            value={modelName} onChange={(e) => setModelName(e.target.value)} aria-label="Nom du modèle"
            className="w-full px-2 py-1 text-sm font-medium border border-gray-300 rounded"
          />
          <input
            value={reference} onChange={(e) => setReference(e.target.value)} aria-label="Référence fabricant" placeholder="Référence fabricant (inconnue)"
            className="w-full px-2 py-1 text-xs font-mono border border-gray-300 rounded"
          />
        </div>
      </div>
      {appareil.remarque && <p className="text-xs text-gray-600">{appareil.remarque}</p>}
      {lus.length > 0 && (
        <p className="text-xs text-gray-600">{lus.map((c) => `${c.label} : ${appareil.specs[c.key]}${c.unit ? ` ${c.unit}` : ''}`).join(' · ')}</p>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {appareil.notice_url && <span className="inline-flex items-center gap-1 text-gray-600"><FileText className="w-3 h-3" />Notice</span>}
        {appareil.fiche_url && <span className="inline-flex items-center gap-1 text-gray-600"><FileText className="w-3 h-3" />Fiche technique</span>}
        {(appareil.source_urls || []).map((u) => (
          <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800">
            <ExternalLink className="w-3 h-3" />{(() => { try { return new URL(u).hostname; } catch { return 'source'; } })()}
          </a>
        ))}
      </div>
      <div className="flex justify-end">
        <button
          type="button" disabled={isCreating || !modelName.trim()}
          onClick={() => onValider({ ...appareil, model_name: modelName.trim(), reference: reference.trim() || null })}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {isCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          C&apos;est cet appareil
        </button>
      </div>
    </div>
  );
}
