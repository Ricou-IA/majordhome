// src/apps/solaire/components/etude/OptimisationPage.jsx
// Page « Optimiser votre autoconsommation » — reflète l'état FIGÉ des leviers de la
// démo terrain (buildOptimModel). Cascade « Cible » (constat → leviers → batterie)
// + courbe journée-type (la conso glisse sous la cloche solaire). Le surplus finance
// de l'autoconsommation ou du confort, jamais d'euros.
import { Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { C, fmtInt, kwh, pct, CompanyHeader, Footer, sharedStyles } from './pdfShared';
import { CascadeChart, DayTypeChart } from './charts';

const CHART_W = 531;

const s = StyleSheet.create({
  intro: { fontSize: 7.5, color: C.grisTxt, lineHeight: 1.4, marginBottom: 4 },
  cibleBox: { flexDirection: 'row', gap: 8, marginTop: 2, marginBottom: 4 },
  cibleCard: { flex: 1, borderRadius: 4, border: `1.5px solid ${C.bleuM}`, backgroundColor: C.bleuPale, padding: 8 },
  cibleLabel: { fontSize: 6.5, color: C.grisTxt },
  cibleValue: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.bleuF, marginTop: 2 },
  cibleHint: { fontSize: 6.5, color: C.grisTxt, marginTop: 1 },
  tHead: { flexDirection: 'row', backgroundColor: C.bleuF, paddingVertical: 3, paddingHorizontal: 4, borderRadius: 2, marginTop: 4 },
  tHeadCell: { color: C.blanc, fontSize: 6.5, fontFamily: 'Helvetica-Bold' },
  tRow: { flexDirection: 'row', paddingVertical: 2, paddingHorizontal: 4, borderBottom: `0.5px solid ${C.grisClair}` },
  tCell: { fontSize: 6.8 },
  cStep: { width: '40%' },
  cNum: { width: '20%', textAlign: 'right' },
  legendRow: { flexDirection: 'row', gap: 10, marginTop: 5, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  legendSwatch: { width: 7, height: 7, borderRadius: 1 },
  legendText: { fontSize: 6.5, color: C.grisTxt },
  noteBox: { backgroundColor: C.grisClair, borderRadius: 4, padding: 8, marginTop: 10 },
  noteText: { fontSize: 6.8, color: C.grisTxt, lineHeight: 1.4 },
});

export function OptimisationPage({ autoconso, company }) {
  const { cascade } = autoconso;
  const start = cascade[0];
  const target = cascade[cascade.length - 1];
  const hasBattery = target.key === 'battery';

  return (
    <Page size="A4" style={sharedStyles.page}>
      <CompanyHeader company={company} />

      <Text style={sharedStyles.sectionTitle}>Optimiser votre autoconsommation</Text>
      <Text style={s.intro}>
        Le taux d'autoconsommation n'est pas figé : en calant les usages sous le soleil (ballon d'eau chaude
        piloté, recharge du véhicule en journée, confort financé par le surplus{hasBattery ? ', stockage batterie' : ''}),
        on augmente la part de solaire réellement consommée. Voici la cible retenue avec vous.
      </Text>

      <View style={s.cibleBox}>
        <View style={s.cibleCard}>
          <Text style={s.cibleLabel}>Autoconsommation (cible)</Text>
          <Text style={s.cibleValue}>{pct(target.autoconsoRate)}</Text>
          <Text style={s.cibleHint}>vs {pct(start.autoconsoRate)} au constat</Text>
        </View>
        <View style={s.cibleCard}>
          <Text style={s.cibleLabel}>Couverture des besoins</Text>
          <Text style={s.cibleValue}>{pct(target.autoproductionRate)}</Text>
          <Text style={s.cibleHint}>vs {pct(start.autoproductionRate)} au constat</Text>
        </View>
        <View style={s.cibleCard}>
          <Text style={s.cibleLabel}>Autoconsommé /an</Text>
          <Text style={s.cibleValue}>{kwh(target.selfConsumedKwh)}</Text>
          <Text style={s.cibleHint}>soit +{fmtInt(target.selfConsumedKwh - start.selfConsumedKwh)} kWh vs constat</Text>
        </View>
      </View>

      <Text style={sharedStyles.sectionTitle}>La cible pas à pas</Text>
      <View style={s.tHead}>
        <Text style={[s.tHeadCell, s.cStep]}>Étape</Text>
        <Text style={[s.tHeadCell, s.cNum]}>Autoconso.</Text>
        <Text style={[s.tHeadCell, s.cNum]}>Couverture</Text>
        <Text style={[s.tHeadCell, s.cNum]}>Gain</Text>
      </View>
      {cascade.map((r) => (
        <View key={r.key} style={s.tRow}>
          <Text style={[s.tCell, s.cStep]}>{r.label}</Text>
          <Text style={[s.tCell, s.cNum]}>{pct(r.autoconsoRate)}</Text>
          <Text style={[s.tCell, s.cNum]}>{pct(r.autoproductionRate)}</Text>
          <Text style={[s.tCell, s.cNum, r.deltaKwh > 0.5 ? { color: C.bleuM, fontFamily: 'Helvetica-Bold' } : {}]}>
            {r.deltaKwh > 0.5 ? `+${fmtInt(r.deltaKwh)} kWh` : '—'}
          </Text>
        </View>
      ))}
      <CascadeChart cascade={cascade} width={CHART_W} height={150} />
      <View style={s.legendRow}>
        <View style={s.legendItem}>
          <View style={[s.legendSwatch, { backgroundColor: C.jaune }]} />
          <Text style={s.legendText}>Taux d'autoconsommation</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.legendSwatch, { backgroundColor: C.bleuM }]} />
          <Text style={s.legendText}>Couverture des besoins</Text>
        </View>
      </View>

      <Text style={sharedStyles.sectionTitle}>Votre journée-type</Text>
      <Text style={s.intro}>
        En journée moyenne, la consommation optimisée (bleu) se cale sous la cloche de production solaire
        (jaune), là où la consommation actuelle (pointillé) la manquait.
      </Text>
      <DayTypeChart dayCurves={autoconso.dayCurves} width={CHART_W} height={150} />
      <View style={s.legendRow}>
        <View style={s.legendItem}>
          <View style={[s.legendSwatch, { backgroundColor: C.jaune }]} />
          <Text style={s.legendText}>Production solaire</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.legendSwatch, { backgroundColor: C.gris }]} />
          <Text style={s.legendText}>Consommation actuelle</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.legendSwatch, { backgroundColor: C.bleuM }]} />
          <Text style={s.legendText}>Consommation optimisée</Text>
        </View>
      </View>

      <View style={s.noteBox}>
        <Text style={s.noteText}>
          Calcul horaire réel (talon Enedis calé sur vos 12 factures + production PVGIS du lieu). Le surplus
          n'est jamais valorisé en euros : il finance de l'autoconsommation ou du confort (piscine, climatisation).
          {hasBattery ? ` Batterie ${autoconso.battery.recommendedCapacityKwh} kWh — les pertes de stockage restent comptées en surplus.` : ''}
        </Text>
      </View>

      <Footer company={company} />
    </Page>
  );
}
