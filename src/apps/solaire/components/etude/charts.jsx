// src/apps/solaire/components/etude/charts.jsx
// Graphiques de l'étude PDF redessinés en primitives @react-pdf/renderer (aucune
// dépendance recharts, aucune capture d'écran). Palette deutan : jaune = solaire
// autoconsommé, gris = surplus perdu, bleus = consommation / réseau.
import { Svg, Rect, Line, Path, Polyline, G, Text } from '@react-pdf/renderer';
import { C, fmtInt, numStr } from './pdfShared';

/** Arrondit une valeur max à un plafond « rond » pour l'axe Y. */
function niceMax(v) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/** Grille horizontale + libellés d'axe Y (ligne 0 = axe plein). */
function YGrid({ x0, x1, y0, plotH, max, ticks = 4, yFmt }) {
  const els = [];
  for (let i = 0; i <= ticks; i++) {
    const val = (max / ticks) * i;
    const y = y0 + plotH - (val / max) * plotH;
    els.push(<Line key={`g${i}`} x1={x0} y1={y} x2={x1} y2={y} stroke={i === 0 ? C.grisBar : C.grisClair} strokeWidth={i === 0 ? 1 : 0.5} />);
    els.push(
      <Text key={`t${i}`} x={x0 - 4} y={y + 2} textAnchor="end" style={{ fontSize: 5.5 }} fill={C.grisTxt}>
        {yFmt(val)}
      </Text>,
    );
  }
  return <>{els}</>;
}

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

/**
 * Production mensuelle vs consommation. Barre production = autoconsommée (jaune)
 * empilée sous surplus (gris) ; barre consommation (bleu foncé) à côté.
 */
export function MonthlyProdConsoChart({ model, width, height = 150 }) {
  const { autoconso, surplus, prod } = model.active;
  const conso = model.consoMonthly;
  const max = niceMax(Math.max(...prod, ...conso, 1));
  const PADL = 34; const PADR = 6; const PADT = 8; const PADB = 14;
  const plotW = width - PADL - PADR; const plotH = height - PADT - PADB;
  const y0 = PADT; const baseY = y0 + plotH;
  const groupW = plotW / 12;
  const barW = Math.min(9, groupW / 2 - 1.5);
  const h = (v) => (v / max) * plotH;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <YGrid x0={PADL} x1={width - PADR} y0={y0} plotH={plotH} max={max} yFmt={(v) => fmtInt(v)} />
      {MONTHS.map((label, i) => {
        const gx = PADL + groupW * i + groupW / 2;
        const xA = gx - barW - 1; const xB = gx + 1;
        const hA = h(autoconso[i]); const hS = h(surplus[i]); const hC = h(conso[i]);
        return (
          <G key={`grp${i}`}>
            <Rect x={xA} y={baseY - hA} width={barW} height={hA} fill={C.jaune} />
            <Rect x={xA} y={baseY - hA - hS} width={barW} height={hS} fill={C.grisBar} />
            <Rect x={xB} y={baseY - hC} width={barW} height={hC} fill={C.bleuF} />
            <Text x={gx} y={baseY + 9} textAnchor="middle" style={{ fontSize: 5.5 }} fill={C.grisTxt}>{label}</Text>
          </G>
        );
      })}
    </Svg>
  );
}

/**
 * Projection du coût annuel d'électricité sur l'horizon : sans installation (gris,
 * facture inflatée) vs avec (bleu). Deux barres fines par année.
 */
export function CostProjectionChart({ costSeries, width, height = 150 }) {
  const max = niceMax(Math.max(...costSeries.map((r) => r.costWithout), 1));
  const PADL = 38; const PADR = 6; const PADT = 8; const PADB = 14;
  const plotW = width - PADL - PADR; const plotH = height - PADT - PADB;
  const y0 = PADT; const baseY = y0 + plotH;
  const n = costSeries.length;
  const groupW = plotW / n;
  const barW = Math.max(1.5, Math.min(6, groupW / 2 - 0.6));
  const h = (v) => (v / max) * plotH;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <YGrid x0={PADL} x1={width - PADR} y0={y0} plotH={plotH} max={max} yFmt={(v) => `${fmtInt(v)} €`} />
      {costSeries.map((r, i) => {
        const gx = PADL + groupW * i + groupW / 2;
        const xA = gx - barW - 0.4; const xB = gx + 0.4;
        const hW = h(r.costWithout); const hA = h(r.costWith);
        const showLabel = i === 0 || (i + 1) % 5 === 0;
        return (
          <G key={`y${i}`}>
            <Rect x={xA} y={baseY - hW} width={barW} height={hW} fill={C.grisBar} />
            <Rect x={xB} y={baseY - hA} width={barW} height={hA} fill={C.bleuM} />
            {showLabel ? (
              <Text x={gx} y={baseY + 9} textAnchor="middle" style={{ fontSize: 5.5 }} fill={C.grisTxt}>{`An ${r.year}`}</Text>
            ) : null}
          </G>
        );
      })}
    </Svg>
  );
}

