// src/apps/thermique/components/etude/PiecesSection.jsx
// Section « déperditions pièce par pièce » (bas de la page bilan). Vignettes proportionnelles à la
// surface (côté = racine de la surface, même lecture qu'à l'écran) colorées par ratio W/m² sur
// l'échelle bleu → ambre du rapportModel (palette deutan R12 — jamais rouge/vert, et l'échelle est
// toujours légendée en chiffres : la couleur ne porte jamais l'information seule).
// Le tableau déborde tout seul sur une page suivante si la maison a beaucoup de pièces ; son
// en-tête est `fixed`, donc répété en tête de chaque page produite.
import { Text, View, StyleSheet } from '@react-pdf/renderer';
import { C, sharedStyles, SectionTitle, fmtInt, fmtDec, watt, m2 } from './pdfShared';

// Échelle des vignettes (points PDF) — homothétie de l'écran, bornée pour rester lisible.
const PT_PAR_RACINE_M2 = 9;
const COTE_MIN = 24;
const COTE_MAX = 58;

const s = StyleSheet.create({
  grille: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 3, border: `0.5px solid ${C.grisClair}`, borderRadius: 4, padding: 6 },
  vignette: { alignItems: 'center', justifyContent: 'center', borderRadius: 2, border: `0.4px solid ${C.slate}`, paddingHorizontal: 2 },
  // maxLines : un nom long ne doit pas pousser la puissance hors de la vignette (« Dégagement »).
  vignetteNom: { fontSize: 5.5, fontFamily: 'Helvetica-Bold', color: C.noir, textAlign: 'center', maxLines: 2, textOverflow: 'ellipsis' },
  vignetteVal: { fontSize: 5, color: C.noir, textAlign: 'center' },
  legende: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  legendeTxt: { fontSize: 6.5, color: C.grisTxt },
  legendeBar: { width: 90, height: 4, borderRadius: 2 },
  legendeStop: { flex: 1, height: 4 },
  tableHead: { flexDirection: 'row', alignItems: 'flex-end', borderBottom: `0.8px solid ${C.grisBar}`, paddingBottom: 3, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, borderBottom: `0.4px solid ${C.grisClair}` },
  foot: { flexDirection: 'row', alignItems: 'center', paddingTop: 4, marginTop: 1, borderTop: `0.8px solid ${C.grisBar}` },
  puce: { width: 5, height: 5, borderRadius: 1, marginRight: 4 },
  cellNom: { flex: 1, fontSize: 7.5 },
  cellNum: { width: 58, fontSize: 7.5, textAlign: 'right' },
  cellNumFort: { width: 58, fontSize: 7.5, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  headNum: { width: 58, textAlign: 'right' },
});

/** Dégradé de l'échelle en 12 bandes (react-pdf n'a pas de linear-gradient). */
function BandeEchelle({ couleurs }) {
  return (
    <View style={[s.legendeBar, { flexDirection: 'row', overflow: 'hidden' }]}>
      {couleurs.map((c, i) => <View key={i} style={[s.legendeStop, { backgroundColor: c }]} />)}
    </View>
  );
}

export function PiecesSection({ rapport, company, echelle }) {
  const { pieces, hypotheses } = rapport;
  const { avecRelance, lignes, totaux } = pieces;

  return (
    <>
      <SectionTitle company={company}>Déperditions par pièce</SectionTitle>

      <View style={s.grille}>
        {lignes.map((p) => {
          const cote = Math.min(COTE_MAX, Math.max(COTE_MIN, Math.sqrt(p.surface) * PT_PAR_RACINE_M2));
          return (
            <View key={p.id} style={[s.vignette, { width: cote, height: cote, backgroundColor: p.couleur }]}>
              <Text style={s.vignetteNom}>{p.nom}</Text>
              <Text style={s.vignetteVal}>{fmtInt(p.total)} W</Text>
            </View>
          );
        })}
      </View>

      <View style={s.legende}>
        <Text style={s.legendeTxt}>{fmtInt(pieces.ratioMin)} W/m²</Text>
        <BandeEchelle couleurs={echelle} />
        <Text style={s.legendeTxt}>{fmtInt(pieces.ratioMax)} W/m²</Text>
        <Text style={[s.legendeTxt, { flex: 1 }]}>
          Taille de la vignette proportionnelle à la surface au sol ; couleur = intensité des
          déperditions rapportée au m².
        </Text>
      </View>

      <View style={s.tableHead} fixed>
        <Text style={[sharedStyles.th, { flex: 1 }]}>Pièce</Text>
        <Text style={[sharedStyles.th, s.headNum]}>Surface</Text>
        <Text style={[sharedStyles.th, s.headNum]}>Transmission</Text>
        <Text style={[sharedStyles.th, s.headNum]}>Ventilation</Text>
        {avecRelance ? <Text style={[sharedStyles.th, s.headNum]}>Relance</Text> : null}
        <Text style={[sharedStyles.th, s.headNum]}>Total</Text>
        <Text style={[sharedStyles.th, s.headNum]}>Puiss. émetteur</Text>
      </View>

      {lignes.map((p) => (
        <View key={p.id} style={s.row} wrap={false}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
            <View style={[s.puce, { backgroundColor: p.couleur }]} />
            <Text style={s.cellNom}>{p.nom}</Text>
          </View>
          <Text style={s.cellNum}>{m2(p.surface)}</Text>
          <Text style={s.cellNum}>{watt(p.transmission)}</Text>
          <Text style={s.cellNum}>{watt(p.ventilation)}</Text>
          {avecRelance ? <Text style={s.cellNum}>{watt(p.relance)}</Text> : null}
          <Text style={s.cellNumFort}>{watt(p.total)}</Text>
          <Text style={s.cellNumFort}>{watt(p.emetteur)}</Text>
        </View>
      ))}

      <View style={s.foot}>
        <Text style={[s.cellNom, { fontFamily: 'Helvetica-Bold' }]}>Total</Text>
        <Text style={s.cellNumFort}>{m2(totaux.surface)}</Text>
        <Text style={s.cellNum} />
        <Text style={s.cellNum} />
        {avecRelance ? <Text style={s.cellNum} /> : null}
        <Text style={s.cellNumFort}>{watt(totaux.total)}</Text>
        <Text style={s.cellNumFort}>{watt(totaux.emetteur)}</Text>
      </View>

      <Text style={{ fontSize: 6.5, color: C.grisTxt, marginTop: 6 }}>
        Puissance émetteur = déperditions de la pièce × {fmtDec(hypotheses.foisonnement, 2)}
        {' '}(coefficient de foisonnement retenu pour cette étude). C’est la valeur à retenir pour
        choisir radiateurs, ventilo-convecteurs ou boucles de plancher chauffant.
      </Text>
    </>
  );
}
