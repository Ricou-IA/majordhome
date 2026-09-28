// src/apps/artisan/components/devis/metre/CoupeCoteeG3.jsx
// Coupe cotée du gabarit G3 (création extérieure en façade) — RENDU PUR de `geometrie` (geometrieG3).
// Appareil à l'intérieur, traversée du mur, té au pied, conduit isolé le long de la façade, toiture et
// faîtage à droite avec la ligne de zone 1. Une cote = <g role="button"> → focus du champ.
import { useMemo } from 'react';

const fmt = (v) => Number(v).toFixed(2).replace('.', ',');
const rad = (d) => (d * Math.PI) / 180;

export default function CoupeCoteeG3({ geometrie: c, releve: i, onFocusChamp }) {
  const scene = useMemo(() => {
    const xMur = Number(i.lHoriz); const ep = Number(i.epMur); const xC = xMur + ep + 0.2; // axe du conduit extérieur
    const tp = Math.tan(rad(Math.max(Number(i.pente), 1)));
    const xr = -Number(i.dFaitage) + xMur; // faîtage (à gauche : la maison est derrière le mur)
    const minX = Math.min(xr, -1.2) - 1.2; const maxX = xC + 2.4; const minY = -0.4; const maxY = Math.max(c.topAct, c.yReq, c.yRidge) + 0.6;
    const sc = Math.min(760 / (maxX - minX), 980 / (maxY - minY));
    return { xMur, ep, xC, tp, xr, minX, maxX, maxY, sc, VW: (maxX - minX) * sc, VH: (maxY - minY) * sc, X: (x) => (x - minX) * sc, Y: (y) => (maxY - y) * sc };
  }, [c, i]);
  const { xMur, ep, xC, tp, xr, minX, maxX, sc, VW, VH, X, Y } = scene;
  const pts = (arr) => arr.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
  const pw = Math.max(6, (Number(i.diametre) >= 180 ? 0.24 : 0.21) * sc);
  const inox = i.finition === 'inox';
  const zoneOK = c.topAct >= c.yReq - 1e-6;
  const yToit = (x) => c.yEgout + Math.max(0, (xMur - x)) * tp; // toit monte vers la gauche jusqu'au faîtage
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
  const aw = 0.62; const hsp = Number(i.hsp1); const yTe = c.yTe;
  const xL = minX + 0.6;
  return (
    <svg viewBox={`0 0 ${VW.toFixed(1)} ${VH.toFixed(1)}`} role="img" aria-label="Coupe du conduit en façade avec cotes" className="block w-full h-auto max-h-[78vh]">
      {/* sol */}
      <rect x={X(minX + 0.2)} y={Y(0)} width={(maxX - minX - 0.4) * sc} height={0.3 * sc} className="fill-secondary-300" />
      {/* intérieur : plafond + mur + toiture */}
      <rect x={X(xL)} y={Y(hsp + 0.25)} width={(xMur - xL) * sc} height={0.25 * sc} className="fill-secondary-300" />
      <rect x={X(xMur)} y={Y(c.yEgout)} width={ep * sc} height={c.yEgout * sc} className="fill-secondary-300 stroke-secondary-400" />
      <polygon points={pts([[xL, yToit(xL)], [xr, yToit(xr)], [xMur + ep, c.yEgout], [xMur + ep, c.yEgout - 0.3], [xL, yToit(xL) - 0.3]])} className="fill-secondary-400" />
      <line x1={X(xr)} y1={Y(c.yRidge)} x2={X(maxX - 0.2)} y2={Y(c.yRidge)} className="stroke-secondary-400" strokeDasharray="4 4" />
      <text x={X(xr) + 8} y={Y(c.yRidge) + 15} className="fill-secondary-500 text-[12px]">Faîtage</text>
      <line x1={X(xC - 0.9)} y1={Y(c.yReq)} x2={X(maxX - 0.2)} y2={Y(c.yReq)} className={zoneOK ? 'stroke-secondary-600' : 'stroke-primary-500'} strokeDasharray="8 5" strokeWidth={2.2} />
      <text x={X(maxX - 0.2)} y={Y(c.yReq) - 7} textAnchor="end" className="fill-secondary-900 text-[12.5px] font-semibold">{(zoneOK ? '✓ ' : '⚠ ') + (c.flat ? `Toit plat : +${fmt(c.reqAbove)} m` : `Faîtage + ${Math.round(c.reqAbove * 100)} cm (zone 1)`)}</text>
      {/* appareil + raccordement intérieur */}
      <rect x={X(-aw / 2)} y={Y(i.hBuse - 0.06)} width={aw * sc} height={(i.hBuse - 0.06) * sc} rx={4} className="fill-secondary-800" />
      <rect x={X(-aw / 2 + 0.1)} y={Y(i.hBuse * 0.62)} width={(aw - 0.2) * sc} height={i.hBuse * 0.3 * sc} rx={2} className="fill-primary-400" />
      <polyline points={pts([[0, i.hBuse - 0.06], [0, yTe], [xMur, yTe]])} fill="none" className="stroke-secondary-800" strokeWidth={Math.max(4, pw * 0.65)} strokeLinejoin="round" />
      {/* traversée + té + conduit extérieur */}
      <line x1={X(xMur)} y1={Y(yTe)} x2={X(xC)} y2={Y(yTe)} className="stroke-secondary-500" strokeWidth={pw} />
      <rect x={X(xC - 0.16)} y={Y(yTe - 0.15)} width={0.32 * sc} height={0.5 * sc} rx={3} className="fill-secondary-600" />
      <line x1={X(xC)} y1={Y(yTe - 0.15)} x2={X(xC)} y2={Y(c.topAct)} className={inox ? 'stroke-secondary-500' : 'stroke-secondary-900'} strokeWidth={pw} />
      <rect x={X(xC - 0.18)} y={Y(c.topAct + 0.12)} width={0.36 * sc} height={0.045 * sc} rx={2} className={inox ? 'fill-secondary-500' : 'fill-secondary-900'} />
      {/* supports muraux indicatifs */}
      {Array.from({ length: Math.max(1, Math.floor(c.Lfac / 2)) }, (_, k) => yTe + 1 + k * 2).filter((y) => y < c.yEgout + 0.2).map((y) => (
        <rect key={y} x={X(xMur + ep)} y={Y(y + 0.04)} width={(xC - xMur - ep) * sc} height={0.08 * sc} className="fill-secondary-600" />
      ))}
      {/* cotes */}
      {cote('buse', 'hBuse', 'Hauteur de buse', -0.75, 0, -0.75, i.hBuse)}
      {cote('trav', 'hTraversee', 'Hauteur de la traversée', -1.55, 0, -1.55, yTe)}
      {cote('lh', 'lHoriz', 'Distance appareil → mur', 0, yTe + 0.3, xMur, yTe + 0.3, true)}
      {cote('mur', 'hMur', 'Hauteur de la façade à l\'égout', xC + 0.75, 0, xC + 0.75, c.yEgout, false, 'r')}
      {cote('sortie', 'hSortie', 'Hauteur au-dessus de l\'égout', xC + 1.45, c.yEgout, xC + 1.45, c.topAct, false, 'r')}
      {i.dFaitage > 0.05 ? cote('faitage', 'dFaitage', 'Distance conduit → faîtage', xr, Math.max(c.topAct, c.yReq) + 0.35, xC, Math.max(c.topAct, c.yReq) + 0.35, true) : null}
      {repere(1, xC, c.topAct + 0.14, xC - 0.9, c.topAct + 0.3)}
      {repere(2, xC, (yTe + c.topAct) / 2, xC - 0.9, (yTe + c.topAct) / 2)}
      {repere(5, xC, yTe, xC + 0.9, yTe - 0.5)}
      {repere(7, xMur + ep / 2, yTe, xMur - 0.9, yTe - 0.6)}
      {repere(8, 0, (i.hBuse + yTe) / 2, 0.8, (i.hBuse + yTe) / 2 - 0.2)}
    </svg>
  );
}
