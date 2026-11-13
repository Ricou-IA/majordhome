/**
 * LecteurPdf.jsx — Lecteur PDF dans le logiciel (pdf.js, chargé à la demande)
 * ============================================================================
 * Une page à la fois, dessinée sur un canvas à la largeur de la zone (densité d'écran respectée). « Largeur »
 * ramène au plein écran de la zone, − / + zooment, ‹ › tournent les pages. La recherche lit le texte de toutes les
 * pages (à la première recherche seulement), surligne les occurrences de la page affichée et saute à la suivante.
 * pdf.js n'entre PAS dans le paquet principal : import dynamique, worker servi comme fichier à part.
 * Une erreur de chargement reste dans la zone, avec « Ouvrir dans un onglet ».
 * ============================================================================
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Search, ZoomIn, ZoomOut, MoveHorizontal, Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { logger } from '@lib/logger';

const PAS_ZOOM = 0.25;

let pdfjsPromise = null;
/** Charge pdf.js et son worker une seule fois, à la première ouverture d'un PDF. */
const chargerPdfjs = () => {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
      .then(([pdfjs, worker]) => {
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        return pdfjs;
      })
      .catch((e) => { pdfjsPromise = null; throw e; });
  }
  return pdfjsPromise;
};

const sansAccent = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * @param {{ url: string, pageInitiale?: number }} p
 */
