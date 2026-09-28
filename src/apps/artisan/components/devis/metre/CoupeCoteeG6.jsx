// src/apps/artisan/components/devis/metre/CoupeCoteeG6.jsx
// Coupe cotée du gabarit G6 (sortie horizontale en façade, ventouse) — RENDU PUR de `geometrie` (geometrieG6).
import { useMemo } from 'react';

const fmt = (v) => Number(v).toFixed(2).replace('.', ',');

export default function CoupeCoteeG6({ geometrie: c, releve: i, onFocusChamp }) {
  const scene = useMemo(() => {
    const xMur = Number(i.lHoriz); const ep = Number(i.epMur);
    const minX = -2.2; const maxX = xMur + ep + 1.6; const minY = -0.4; const maxY = Math.max(c.yCoude + 1.2, 3);
    const sc = Math.min(760 / (maxX - minX), 620 / (maxY - minY));
    return { xMur, ep, minX, maxX, sc, VW: (maxX - minX) * sc, VH: (maxY - minY) * sc, X: (x) => (x - minX) * sc, Y: (y) => (maxY - y) * sc };
  }, [c, i]);
  const { xMur, ep, minX, maxX, sc, VW, VH, X, Y } = scene;
  const pts = (arr) => arr.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
  const pw = Math.max(6, 0.18 * sc);
  const cote = (key, cle, label, x1, y1, x2, y2, horizontal = false, side = 'l') => {
    const tx = `${fmt(horizontal ? Math.abs(x2 - x1) : Math.abs(y2 - y1))} m`; const bw = tx.length * 8.2 + 10;
    const mx = horizontal ? (X(x1) + X(x2)) / 2 : (side === 'r' ? X(x1) + 6 + bw / 2 : X(x1) - 6 - bw / 2);
    const my = horizontal ? Y(y1) - 16 : (Y(y1) + Y(y2)) / 2;
    const go = () => onFocusChamp?.(cle);
    const t = 5;
    const ticks = horizontal
      ? [x1, x2].map((x, idx) => <line key={`t${idx}`} x1={X(x) - t} y1={Y(y1) + t} x2={X(x) + t} y2={Y(y1) - t} className="stroke-secondary-500" strokeWidth={1} />)
      : [y1, y2].map((y, idx) => <line key={`t${idx}`} x1={X(x1) - t} y1={Y(y) + t} x2={X(x1) + t} y2={Y(y) - t} className="stroke-secondary-500" strokeWidth={1} />);
    return (
      <g key={key} role="button" tabIndex={0} aria-label={`Modifier ${label}`} className="cursor-pointer outline-none [&:focus_rect]:stroke-primary-500 [&:hover_text]:fill-secondary-700" onClick={go} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }}>
        <title>{label}</title>
        <line x1={X(x1)} y1={Y(y1)} x2={X(x2)} y2={Y(y2)} className="stroke-secondary-500" strokeWidth={1} />
        {ticks}
        <rect x={mx - bw / 2} y={my - 11} width={bw} height={22} rx={3} className="fill-white stroke-transparent" strokeWidth={1.5} />
        <text x={mx} y={my + 4.5} textAnchor="middle" className="fill-secondary-900 font-mono text-[13px] font-semibold">{tx}</text>
      </g>
    );
  };
  const repere = (n, x, y, lx, ly) => (
    <g key={`rep${n}`}><line x1={X(x)} y1={Y(y)} x2={X(lx)} y2={Y(ly)} className="stroke-secondary-900" strokeWidth={1} />
      <circle cx={X(lx)} cy={Y(ly)} r={12} className="fill-primary-400 stroke-secondary-900" strokeWidth={1.2} />
      <text x={X(lx)} y={Y(ly)} textAnchor="middle" dominantBaseline="central" className="fill-secondary-900 text-[15px] font-bold">{n}</text></g>
  );
  const aw = 0.62; const yS = c.yCoude;
  return (
    <svg viewBox={`0 0 ${VW.toFixed(1)} ${VH.toFixed(1)}`} role="img" aria-label="Coupe de la sortie en façade avec cotes" className="block w-full h-auto max-h-[78vh]">
      <rect x={X(minX + 0.2)} y={Y(0)} width={(maxX - minX - 0.4) * sc} height={0.3 * sc} className="fill-secondary-300" />
      <rect x={X(xMur)} y={Y(yS + 1.2)} width={ep * sc} height={(yS + 1.2) * sc} className="fill-secondary-300 stroke-secondary-400" />
      <text x={X(xMur + ep) + 8} y={Y(yS + 1.0)} className="fill-secondary-500 text-[12px]">Extérieur</text>
      {/* appareil */}
      <rect x={X(-aw / 2)} y={Y(i.hBuse - 0.06)} width={aw * sc} height={(i.hBuse - 0.06) * sc} rx={4} className="fill-secondary-800" />
      <rect x={X(-aw / 2 + 0.1)} y={Y(i.hBuse * 0.62)} width={(aw - 0.2) * sc} height={i.hBuse * 0.3 * sc} rx={2} className="fill-primary-400" />
      {/* conduit concentrique : vertical, coude, horizontal, traversée, terminal */}
      <polyline points={pts([[0, i.hBuse - 0.06], [0, yS], [xMur + ep + 0.35, yS]])} fill="none" className="stroke-secondary-500" strokeWidth={pw} strokeLinejoin="round" />
      <polyline points={pts([[0, i.hBuse - 0.06], [0, yS], [xMur + ep + 0.35, yS]])} fill="none" className="stroke-white" strokeWidth={Math.max(1.5, pw * 0.3)} strokeLinejoin="round" />
      <rect x={X(xMur + ep + 0.3)} y={Y(yS + 0.14)} width={0.12 * sc} height={0.28 * sc} rx={2} className="fill-secondary-900" />
      {cote('buse', 'hBuse', 'Hauteur de buse', -0.75, 0, -0.75, i.hBuse)}
      {cote('sortie', 'hSortie', 'Hauteur de l\'axe de sortie', -1.55, 0, -1.55, yS)}
      {cote('lh', 'lHoriz', 'Longueur horizontale', 0, yS + 0.3, xMur, yS + 0.3, true)}
      {cote('ep', 'epMur', 'Épaisseur du mur', xMur, yS - 0.35, xMur + ep, yS - 0.35, true)}
      {repere(1, xMur + ep + 0.36, yS, xMur + ep + 0.36, yS + 0.7)}
      {repere(2, xMur / 2, yS, xMur / 2, yS - 0.7)}
      {repere(3, 0, yS, -0.6, yS + 0.5)}
      {repere(4, 0, (i.hBuse + yS) / 2, 0.7, (i.hBuse + yS) / 2)}
    </svg>
  );
}
