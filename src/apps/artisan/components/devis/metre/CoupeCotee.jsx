// src/apps/artisan/components/devis/metre/CoupeCotee.jsx
// Coupe cotée d'un métré, tous gabarits — RENDU PUR de la scène (src/lib/fumisterie/scene.js), qui
// est aussi celle du plan annexé au devis : écran et PDF dessinent la même chose. Une cote =
// <g role="button"> : clic / Entrée → onFocusChamp(cle) et le formulaire met le champ en édition.
import { useMemo } from 'react';
import { construireScene } from '@/lib/fumisterie/scene.js';

/** Clé de ton de la scène → classes Tailwind (le PDF a sa propre table de couleurs). */
const CLASSES = {
  sol: 'fill-secondary-300',
  maison: 'fill-secondary-100 stroke-secondary-300',
  toit: 'fill-secondary-400',
  traitToit: 'stroke-secondary-500',
  appareil: 'fill-secondary-800',
  foyer: 'fill-secondary-700',
  raccord: 'stroke-secondary-800',
  conduit: 'stroke-secondary-500',
  ame: 'stroke-white',
  conduitInox: 'stroke-secondary-500',
  conduitNoir: 'stroke-secondary-900',
  piece: 'fill-secondary-600',
  finitionInox: 'fill-secondary-500',
  finitionNoir: 'fill-secondary-900',
  faitage: 'stroke-secondary-400',
  zoneOk: 'stroke-secondary-600',
  zoneKo: 'stroke-st-alerte',
  mur: 'fill-secondary-300 stroke-secondary-400',
  boisseau: 'fill-secondary-100 stroke-secondary-400',
  tubage: 'stroke-secondary-700',
  legende: 'fill-secondary-500 text-[12px]',
  zoneTexte: 'fill-secondary-900 text-[12.5px] font-semibold',
};

const points = (arr) => arr.map(([x, y]) => `${x},${y}`).join(' ');

function Forme({ f }) {
  const cls = CLASSES[f.ton];
  if (f.type === 'rect') return <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={f.arrondi} className={cls} strokeWidth={f.epaisseur} strokeDasharray={f.pointille} />;
  if (f.type === 'polygon') return <polygon points={points(f.points)} className={cls} />;
  if (f.type === 'polyline') return <polyline points={points(f.points)} fill="none" className={cls} strokeWidth={f.epaisseur} strokeLinejoin={f.jointure} />;
  if (f.type === 'line') return <line x1={f.x1} y1={f.y1} x2={f.x2} y2={f.y2} className={cls} strokeDasharray={f.pointille} strokeWidth={f.epaisseur} />;
  return <text x={f.x} y={f.y} textAnchor={f.ancre} className={cls}>{f.etat ? `${f.etat === 'ok' ? '✓' : '⚠'} ${f.texte}` : f.texte}</text>;
}

function Cote({ c, onFocusChamp }) {
  const go = () => onFocusChamp?.(c.cle);
  return (
    <g role="button" tabIndex={0} aria-label={`Modifier ${c.libelle}`} className="cursor-pointer outline-none [&:focus_rect]:stroke-primary-600 [&:hover_text]:fill-secondary-700" onClick={go} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }}>
      <title>{c.libelle}</title>
      <line x1={c.ligne.x1} y1={c.ligne.y1} x2={c.ligne.x2} y2={c.ligne.y2} className="stroke-secondary-500" strokeWidth={1} />
      {c.ticks.map((t, idx) => <line key={`t${idx}`} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className="stroke-secondary-500" strokeWidth={1} />)}
      <rect x={c.boite.x} y={c.boite.y} width={c.boite.w} height={c.boite.h} rx={3} className="fill-white stroke-transparent" strokeWidth={1.5} />
      <text x={c.texteX} y={c.texteY} textAnchor="middle" className="fill-secondary-900 tabular-nums text-[13px] font-semibold">{c.texte}</text>
    </g>
  );
}

function Repere({ r }) {
  return (
    <g><line x1={r.ligne.x1} y1={r.ligne.y1} x2={r.ligne.x2} y2={r.ligne.y2} className="stroke-secondary-900" strokeWidth={1} />
      <circle cx={r.cx} cy={r.cy} r={r.r} className="fill-white stroke-secondary-700" strokeWidth={1.4} />
      <text x={r.cx} y={r.cy} textAnchor="middle" dominantBaseline="central" className="fill-secondary-900 text-[15px] font-bold">{r.n}</text></g>
  );
}

export default function CoupeCotee({ gabaritCode, geometrie, releve, onFocusChamp }) {
  const scene = useMemo(() => construireScene(gabaritCode, geometrie, releve), [gabaritCode, geometrie, releve]);
  if (!scene) return <p className="p-3 text-sm text-secondary-500">Pas de coupe dessinée pour le gabarit {gabaritCode}.</p>;
  const avant = scene.formes.filter((f) => !f.apresCotes);
  const apres = scene.formes.filter((f) => f.apresCotes);
  return (
    <svg viewBox={`0 0 ${scene.largeur.toFixed(1)} ${scene.hauteur.toFixed(1)}`} role="img" aria-label={scene.titre} className="block w-full h-auto max-h-[78vh]">
      {avant.map((f, n) => <Forme key={n} f={f} />)}
      {scene.cotes.map((c, n) => <Cote key={`${c.cle}-${n}`} c={c} onFocusChamp={onFocusChamp} />)}
      {apres.map((f, n) => <Forme key={`a${n}`} f={f} />)}
      {scene.reperes.map((r) => <Repere key={`rep${r.n}`} r={r} />)}
    </svg>
  );
}
