// src/apps/artisan/components/devis/metre/CoupeCotee.jsx
// Coupe cotée d'un métré, tous gabarits — RENDU PUR de la scène (src/lib/fumisterie/scene.js), qui
// est aussi celle du plan annexé au devis : écran et PDF dessinent la même chose. Le SVG ne dessine que les formes
// et les traits de cote ; la valeur d'une cote est un VRAI bouton HTML posé par-dessus (recette du 2026-11-28 : texte
// SVG d'environ 8 px à l'écran, et un <svg role="img"> masquait ses boutons aux lecteurs d'écran). Clic / Entrée →
// onFocusChamp(cle) : le champ du relevé prend la main. Cible de 44 px, texte de 14 px.
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

/** Trait d'une cote (dessin seulement : la valeur est un bouton HTML, voir ValeurCote). */
function TraitCote({ c }) {
  return (
    <g aria-hidden="true">
      <line x1={c.ligne.x1} y1={c.ligne.y1} x2={c.ligne.x2} y2={c.ligne.y2} className="stroke-secondary-500" strokeWidth={1} />
      {c.ticks.map((t, idx) => <line key={`t${idx}`} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className="stroke-secondary-500" strokeWidth={1} />)}
    </g>
  );
}

/** Valeur d'une cote, posée en pourcentage de la scène (même place que la boîte de la scène, à toute largeur). */
function ValeurCote({ c, scene, onFocusChamp }) {
  const left = ((c.boite.x + c.boite.w / 2) / scene.largeur) * 100;
  const top = ((c.boite.y + c.boite.h / 2) / scene.hauteur) * 100;
  return (
    <button type="button" onClick={() => onFocusChamp?.(c.cle)} aria-label={`Modifier ${c.libelle}, ${c.texte}`} title={c.libelle}
      style={{ left: `${left}%`, top: `${top}%` }}
      className="group absolute -translate-x-1/2 -translate-y-1/2 grid place-items-center min-w-11 min-h-11 rounded-lg focus-visible:outline-none">
      <span className="px-1.5 py-0.5 rounded-md bg-white/95 border border-secondary-200 text-sm font-semibold text-secondary-900 tabular-nums whitespace-nowrap shadow-xs group-hover:border-secondary-400 group-focus-visible:shadow-ring">{c.texte}</span>
    </button>
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
  // Le cadre garde les proportions de la scène et tient dans 78 % de la hauteur d'écran : les boutons posés en
  // pourcentage tombent exactement sur leurs traits.
  const ratio = scene.largeur / scene.hauteur;
  return (
    <div role="group" aria-label={scene.titre} className="relative mx-auto" style={{ width: '100%', maxWidth: `calc(78vh * ${ratio.toFixed(4)})`, aspectRatio: `${scene.largeur.toFixed(1)} / ${scene.hauteur.toFixed(1)}` }}>
      <svg viewBox={`0 0 ${scene.largeur.toFixed(1)} ${scene.hauteur.toFixed(1)}`} aria-hidden="true" className="absolute inset-0 block w-full h-full">
        {avant.map((f, n) => <Forme key={n} f={f} />)}
        {scene.cotes.map((c, n) => <TraitCote key={`${c.cle}-${n}`} c={c} />)}
        {apres.map((f, n) => <Forme key={`a${n}`} f={f} />)}
        {scene.reperes.map((r) => <Repere key={`rep${r.n}`} r={r} />)}
      </svg>
      {scene.cotes.map((c, n) => <ValeurCote key={`v-${c.cle}-${n}`} c={c} scene={scene} onFocusChamp={onFocusChamp} />)}
    </div>
  );
}