const CASCADE_SHORT = {
  constat: 'Constat', pilotage_ecs: 'Pilotage ECS', ve: 'VE', pool: 'Piscine', clim: 'Clim', battery: 'Batterie',
};

/**
 * Cascade « Cible » : barres = taux d'autoconsommation, courbe = couverture des
 * besoins, sur les étapes activées (constat → leviers → batterie).
 */
export function CascadeChart({ cascade, width, height = 150 }) {
  const PADL = 30; const PADR = 6; const PADT = 8; const PADB = 14;
  const plotW = width - PADL - PADR; const plotH = height - PADT - PADB;
  const y0 = PADT; const baseY = y0 + plotH;
  const n = cascade.length;
  const groupW = plotW / n;
  const barW = Math.min(28, groupW * 0.5);
  const yOf = (pct) => baseY - (pct / 100) * plotH; // pct 0..100
  const centers = cascade.map((_, i) => PADL + groupW * i + groupW / 2);
  const linePts = cascade.map((r, i) => `${centers[i]},${yOf(r.autoproductionRate * 100)}`).join(' ');
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <YGrid x0={PADL} x1={width - PADR} y0={y0} plotH={plotH} max={100} yFmt={(v) => `${Math.round(v)}%`} />
      {cascade.map((r, i) => {
        const hB = (r.autoconsoRate * 100 / 100) * plotH;
        return (
          <G key={`c${i}`}>
            <Rect x={centers[i] - barW / 2} y={baseY - hB} width={barW} height={hB} fill={C.jaune} />
            <Text x={centers[i]} y={baseY + 9} textAnchor="middle" style={{ fontSize: 5.5 }} fill={C.grisTxt}>
              {CASCADE_SHORT[r.key] || r.key}
            </Text>
          </G>
        );
      })}
      <Polyline points={linePts} fill="none" stroke={C.bleuM} strokeWidth={1.4} />
      {cascade.map((r, i) => (
        <Rect key={`d${i}`} x={centers[i] - 1.4} y={yOf(r.autoproductionRate * 100) - 1.4} width={2.8} height={2.8} fill={C.bleuM} />
      ))}
    </Svg>
  );
}

/**
 * Courbe de charge journée-type (24 h) : aire de production solaire + consommation
 * actuelle (pointillé gris) vs optimisée (bleu) — la conso glisse sous la cloche.
 */
export function DayTypeChart({ dayCurves, width, height = 150 }) {
  const { prod, consoBaseline, conso } = dayCurves;
  const max = niceMax(Math.max(...prod, ...consoBaseline, ...conso, 0.5));
  const PADL = 30; const PADR = 6; const PADT = 8; const PADB = 14;
  const plotW = width - PADL - PADR; const plotH = height - PADT - PADB;
  const y0 = PADT; const baseY = y0 + plotH;
  const xOf = (hIdx) => PADL + (hIdx / 23) * plotW;
  const yOf = (v) => baseY - (v / max) * plotH;
  const pts = (arr) => arr.map((v, i) => `${xOf(i)},${yOf(v)}`).join(' ');
  const areaPath = `M ${xOf(0)} ${baseY} ${prod.map((v, i) => `L ${xOf(i)} ${yOf(v)}`).join(' ')} L ${xOf(23)} ${baseY} Z`;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <YGrid x0={PADL} x1={width - PADR} y0={y0} plotH={plotH} max={max} yFmt={(v) => numStr(Math.round(v * 10) / 10)} />
      <Path d={areaPath} fill={C.jaune} fillOpacity={0.35} />
      <Polyline points={pts(consoBaseline)} fill="none" stroke={C.gris} strokeWidth={1} strokeDasharray="3 2" />
      <Polyline points={pts(conso)} fill="none" stroke={C.bleuM} strokeWidth={1.6} />
      {[0, 6, 12, 18, 23].map((hIdx) => (
        <Text key={`h${hIdx}`} x={xOf(hIdx)} y={baseY + 9} textAnchor="middle" style={{ fontSize: 5.5 }} fill={C.grisTxt}>{`${hIdx}h`}</Text>
      ))}
    </Svg>
  );
}
