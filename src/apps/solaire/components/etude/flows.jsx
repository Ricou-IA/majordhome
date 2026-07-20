// src/apps/solaire/components/etude/flows.jsx
// Diagrammes de flux d'électricité (type Sankey simplifié) dessinés en primitives
// Svg react-pdf : une source → deux cibles (ou l'inverse avec `reverse`), bandes
// trapézoïdales de hauteur proportionnelle à la part. Palette deutan.
import { Text, Svg, Path, Rect } from '@react-pdf/renderer';
import { C } from './pdfShared';

export const FLOW_W = 531; // largeur utile A4 portrait
const DIAG_H = 118;
const BOX_W = 150;
const BOX_H = 46;

/** Boîte de flux (titre + valeur + part). */
function FlowBox({ x, y, title, value, share, fill, stroke }) {
  return (
    <>
      <Rect x={x} y={y} width={BOX_W} height={BOX_H} rx={4} fill={fill} stroke={stroke} strokeWidth={1} />
      <Text x={x + BOX_W / 2} y={y + 14} textAnchor="middle" style={{ fontSize: 7.5, fontFamily: 'Helvetica-Bold' }} fill={C.noir}>
        {title}
      </Text>
      <Text x={x + BOX_W / 2} y={y + 26} textAnchor="middle" style={{ fontSize: 9, fontFamily: 'Helvetica-Bold' }} fill={C.noir}>
        {value}
      </Text>
      {share ? (
        <Text x={x + BOX_W / 2} y={y + 38} textAnchor="middle" style={{ fontSize: 7 }} fill={C.grisTxt}>
          {share}
        </Text>
      ) : null}
    </>
  );
}

/** Bande trapézoïdale entre deux segments verticaux. */
function FlowBand({ x1, y1a, y1b, x2, y2a, y2b, fill }) {
  return <Path d={`M ${x1} ${y1a} L ${x2} ${y2a} L ${x2} ${y2b} L ${x1} ${y1b} Z`} fill={fill} fillOpacity={0.75} />;
}

/**
 * 1 source → 2 cibles (ou 2 sources → 1 cible avec `reverse`).
 * shares = [part cible haute, part cible basse] (Σ ≤ 1, hauteurs ∝ part).
 */
export function FlowDiagram({ single, duo, shares, colors, reverse }) {
  const W = FLOW_W;
  const singleX = reverse ? W - BOX_W : 0;
  const duoX = reverse ? 0 : W - BOX_W;
  const bandX1 = reverse ? duoX + BOX_W : BOX_W;
  const bandX2 = reverse ? singleX : duoX;
  const singleY = (DIAG_H - BOX_H) / 2;
  const duoY = [2, DIAG_H - BOX_H - 2];
  const usable = 40;
  const h0 = Math.max(5, usable * shares[0]);
  const h1 = Math.max(5, usable * shares[1]);
  const sMid = singleY + BOX_H / 2;
  const seg = [
    { a: sMid - (h0 + h1) / 2, b: sMid - (h0 + h1) / 2 + h0 },
    { a: sMid + (h0 + h1) / 2 - h1, b: sMid + (h0 + h1) / 2 },
  ];
  return (
    <Svg width={W} height={DIAG_H} viewBox={`0 0 ${W} ${DIAG_H}`}>
      {duo.map((box, i) => {
        const duoMid = duoY[i] + BOX_H / 2;
        const hh = Math.max(5, usable * shares[i]) / 2;
        const p1 = reverse
          ? { x1: bandX1, y1a: duoMid - hh, y1b: duoMid + hh, x2: bandX2, y2a: seg[i].a, y2b: seg[i].b }
          : { x1: bandX1, y1a: seg[i].a, y1b: seg[i].b, x2: bandX2, y2a: duoMid - hh, y2b: duoMid + hh };
        return <FlowBand key={box.title} {...p1} fill={colors[i]} />;
      })}
      <FlowBox x={singleX} y={singleY} {...single} fill={C.blanc} stroke={C.gris} />
      {duo.map((box, i) => (
        <FlowBox key={box.title} x={duoX} y={duoY[i]} {...box} fill={C.blanc} stroke={colors[i]} />
      ))}
    </Svg>
  );
}
