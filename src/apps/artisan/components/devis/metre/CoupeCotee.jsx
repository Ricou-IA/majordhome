// src/apps/artisan/components/devis/metre/CoupeCotee.jsx
// Coupe cotée du gabarit G1 — RENDU PUR (aucun calcul métier : tout vient de `geometrie`).
// Port de draw() de docs/devis-fumisterie/maquette_metre_ptr30.html. Une cote = <g role="button">
// : clic / Entrée → onFocusChamp(cle) et le formulaire met le champ en édition.
import { useMemo } from 'react';

const fmt = (v) => Number(v).toFixed(2).replace('.', ',');
const rad = (d) => (d * Math.PI) / 180;

export default function CoupeCotee({ geometrie: c, releve: i, onFocusChamp }) {
  const scene = useMemo(() => {
    const tp = Math.tan(rad(Math.max(i.pente, 1)));
    const dec = c.dec; const xr = dec + i.dFaitage;
    const yTop = (x) => c.yRoofTop + (x <= xr ? (x - dec) : (2 * xr - x - dec)) * tp;
    let xL = dec - (c.yRoofTop - i.epToit - c.yC) / tp; xL = Math.max(Math.min(xL, -1.1), -5.5);
    const xR = Math.min(xr + (xr - xL), xr + 6);
    const topY = Math.max(c.topAct, c.yReq, c.yRidge) + 0.55;
    const minX = xL - 3.3; const maxX = Math.max(xR, dec + 1.2) + 2.4; const minY = -0.45; const maxY = topY + 0.25;
    const sc = Math.min(760 / (maxX - minX), 980 / (maxY - minY));
    return { tp, dec, xr, yTop, xL, xR, minX, maxX, maxY, sc, VW: (maxX - minX) * sc, VH: (maxY - minY) * sc,
      X: (x) => (x - minX) * sc, Y: (y) => (maxY - y) * sc };
  }, [c, i]);
  const { dec, xr, yTop, xL, xR, maxX, sc, VW, VH, X, Y } = scene;
  const pts = (arr) => arr.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
  const zoneOK = c.topAct >= c.yReq - 1e-6;
  const inox = i.finition === 'inox';
  const pw = Math.max(6, (i.diametre >= 180 ? 0.24 : 0.21) * sc);
  const cote = (key, cle, label, x1, y1, x2, y2, horizontal = false, side = 'l') => {
    const tx = `${fmt(horizontal ? Math.abs(x2 - x1) : Math.abs(y2 - y1))} m`; const bw = tx.length * 8.2 + 10;
    const mx = horizontal ? (X(x1) + X(x2)) / 2 : (side === 'r' ? X(x1) + 6 + bw / 2 : X(x1) - 6 - bw / 2);
    const my = horizontal ? Y(y1) - 16 : (Y(y1) + Y(y2)) / 2;
    const go = () => onFocusChamp?.(cle);
    const t = 5;
    const ticks = horizontal
      ? [x1, x2].map((x, idx) => (
          <line key={`t${idx}`} x1={X(x) - t} y1={Y(y1) + t} x2={X(x) + t} y2={Y(y1) - t} className="stroke-secondary-500" strokeWidth={1} />
        ))
      : [y1, y2].map((y, idx) => (
          <line key={`t${idx}`} x1={X(x1) - t} y1={Y(y) + t} x2={X(x1) + t} y2={Y(y) - t} className="stroke-secondary-500" strokeWidth={1} />
        ));
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
  const dx1 = xL - 0.55; const dx2 = xL - 1.35; const over = 0.45; const xa = xL - over; const xb = xR + over; const aw = 0.62; const cw = 0.36; const sw = 0.34;
  const slabs = [i.hsp1]; if (i.nbEtages) slabs.push(i.hsp1 + i.epPl + i.hsp2);
  const intPts = i.angle > 0 ? [[0, i.hsp1], [0, c.yDevS], [dec, c.yDevE], [dec, c.yRoofTop]] : [[0, i.hsp1], [0, c.yRoofTop]];
  return (
    <svg viewBox={`0 0 ${VW.toFixed(1)} ${VH.toFixed(1)}`} role="img" aria-label="Coupe du conduit avec cotes" className="block w-full h-auto max-h-[78vh]">
      <rect x={X(xL - 0.6)} y={Y(0)} width={(xR - xL + 1.2) * sc} height={0.35 * sc} className="fill-secondary-300" />
      <polygon points={pts([[xL, 0], [xL, yTop(xL) - i.epToit], [xr, yTop(xr) - i.epToit], [xR, yTop(xR) - i.epToit], [xR, 0]])} className="fill-secondary-100 stroke-secondary-300" />
      {slabs.map((y) => <rect key={y} x={X(xL)} y={Y(y + i.epPl)} width={(xR - xL) * sc} height={i.epPl * sc} className="fill-secondary-300" />)}
      <polygon points={pts([[xa, yTop(xa)], [xr, yTop(xr)], [xb, yTop(xb)], [xb, yTop(xb) - i.epToit], [xr, yTop(xr) - i.epToit], [xa, yTop(xa) - i.epToit]])} className="fill-secondary-400" />
      <polyline points={pts([[xa, yTop(xa)], [xr, yTop(xr)], [xb, yTop(xb)]])} fill="none" className="stroke-secondary-500" strokeWidth={1.2} />
      <rect x={X(-aw / 2)} y={Y(i.hBuse - 0.06)} width={aw * sc} height={(i.hBuse - 0.06) * sc} rx={4} className="fill-secondary-800" />
      <rect x={X(-aw / 2 + 0.1)} y={Y(i.hBuse * 0.62)} width={(aw - 0.2) * sc} height={i.hBuse * 0.3 * sc} rx={2} className="fill-primary-400" />
      <line x1={X(0)} y1={Y(i.hBuse - 0.06)} x2={X(0)} y2={Y(i.hsp1)} className="stroke-secondary-800" strokeWidth={Math.max(4, pw * 0.62)} />
      <polyline points={pts(intPts)} fill="none" className="stroke-secondary-500" strokeWidth={pw} strokeLinejoin="round" />
      <polyline points={pts(intPts)} fill="none" className="stroke-white" strokeWidth={Math.max(1.5, pw * 0.28)} strokeLinejoin="round" />
      <line x1={X(dec)} y1={Y(c.yRoofTop - 0.02)} x2={X(dec)} y2={Y(c.topAct)} className={inox ? 'stroke-secondary-500' : 'stroke-secondary-900'} strokeWidth={pw} />
      <polygon points={pts([[dec - sw, yTop(dec - sw) + 0.03], [dec + sw, yTop(dec + sw) + 0.03], [dec + pw / sc * 0.7, yTop(dec) + 0.28], [dec - pw / sc * 0.7, yTop(dec) + 0.22]])} className="fill-secondary-600" />
      <rect x={X(dec - cw / 2)} y={Y(c.topAct + 0.12)} width={cw * sc} height={0.045 * sc} rx={2} className={inox ? 'fill-secondary-500' : 'fill-secondary-900'} />
      <rect x={X(dec - 0.07)} y={Y(c.topAct + 0.08)} width={0.14 * sc} height={0.08 * sc} className={inox ? 'fill-secondary-500' : 'fill-secondary-900'} />
      <line x1={X(xr - 1.2)} y1={Y(c.yRidge)} x2={X(maxX - 0.2)} y2={Y(c.yRidge)} className="stroke-secondary-400" strokeDasharray="4 4" />
      <text x={X(xr) + 8} y={Y(c.yRidge) + 15} className="fill-secondary-500 text-[12px]">Faîtage</text>
      <line x1={X(dec - 0.9)} y1={Y(c.yReq)} x2={X(maxX - 0.2)} y2={Y(c.yReq)} className={zoneOK ? 'stroke-secondary-600' : 'stroke-primary-500'} strokeDasharray="8 5" strokeWidth={2.2} />
      <text x={X(maxX - 0.2)} y={Y(c.yReq) - 7} textAnchor="end" className="fill-secondary-900 text-[12.5px] font-semibold">{(zoneOK ? '✓ ' : '⚠ ') + (c.flat ? `Toit plat : +${c.reqAbove.toFixed(2).replace('.', ',')} m` : `Faîtage + ${Math.round(c.reqAbove * 100)} cm (zone 1)`)}</text>
      {cote('buse', 'hBuse', 'Hauteur de buse', dx1, 0, dx1, i.hBuse)}
      {cote('sp', 'hBuse', 'Raccordement simple paroi (calculé)', dx1, i.hBuse, dx1, i.hsp1)}
      {cote('hsp1', 'hsp1', 'Hauteur sous plafond', dx2, 0, dx2, i.hsp1)}
      {i.nbEtages ? cote('hsp2', 'hsp2', 'Hauteur étage', dx2, i.hsp1 + i.epPl, dx2, i.hsp1 + i.epPl + i.hsp2) : null}
      {cote('combles', 'hCombles', 'Hauteur combles', dx2, c.yC, dx2, c.yC + i.hCombles)}
      {cote('sortie', 'hSortie', 'Hauteur de sortie au-dessus du toit', Math.max(xR, dec + 0.6) + 0.6, c.yRoofTop, Math.max(xR, dec + 0.6) + 0.6, c.topAct, false, 'r')}
      {i.angle > 0 ? cote('decal', 'decal', 'Décalage du dévoiement', 0, c.yDevS - 0.35, dec, c.yDevS - 0.35, true) : null}
      {i.dFaitage > 0.05 ? cote('faitage', 'dFaitage', 'Distance sortie → faîtage', dec, Math.max(c.topAct, c.yReq) + 0.35, xr, Math.max(c.topAct, c.yReq) + 0.35, true) : null}
      {repere(1, dec - cw / 2, c.topAct + 0.12, dec - 0.85, c.topAct + 0.25)}
      {repere(2, dec, (c.yRoofTop + c.topAct) / 2 + 0.1, dec - 0.85, (c.yRoofTop + c.topAct) / 2 + 0.1)}
      {repere(3, dec - sw * 0.6, yTop(dec - sw * 0.6) + 0.05, dec - 1.05, yTop(dec) - 0.45)}
      {i.angle > 0 ? repere(4, dec / 2, (c.yDevS + c.yDevE) / 2, 0.8 + dec, (c.yDevS + c.yDevE) / 2 - 0.1) : repere(4, 0, (c.yC + c.yRoofTop) / 2, 0.8, (c.yC + c.yRoofTop) / 2)}
      {repere(5, 0, i.hsp1 + i.epPl / 2, 0.9, i.hsp1 + i.epPl / 2 + 0.35)}
      {repere(6, 0, (i.hBuse + i.hsp1) / 2, 0.85, (i.hBuse + i.hsp1) / 2)}
    </svg>
  );
}