export default function LecteurPdf({ url, pageInitiale = 1 }) {
  const [pdf, setPdf] = useState(null);
  const [erreur, setErreur] = useState(false);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [largeur, setLargeur] = useState(0);
  const [requete, setRequete] = useState('');
  const [trouves, setTrouves] = useState(null); // null = pas de recherche ; sinon [{ page, item, debut, fin }]
  const [rang, setRang] = useState(0);
  const [rects, setRects] = useState([]);
  const zoneRef = useRef(null);
  const canvasRef = useRef(null);
  const textesRef = useRef(new Map()); // page -> items de getTextContent()

  // Chargement du document, détruit au démontage ou quand l'adresse change.
  useEffect(() => {
    let actif = true;
    let tache = null;
    setPdf(null); setErreur(false); setTrouves(null); setRects([]); textesRef.current = new Map();
    chargerPdfjs()
      .then((pdfjs) => {
        if (!actif) return null;
        tache = pdfjs.getDocument({ url });
        return tache.promise;
      })
      .then((doc) => {
        if (!doc) return;
        if (!actif) { doc.destroy(); return; }
        setPdf(doc);
        setPage(Math.min(Math.max(1, Math.round(pageInitiale) || 1), doc.numPages));
      })
      .catch((e) => { logger.error('LecteurPdf : chargement', e); if (actif) setErreur(true); });
    return () => { actif = false; if (tache) tache.destroy(); };
  }, [url, pageInitiale]);

  // Largeur de la zone.
  useEffect(() => {
    const el = zoneRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const obs = new ResizeObserver(() => setLargeur(Math.floor(el.clientWidth)));
    obs.observe(el);
    setLargeur(Math.floor(el.clientWidth));
    return () => obs.disconnect();
  }, [pdf, erreur]);

  // Rendu de la page affichée, avec les rectangles de surlignage de la recherche.
  const occurrencesPage = trouves ? trouves.filter((t) => t.page === page) : [];
  const cleOccurrences = occurrencesPage.map((o) => `${o.item}:${o.debut}`).join(',');
  useEffect(() => {
    if (!pdf || !largeur) return undefined;
    let actif = true;
    let rendu = null;
    (async () => {
      try {
        const p = await pdf.getPage(page);
        const base = p.getViewport({ scale: 1 });
        const echelle = ((largeur - 16) / base.width) * zoom;
        const vp = p.getViewport({ scale: echelle });
        const canvas = canvasRef.current;
        if (!canvas || !actif) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(vp.width * dpr);
        canvas.height = Math.floor(vp.height * dpr);
        canvas.style.width = `${Math.floor(vp.width)}px`;
        canvas.style.height = `${Math.floor(vp.height)}px`;
        rendu = p.render({ canvasContext: canvas.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
        await rendu.promise;
        if (!actif) return;
        if (occurrencesPage.length > 0) {
          const pdfjs = await chargerPdfjs();
          const items = textesRef.current.get(page) || [];
          setRects(occurrencesPage.map((o) => {
            const it = items[o.item];
            const tx = pdfjs.Util.transform(vp.transform, it.transform);
            const h = Math.hypot(tx[2], tx[3]);
            const larg = it.width * vp.scale;
            const n = it.str.length || 1;
            return { left: tx[4] + (larg * o.debut) / n, top: tx[5] - h, width: (larg * (o.fin - o.debut)) / n, height: h };
          }));
        } else setRects([]);
      } catch (e) {
        if (e?.name !== 'RenderingCancelledException' && actif) { logger.error('LecteurPdf : rendu', e); setErreur(true); }
      }
    })();
    return () => { actif = false; if (rendu) rendu.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, page, zoom, largeur, cleOccurrences]);

  const chargerTextes = useCallback(async () => {
    for (let n = 1; n <= pdf.numPages; n += 1) {
      if (textesRef.current.has(n)) continue;
      const p = await pdf.getPage(n);
      const contenu = await p.getTextContent();
      textesRef.current.set(n, contenu.items.filter((i) => typeof i.str === 'string'));
    }
  }, [pdf]);

  const chercher = async (e) => {
    e?.preventDefault();
    const q = sansAccent(requete.trim());
    if (!pdf || !q) { setTrouves(null); setRects([]); return; }
    try {
      await chargerTextes();
      const liste = [];
      for (let n = 1; n <= pdf.numPages; n += 1) {
        (textesRef.current.get(n) || []).forEach((it, idx) => {
          const t = sansAccent(it.str);
          let i = t.indexOf(q);
          while (i !== -1) { liste.push({ page: n, item: idx, debut: i, fin: i + q.length }); i = t.indexOf(q, i + q.length); }
        });
      }
      setTrouves(liste);
      setRang(0);
      if (liste.length) setPage(liste[0].page);
    } catch (err) { logger.error('LecteurPdf : recherche', err); }
  };

  const suivante = () => {
    if (!trouves?.length) return;
    const r = (rang + 1) % trouves.length;
    setRang(r);
    setPage(trouves[r].page);
  };

  if (erreur) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="w-8 h-8 text-red-500" />
        <p className="text-sm text-red-700">Ce document n&apos;a pas pu être affiché dans le logiciel.</p>
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800">
          <ExternalLink className="w-4 h-4" />Ouvrir dans un onglet
        </a>
      </div>
    );
  }
  if (!pdf) return <div className="h-full flex items-center justify-center text-secondary-400"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const bouton = 'p-1.5 rounded hover:bg-secondary-100 disabled:opacity-30';
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-wrap items-center gap-1 px-2 py-1 border-b border-secondary-200 bg-white">
        <button type="button" onClick={() => setPage(page - 1)} disabled={page <= 1} className={bouton} aria-label="Page précédente"><ChevronLeft className="w-5 h-5" /></button>
        <span className="text-xs text-secondary-700 w-16 text-center">{page} / {pdf.numPages}</span>
        <button type="button" onClick={() => setPage(page + 1)} disabled={page >= pdf.numPages} className={bouton} aria-label="Page suivante"><ChevronRight className="w-5 h-5" /></button>
        <span className="w-px h-5 bg-secondary-200 mx-1" />
        <button type="button" onClick={() => setZoom(1)} className={`${bouton} inline-flex items-center gap-1 text-xs`}><MoveHorizontal className="w-4 h-4" />Largeur</button>
        <button type="button" onClick={() => setZoom(Math.max(0.5, zoom - PAS_ZOOM))} disabled={zoom <= 0.5} className={bouton} aria-label="Réduire"><ZoomOut className="w-5 h-5" /></button>
        <button type="button" onClick={() => setZoom(Math.min(4, zoom + PAS_ZOOM))} disabled={zoom >= 4} className={bouton} aria-label="Agrandir"><ZoomIn className="w-5 h-5" /></button>
        <form onSubmit={chercher} className="flex items-center gap-1 ml-auto">
          <input
            type="search" value={requete} onChange={(e) => setRequete(e.target.value)} placeholder="Chercher dans le document"
            className="h-8 w-44 px-2 text-sm border border-secondary-300 rounded"
          />
          <button type="submit" className={bouton} aria-label="Chercher"><Search className="w-4 h-4" /></button>
          {trouves && (
            <>
              <span className="text-xs text-secondary-600 whitespace-nowrap">{trouves.length ? `${rang + 1} / ${trouves.length}` : 'Aucun résultat'}</span>
              <button type="button" onClick={suivante} disabled={!trouves.length} className={`${bouton} text-xs`}>Suivante</button>
            </>
          )}
        </form>
      </div>
      <div ref={zoneRef} className="flex-1 min-h-0 overflow-auto bg-secondary-100 p-2" style={{ touchAction: 'pan-x pan-y pinch-zoom' }}>
        <div className="relative mx-auto bg-white shadow-sm" style={{ width: 'fit-content' }}>
          <canvas ref={canvasRef} />
          {rects.map((r, i) => (
            <div
              key={`${r.left}-${r.top}-${i}`}
              className="absolute bg-amber-300/50 ring-1 ring-amber-500 pointer-events-none"
              style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
