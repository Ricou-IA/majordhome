// src/apps/artisan/components/devis/metre/pdf/CoupePdf.jsx
// Coupe cotée dans le PDF du plan du conduit — RENDU PUR de la scène (src/lib/fumisterie/scene.js),
// la même que celle de l'écran : mêmes formes, mêmes cotes, mêmes repères. Seules les couleurs et la
// taille du texte changent (le dessin est réduit pour tenir dans la page).
import { Svg, G, Rect, Polygon, Polyline, Line, Circle, Text } from '@react-pdf/renderer';
import { construireScene } from '@/lib/fumisterie/scene.js';
import { texteSurPdf } from '@/lib/fumisterie/planModel.js';

// Palette « pierre chaude » de l'application (tailwind.config.js), cuivre pour les repères.
const P = { s100: '#F0EDE7', s300: '#DDD7CD', s400: '#A39A8E', s500: '#736A5F', s600: '#5E564C', s700: '#443E36', s800: '#2C2823', s900: '#1C1915', p400: '#DE8257', p500: '#D4693C', blanc: '#FFFFFF' };

/** Clé de ton de la scène → { fill, stroke } (même lecture que les classes Tailwind de l'écran). */
const COULEUR = {
  sol: { fill: P.s300 }, maison: { fill: P.s100, stroke: P.s300 }, toit: { fill: P.s400 }, traitToit: { stroke: P.s500 },
  appareil: { fill: P.s800 }, foyer: { fill: P.p400 }, raccord: { stroke: P.s800 }, conduit: { stroke: P.s500 }, ame: { stroke: P.blanc },
  conduitInox: { stroke: P.s500 }, conduitNoir: { stroke: P.s900 }, piece: { fill: P.s600 }, finitionInox: { fill: P.s500 }, finitionNoir: { fill: P.s900 },
  faitage: { stroke: P.s400 }, zoneOk: { stroke: P.s600 }, zoneKo: { stroke: P.p500 }, mur: { fill: P.s300, stroke: P.s400 },
  boisseau: { fill: P.s100, stroke: P.s400 }, tubage: { stroke: P.s700 }, legende: { fill: P.s500 }, zoneTexte: { fill: P.s900 },
};

const pts = (arr) => arr.map(([x, y]) => `${x},${y}`).join(' ');

function Forme({ f }) {
  const c = COULEUR[f.ton] || {};
  if (f.type === 'rect') return <Rect x={f.x} y={f.y} width={f.w} height={f.h} rx={f.arrondi} fill={c.fill || 'none'} stroke={c.stroke} strokeWidth={c.stroke ? (f.epaisseur ?? 1) : 0} strokeDasharray={f.pointille} />;
  if (f.type === 'polygon') return <Polygon points={pts(f.points)} fill={c.fill || 'none'} stroke={c.stroke} strokeWidth={c.stroke ? 1 : 0} />;
  if (f.type === 'polyline') return <Polyline points={pts(f.points)} fill="none" stroke={c.stroke} strokeWidth={f.epaisseur ?? 1} strokeLinejoin={f.jointure} />;
  if (f.type === 'line') return <Line x1={f.x1} y1={f.y1} x2={f.x2} y2={f.y2} stroke={c.stroke} strokeWidth={f.epaisseur ?? 1} strokeDasharray={f.pointille} />;
  const texte = f.etat ? `${f.texte} : ${f.etat === 'ok' ? 'respecté' : 'non respecté'}` : f.texte;
  return <Text x={f.x} y={f.y} textAnchor={f.ancre || 'start'} fill={c.fill} style={{ fontSize: f.taille, fontFamily: f.gras ? 'Helvetica-Bold' : 'Helvetica' }}>{texteSurPdf(texte)}</Text>;
}

/**
 * Coupe d'un métré enregistré, à la taille voulue dans la page.
 * @param {{ gabaritCode:string, geometrie:object, releve:object, largeur:number, hauteur:number, policePt?:number }} p
 */
export function CoupePdf({ gabaritCode, geometrie, releve, largeur, hauteur, policePt = 7 }) {
  const brut = construireScene(gabaritCode, geometrie, releve);
  if (!brut) return null;
  const echelle = Math.min(largeur / brut.largeur, hauteur / brut.hauteur);
  // Le dessin est réduit : la police des cotes est grossie d'autant pour rester lisible une fois imprimée.
  const police = policePt / echelle;
  const s = construireScene(gabaritCode, geometrie, releve, { police });
  const w = s.largeur * echelle; const h = s.hauteur * echelle;
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${s.largeur} ${s.hauteur}`}>
      {s.formes.filter((f) => !f.apresCotes).map((f, n) => <Forme key={n} f={f} />)}
      {s.cotes.map((c, n) => (
        <G key={`c${n}`}>
          <Line x1={c.ligne.x1} y1={c.ligne.y1} x2={c.ligne.x2} y2={c.ligne.y2} stroke={P.s500} strokeWidth={1 / echelle * 0.6} />
          {c.ticks.map((t, i) => <Line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={P.s500} strokeWidth={1 / echelle * 0.6} />)}
          <Rect x={c.boite.x} y={c.boite.y} width={c.boite.w} height={c.boite.h} rx={3} fill={P.blanc} />
          <Text x={c.texteX} y={c.texteY} textAnchor="middle" fill={P.s900} style={{ fontSize: police, fontFamily: 'Helvetica-Bold' }}>{texteSurPdf(c.texte)}</Text>
        </G>
      ))}
      {s.formes.filter((f) => f.apresCotes).map((f, n) => <Forme key={`a${n}`} f={f} />)}
      {s.reperes.map((r) => (
        <G key={`r${r.n}`}>
          <Line x1={r.ligne.x1} y1={r.ligne.y1} x2={r.ligne.x2} y2={r.ligne.y2} stroke={P.s900} strokeWidth={1 / echelle * 0.6} />
          <Circle cx={r.cx} cy={r.cy} r={r.r} fill={P.p400} stroke={P.s900} strokeWidth={1 / echelle * 0.7} />
          <Text x={r.cx} y={r.cy + r.r * 0.42} textAnchor="middle" fill={P.s900} style={{ fontSize: r.r * 1.15, fontFamily: 'Helvetica-Bold' }}>{String(r.n)}</Text>
        </G>
      ))}
    </Svg>
  );
}
