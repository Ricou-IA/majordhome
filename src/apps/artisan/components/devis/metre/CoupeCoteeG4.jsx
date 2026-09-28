// src/apps/artisan/components/devis/metre/CoupeCoteeG4.jsx
// Coupe cotée du gabarit G4 (tubage d'un conduit existant) — RENDU PUR : tout vient de `geometrie`
// (geometrieG4) et du relevé. Boisseau existant, souche, flexible ou tuyaux rigides, raccordement
// par le plafond (RDE + plaque) ou par le mur (piquage). Une cote = <g role="button"> → focus du champ.
import { useMemo } from 'react';

const fmt = (v) => Number(v).toFixed(2).replace('.', ',');

export default function CoupeCoteeG4({ geometrie: c, releve: i, onFocusChamp }) {
  const scene = useMemo(() => {
    const mur = c.mur;
    const xB = mur ? Math.max(0.9, Number(i.lHoriz) + 0.45) : 0; // axe du boisseau
    const bw = 0.5; // largeur dessinée du boisseau
    const minX = -2.6; const maxX = xB + bw + 1.6; const minY = -0.4; const maxY = c.ySouche + 0.9;
    const sc = Math.min(760 / (maxX - minX), 980 / (maxY - minY));
    return { mur, xB, bw, minX, maxX, maxY, sc, VW: (maxX - minX) * sc, VH: (maxY - minY) * sc, X: (x) => (x - minX) * sc, Y: (y) => (maxY - y) * sc };
  }, [c, i]);
  const { mur, xB, bw, minX, sc, VW, VH, X, Y } = scene;
  const pts = (arr) => arr.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
  const pw = Math.max(6, (Number(i.diametre) >= 150 ? 0.2 : 0.15) * sc);
  const yEntree = c.yEntree; const yS = c.ySouche;
  const cote = (key, cle, label, x1, y1, x2, y2, horizontal = false, side = 'l') => {
    const tx = `${fmt(horizontal ? Math.abs(x2 - x1) : Math.abs(y2 - y1))} m`; const bwT = tx.length * 8.2 + 10;
    const mx = horizontal ? (X(x1) + X(x2)) / 2 : (side === 'r' ? X(x1) + 6 + bwT / 2 : X(x1) - 6 - bwT / 2);
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
        <rect x={mx - bwT / 2} y={my - 11} width={bwT} height={22} rx={3} className="fill-white stroke-transparent" strokeWidth={1.5} />
        <text x={mx} y={my + 4.5} textAnchor="middle" className="fill-secondary-900 font-mono text-[13px] font-semibold">{tx}</text>
      </g>
    );
  };
  const repere = (n, x, y, lx, ly) => (
    <g key={`rep${n}`}><line x1={X(x)} y1={Y(y)} x2={X(lx)} y2={Y(ly)} className="stroke-secondary-900" strokeWidth={1} />
      <circle cx={X(lx)} cy={Y(ly)} r={12} className="fill-primary-400 stroke-secondary-900" strokeWidth={1.2} />
      <text x={X(lx)} y={Y(ly)} textAnchor="middle" dominantBaseline="central" className="fill-secondary-900 text-[15px] font-bold">{n}</text></g>
  );
  const aw = 0.62; const hsp = Number(i.hsp1); const yToit = Math.min(yS - 0.6, hsp + 2.2); // trait de toiture indicatif
  // Tracé du conduit de fumée : appareil → (vertical) → entrée → boisseau → souche
  const axeRaccord = mur ? [[0, i.hBuse - 0.06], [0, yEntree], [xB, yEntree]] : [[0, i.hBuse - 0.06], [0, yEntree]];
  const flexPts = [];
  if (!c.rigide) { for (let y = yEntree; y <= yS + 0.15; y += 0.25) flexPts.push([xB + (Math.round(y * 4) % 2 ? 0.035 : -0.035), y]); }
  const dx1 = -0.75; const dx2 = -1.55; const dxB = xB + bw / 2 + 0.55;
  return (
    <svg viewBox={`0 0 ${VW.toFixed(1)} ${VH.toFixed(1)}`} role="img" aria-label="Coupe du tubage avec cotes" className="block w-full h-auto max-h-[78vh]">
      {/* sol, plafond, mur de fond */}
      <rect x={X(minX + 0.2)} y={Y(0)} width={(xB + bw + 1.2 - minX - 0.2) * sc} height={0.3 * sc} className="fill-secondary-300" />
      <rect x={X(minX + 0.2)} y={Y(hsp + 0.25)} width={(xB - bw / 2 - minX - 0.2) * sc} height={0.25 * sc} className="fill-secondary-300" />
      <rect x={X(minX + 0.2)} y={Y(yToit)} width={(xB - bw / 2 - minX - 0.2) * sc} height={0.06 * sc} className="fill-secondary-400" />
      <text x={X(minX + 0.3)} y={Y(yToit) - 6} className="fill-secondary-500 text-[12px]">Toiture (indicative)</text>
      {/* boisseau existant */}
      <rect x={X(xB - bw / 2)} y={Y(yS)} width={bw * sc} height={yS * sc} className="fill-secondary-100 stroke-secondary-400" strokeWidth={1.5} strokeDasharray="6 4" />
      <text x={X(xB)} y={Y(yToit + 0.35)} textAnchor="middle" className="fill-secondary-500 text-[12px]">Conduit existant</text>
      {/* souche : kit de couronnement + chapeau */}
      <rect x={X(xB - bw / 2 - 0.08)} y={Y(yS + 0.05)} width={(bw + 0.16) * sc} height={0.05 * sc} className="fill-secondary-600" />
      <rect x={X(xB - 0.2)} y={Y(yS + 0.32)} width={0.4 * sc} height={0.05 * sc} rx={2} className="fill-secondary-900" />
      <rect x={X(xB - 0.06)} y={Y(yS + 0.27)} width={0.12 * sc} height={0.22 * sc} className="fill-secondary-900" />
      {/* appareil */}
      <rect x={X(-aw / 2)} y={Y(i.hBuse - 0.06)} width={aw * sc} height={(i.hBuse - 0.06) * sc} rx={4} className="fill-secondary-800" />
      <rect x={X(-aw / 2 + 0.1)} y={Y(i.hBuse * 0.62)} width={(aw - 0.2) * sc} height={i.hBuse * 0.3 * sc} rx={2} className="fill-primary-400" />
      {/* raccordement simple paroi */}
      <polyline points={pts(axeRaccord)} fill="none" className="stroke-secondary-800" strokeWidth={Math.max(4, pw * 0.7)} strokeLinejoin="round" />
      {/* tubage dans le boisseau */}
      {c.rigide
        ? <line x1={X(xB)} y1={Y(yEntree)} x2={X(xB)} y2={Y(yS + 0.15)} className="stroke-secondary-700" strokeWidth={pw} />
        : <polyline points={pts(flexPts)} fill="none" className="stroke-secondary-700" strokeWidth={pw} strokeLinejoin="round" />}
      {/* entrée : plaque ventilée (plafond) ou piquage (mur) */}
      {mur
        ? <rect x={X(xB - bw / 2 - 0.12)} y={Y(yEntree + 0.16)} width={0.12 * sc} height={0.32 * sc} className="fill-secondary-600" />
        : <rect x={X(xB - 0.3)} y={Y(hsp + 0.03)} width={0.6 * sc} height={0.05 * sc} className="fill-secondary-600" />}
      {/* cotes */}
      {cote('buse', 'hBuse', 'Hauteur de buse', dx1, 0, dx1, i.hBuse)}
      {cote('hsp1', 'hsp1', 'Hauteur sous plafond', dx2, 0, dx2, hsp)}
      {mur ? cote('hEntree', 'hEntree', 'Hauteur du piquage', dx1, i.hBuse, dx1, yEntree) : null}
      {mur ? cote('lHoriz', 'lHoriz', 'Longueur horizontale', 0, yEntree + 0.3, xB - bw / 2, yEntree + 0.3, true) : null}
      {cote('conduit', 'hConduit', 'Hauteur du conduit existant', dxB, yEntree, dxB, yS, false, 'r')}
      {repere(1, xB + 0.2, yS + 0.3, xB - 0.9, yS + 0.55)}
      {repere(2, xB + bw / 2 + 0.05, yS + 0.02, xB - 0.9, yS + 0.05)}
      {repere(3, xB, (yEntree + yS) / 2, xB - 0.9, (yEntree + yS) / 2)}
      {mur ? repere(4, xB - bw / 2 - 0.06, yEntree, xB - 0.9, yEntree - 0.5) : repere(4, xB - 0.3, hsp + 0.05, xB - 0.9, hsp - 0.4)}
      {repere(5, 0, (i.hBuse + yEntree) / 2, 0.75, (i.hBuse + yEntree) / 2 - 0.2)}
    </svg>
  );
}
