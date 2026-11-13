/**
 * AtelierPieces.jsx — Mode atelier du bloc « Pièces détachées » : le document en face de la liste
 * ============================================================================
 * Dans la page, sans voile ni plein écran (Eric, maquette B) : en-tête « Pièces détachées · modèle · Réduire »,
 * onglets des documents du modèle, document à gauche, liste à droite, poignée au milieu (glisser, bornes 30 % – 75 %,
 * départ 60 %). Pendant le glissé, seul un trait guide suit le doigt : la colonne du document (et le PDF, coûteux à
 * redessiner) ne change de largeur qu'au lâcher. Zone de prise de 36 px autour d'un trait fin.
 * Hauteur = hauteur visible moins l'en-tête de la page (420 px au moins).
 * Téléphone : document au-dessus (60vh), liste en dessous, pas de poignée. Sans liste (`liste` nul) : document seul.
 * Vue éclatée tirée d'une notice : l'avertissement des repères reste au-dessus du document.
 * Règles (onglet actif, bornes de la poignée) : src/lib/catalogue/documentsAppareil.js (pur, testé).
 * ============================================================================
 */

import { useEffect, useRef, useState } from 'react';
import { Wrench, Minimize2, AlertTriangle, Loader2, GripVertical } from 'lucide-react';
import { useDeviceClass } from '@hooks/useDeviceClass';
import { ongletActif, bornerPartDocument, PART_DOCUMENT } from '@/lib/catalogue/documentsAppareil';
import LecteurDocument from './lecteur/LecteurDocument';

const PAS_CLAVIER = 0.05;

function AvertissementNotice() {
  return (
    <p className="flex items-start gap-1.5 text-xs text-amber-900 bg-amber-50 border-b border-amber-200 px-3 py-1.5">
      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
      <span>Le fabricant ne publie pas de vue éclatée pour ce modèle : celle-ci vient de la notice. <strong>Ses repères sont ceux de la notice, pas ceux de la liste.</strong> Lisez la référence dans la nomenclature de la notice, puis cherchez-la dans la liste.</span>
    </p>
  );
}

/**
 * @param {object} p
 * @param {string} [p.titre] modèle affiché dans l'en-tête
 * @param {Array<{ id: string, libelle: string, source: object }>} p.onglets onglets de `ongletsAtelier`
 * @param {string|null} [p.ongletId] onglet demandé (sinon le premier)
 * @param {(ongletId: string) => void} p.onOnglet
 * @param {boolean} [p.vueNotice] l'onglet affiché est une vue tirée de la notice
 * @param {boolean} [p.chargement] vues éclatées en cours de chargement
 * @param {import('react').ReactNode} [p.liste] colonne de droite ; nul = document seul
 * @param {() => void} p.onReduire
 */
export default function AtelierPieces({ titre = '', onglets, ongletId = null, onOnglet, vueNotice = false, chargement = false, liste = null, onReduire }) {
  const { isPhone } = useDeviceClass();
  const [part, setPart] = useState(PART_DOCUMENT.defaut);
  const [guide, setGuide] = useState(null); // part visée pendant le glissé, null hors glissé
  const glisse = guide !== null;
  const racineRef = useRef(null);
  const corpsRef = useRef(null);
  const actif = ongletActif(onglets, ongletId);
  const cote = !!liste && !isPhone;

  // Le bloc grandit à l'ouverture : on l'amène à l'écran (fiche longue, fenêtre SAV)
  useEffect(() => { racineRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, []);

  const partSous = (e) => {
    const rect = corpsRef.current?.getBoundingClientRect();
    if (!rect?.width) return null;
    return bornerPartDocument((e.clientX - rect.left) / rect.width);
  };
  const poignee = {
    onPointerDown: (e) => { e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); setGuide(part); },
    onPointerMove: (e) => { if (glisse) { const v = partSous(e); if (v !== null) setGuide(v); } },
    onPointerUp: (e) => {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      if (glisse) setPart(guide);
      setGuide(null);
    },
    onPointerCancel: () => setGuide(null),
    onKeyDown: (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); setPart((v) => bornerPartDocument(v - PAS_CLAVIER)); }
      if (e.key === 'ArrowRight') { e.preventDefault(); setPart((v) => bornerPartDocument(v + PAS_CLAVIER)); }
    },
  };

  const zoneDocument = (
    <div className="flex flex-col min-h-0 min-w-0 h-full">
      {onglets.length > 1 && (
        <div role="tablist" aria-label="Documents du modèle" className="flex gap-1 overflow-x-auto px-2 pt-2 border-b border-secondary-200 bg-secondary-50 flex-shrink-0">
          {onglets.map((o) => {
            const choisi = o.id === actif?.id;
            return (
              <button
                key={o.id} type="button" role="tab" aria-selected={choisi} onClick={() => onOnglet(o.id)}
                className={`px-3 py-1.5 text-xs whitespace-nowrap rounded-t-md border-b-2 ${choisi ? 'bg-white border-indigo-600 text-indigo-700 font-semibold' : 'border-transparent text-secondary-600 hover:text-secondary-900 hover:bg-white/60'}`}
              >
                {o.libelle}
              </button>
            );
          })}
        </div>
      )}
      {onglets.length === 1 && actif && (
        <p className="px-3 py-1.5 text-xs font-medium text-secondary-700 border-b border-secondary-200 bg-secondary-50 flex-shrink-0">{actif.libelle}</p>
      )}
      {vueNotice && <AvertissementNotice />}
      <div className="flex-1 min-h-0">
        {chargement && <div className="h-full flex items-center justify-center text-secondary-400"><Loader2 className="w-6 h-6 animate-spin" /></div>}
        {!chargement && actif && <LecteurDocument key={actif.id} source={actif.source} />}
        {!chargement && !actif && (
          <div className="h-full flex items-center justify-center p-6 text-center">
            <p className="text-sm text-secondary-500">Aucun document à lire pour ce modèle.</p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div ref={racineRef} className={`rounded-lg border border-secondary-200 bg-white ${glisse ? 'select-none' : ''}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-secondary-200">
        <Wrench className="w-4 h-4 text-indigo-500 flex-shrink-0" />
        <span className="text-sm font-medium text-secondary-900 flex-shrink-0">Pièces détachées</span>
        {titre && <span className="text-xs text-secondary-500 truncate">{titre}</span>}
        <button type="button" onClick={onReduire} className="ml-auto flex-shrink-0 inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium">
          <Minimize2 className="w-3.5 h-3.5" />Réduire
        </button>
      </div>

      {cote ? (
        <div ref={corpsRef} className="relative flex" style={{ height: 'calc(100vh - 12rem)', minHeight: 420 }}>
          <div className="min-w-0 flex-shrink-0" style={{ width: `${part * 100}%` }}>{zoneDocument}</div>
          <div
            role="separator" aria-orientation="vertical" aria-label="Régler la part du document et de la liste"
            aria-valuemin={Math.round(PART_DOCUMENT.min * 100)} aria-valuemax={Math.round(PART_DOCUMENT.max * 100)} aria-valuenow={Math.round(part * 100)}
            tabIndex={0} {...poignee}
            className={`relative w-3 flex-shrink-0 flex items-center justify-center cursor-col-resize touch-none border-x border-secondary-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${glisse ? 'bg-indigo-100' : 'bg-secondary-50 hover:bg-secondary-100'}`}
          >
            {/* zone de prise élargie (36 px) au doigt, sans décaler la mise en page */}
            <span aria-hidden="true" className="absolute inset-y-0 -left-3 -right-3 z-10" />
            <GripVertical className="w-3 h-3 text-secondary-400" />
          </div>
          {glisse && (
            <div aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-indigo-500 pointer-events-none z-20" style={{ left: `${guide * 100}%` }} />
          )}
          <div className="flex-1 min-w-0 overflow-y-auto p-3 space-y-3">{liste}</div>
        </div>
      ) : (
        <>
          <div style={isPhone ? { height: '60vh' } : { height: 'calc(100vh - 12rem)', minHeight: 420 }}>{zoneDocument}</div>
          {liste && <div className="border-t border-secondary-200 p-3 space-y-3">{liste}</div>}
        </>
      )}
    </div>
  );
}
