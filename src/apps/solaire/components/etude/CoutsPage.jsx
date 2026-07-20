// src/apps/solaire/components/etude/CoutsPage.jsx
// Page « Vos coûts & votre rentabilité » : projection année par année du coût
// d'électricité avec/sans installation (surplus toujours à 0 €), financement,
// rentabilité (ROCE / point mort / sensibilité) et tableau annuel d'amortissement.
import { Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { NATIONAL_AUTOCONSO_BENCHMARK } from '../../lib/etudeModel';
import { C, numStr, eur, pct, pct1Pdf, CompanyHeader, Footer, sharedStyles } from './pdfShared';
import { CostProjectionChart } from './charts';

const CHART_W = 531;

const s = StyleSheet.create({
  intro: { fontSize: 7.5, color: C.grisTxt, lineHeight: 1.4, marginBottom: 4 },
  legendRow: { flexDirection: 'row', gap: 10, marginTop: 5, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  legendSwatch: { width: 7, height: 7, borderRadius: 1 },
  legendText: { fontSize: 6.5, color: C.grisTxt },
  savings: { fontSize: 7.5, color: C.noir, marginTop: 4 },
  savingsStrong: { fontFamily: 'Helvetica-Bold', color: C.bleuM },
  row2: { flexDirection: 'row', gap: 12 },
  col: { flex: 1 },
  fieldRow: { flexDirection: 'row', marginBottom: 2 },
  fieldLabel: { width: 105, color: C.grisTxt },
  fieldValue: { flex: 1, fontFamily: 'Helvetica-Bold' },
  calcLine: { fontSize: 6.8, color: C.grisTxt, marginBottom: 1.5, lineHeight: 1.35 },
  calcStrong: { fontFamily: 'Helvetica-Bold', color: C.noir },
  indicRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  indicBox: { flex: 1, border: `1px solid ${C.grisBar}`, borderRadius: 4, padding: 7 },
  indicLabel: { fontSize: 6.5, color: C.grisTxt },
  indicValue: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  tHead: { flexDirection: 'row', backgroundColor: C.bleuF, paddingVertical: 3, paddingHorizontal: 4, borderRadius: 2, marginTop: 4 },
  tHeadCell: { color: C.blanc, fontSize: 6.5, fontFamily: 'Helvetica-Bold' },
  tRow: { flexDirection: 'row', paddingVertical: 1.8, paddingHorizontal: 4, borderBottom: `0.5px solid ${C.grisClair}` },
  tCell: { fontSize: 6.8 },
  cYear: { width: '14%' },
  cNum: { width: '21%', textAlign: 'right' },
  cEffort: { width: '23%', textAlign: 'right' },
  badge: { fontSize: 5.5, fontFamily: 'Helvetica-Bold', color: C.bleuM },
  altLine: { fontSize: 7, color: C.grisTxt, marginTop: 4 },
  noteBox: { backgroundColor: C.grisClair, borderRadius: 4, padding: 8, marginTop: 10 },
  noteTitle: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  noteText: { fontSize: 6.8, color: C.grisTxt, lineHeight: 1.4 },
});

function Field({ label, value }) {
  return (
    <View style={s.fieldRow}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={s.fieldValue}>{value}</Text>
    </View>
  );
}

export function CoutsPage({ model, config, company, annexLabels }) {
  const totals = model.active.totals;
  const ind = model.table?.indicators ?? null;
  const savingsAvg = model.avgAnnualCostWithout - model.avgAnnualCostWith;
  const savingsPct = model.avgAnnualCostWithout > 0 ? savingsAvg / model.avgAnnualCostWithout : 0;
  const effortLabel = (v) => (v <= 0 ? `Gain ${eur(Math.abs(v))}` : `Effort ${eur(v)}`);

  return (
    <Page size="A4" style={sharedStyles.page}>
      <CompanyHeader company={company} />

      <Text style={sharedStyles.sectionTitle}>Vos coûts d'électricité sur {config.horizon_years} ans</Text>
      <Text style={s.intro}>
        Coût annuel d'électricité prévu, avec et sans installation. Sans installation, la facture grimpe avec
        l'inflation (+{numStr(Math.round(config.inflation_rate * 1000) / 10)} %/an) ; avec, l'autoconsommation en absorbe une large part.
      </Text>
      <CostProjectionChart costSeries={model.costSeries} width={CHART_W} height={168} />
      <View style={s.legendRow}>
        <View style={s.legendItem}>
          <View style={[s.legendSwatch, { backgroundColor: C.grisBar }]} />
          <Text style={s.legendText}>Sans installation</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.legendSwatch, { backgroundColor: C.bleuM }]} />
          <Text style={s.legendText}>Avec installation</Text>
        </View>
      </View>
      <Text style={s.savings}>
        Soit <Text style={s.savingsStrong}>{eur(savingsAvg)}/an d'économie moyenne (-{pct(savingsPct)})</Text> sur {config.horizon_years} ans
        — le surplus de production reste valorisé 0 €.
      </Text>

      <Text style={sharedStyles.sectionTitle}>Financement</Text>
      <View style={s.row2}>
        <View style={s.col}>
          <Field label="Coût installation TTC" value={model.totalCost !== null ? eur(model.totalCost) : 'À définir'} />
          {model.chargerPrice > 0 && <Field label="dont borne de recharge" value={eur(model.chargerPrice)} />}
          <Field label="Apport" value={eur(model.deposit)} />
          <Field label="Capital financé" value={model.capital !== null ? eur(model.capital) : '—'} />
        </View>
        <View style={s.col}>
          <Field label="Taux annuel" value={model.financingOk ? `${(model.rate * 100).toLocaleString('fr-FR')} %` : '—'} />
          <Field label="Durée" value={model.financingOk ? `${model.years} ans` : '—'} />
          <Field label="Mensualité" value={model.mensualite !== null ? `${eur(model.mensualite)}/mois` : '—'} />
          <Field label="Économie moyenne an 1" value={`${eur(model.economyYear1 / 12)}/mois`} />
        </View>
      </View>

      {model.totalCost !== null && model.assetYieldYear1 !== null && (
        <>
          <Text style={sharedStyles.sectionTitle}>Rentabilité</Text>
          <Text style={s.calcLine}>
            • <Text style={s.calcStrong}>Rentabilité : {pct1Pdf(model.assetYieldYear1)} par an</Text> — l'installation
            rapporte {eur(model.economyYear1)}/an pour {eur(model.totalCost)} investis
            {model.assetYieldAvg !== null ? `. En moyenne ${pct1Pdf(model.assetYieldAvg)}/an sur ${config.horizon_years} ans (le prix de l'électricité augmente, pas les mensualités)` : ''}.
          </Text>
          {model.breakEvenAutoconsoRate !== null && (
            <Text style={s.calcLine}>
              • <Text style={s.calcStrong}>Point mort : {pct(model.breakEvenAutoconsoRate)} d'autoconsommation</Text> — au-dessus,
              l'installation rapporte plus qu'elle ne coûte. Cette étude : {pct(totals.tauxAutoconso)}
              {totals.tauxAutoconso >= model.breakEvenAutoconsoRate ? ', gain dès la première année' : ''} ({NATIONAL_AUTOCONSO_BENCHMARK}).
            </Text>
          )}
          <Text style={s.calcLine}>
            • <Text style={s.calcStrong}>Chaque point d'autoconsommation gagné = +{eur(model.sensitivityPerAutoconsoPoint)}/an</Text> — le
            pilotage (ballon d'eau chaude, recharges en journée) et l'optimisation font monter cette part au-delà du constat.
          </Text>
        </>
      )}

      {ind && (
        <View style={s.indicRow}>
          <View style={s.indicBox}>
            <Text style={s.indicLabel}>Effort mensuel moyen pendant le crédit</Text>
            <Text style={[s.indicValue, { color: ind.avgMonthlyEffortDuringLoan <= 0 ? C.bleuM : C.noir }]}>
              {effortLabel(ind.avgMonthlyEffortDuringLoan)}/mois
            </Text>
          </View>
          <View style={s.indicBox}>
            <Text style={s.indicLabel}>Année de neutralité</Text>
            <Text style={s.indicValue}>
              {ind.neutralityYear ? `Année ${ind.neutralityYear}` : `> ${config.horizon_years} ans`}
            </Text>
          </View>
          <View style={s.indicBox}>
            <Text style={s.indicLabel}>Gain total sur {config.horizon_years} ans</Text>
            <Text style={[s.indicValue, { color: ind.totalGainAtHorizon >= 0 ? C.bleuM : C.noir }]}>
              {eur(ind.totalGainAtHorizon)}
            </Text>
          </View>
        </View>
      )}

      {model.table ? (
        <>
          <Text style={sharedStyles.sectionTitle}>Tableau annuel</Text>
          <View style={s.tHead}>
            <Text style={[s.tHeadCell, s.cYear]}>Année</Text>
            <Text style={[s.tHeadCell, s.cNum]}>Économie élec.</Text>
            <Text style={[s.tHeadCell, s.cNum]}>Annuité crédit</Text>
            <Text style={[s.tHeadCell, s.cEffort]}>Effort net</Text>
            <Text style={[s.tHeadCell, s.cNum]}>Cumul</Text>
          </View>
          {model.table.rows.map((r) => {
            const isNeutrality = r.year === ind?.neutralityYear;
            const isLoanEnd = r.year === model.years;
            return (
              <View
                key={r.year}
                style={[
                  s.tRow,
                  isNeutrality ? { backgroundColor: C.bleuPale } : {},
                  isLoanEnd ? { borderBottom: `1.5px solid ${C.gris}` } : {},
                ]}
              >
                <Text style={[s.tCell, s.cYear]}>
                  {r.year}
                  {isNeutrality ? <Text style={s.badge}>  NEUTRALITÉ</Text> : null}
                  {isLoanEnd ? <Text style={s.badge}>  FIN DU CRÉDIT</Text> : null}
                </Text>
                <Text style={[s.tCell, s.cNum]}>{eur(r.economy)}</Text>
                <Text style={[s.tCell, s.cNum]}>{r.annuity > 0 ? eur(r.annuity) : '0 €'}</Text>
                <Text style={[s.tCell, s.cEffort, r.effortNet <= 0 ? { color: C.bleuM, fontFamily: 'Helvetica-Bold' } : {}]}>
                  {r.effortNet <= 0 ? `Gain ${eur(Math.abs(r.effortNet))}` : `Effort ${eur(r.effortNet)}`}
                </Text>
                <Text style={[s.tCell, s.cNum, r.cumul >= 0 ? { color: C.bleuM, fontFamily: 'Helvetica-Bold' } : {}]}>
                  {eur(r.cumul)}
                </Text>
              </View>
            );
          })}
        </>
      ) : (
        <Text style={[s.altLine, { marginTop: 8 }]}>
          Tableau annuel non calculé : le coût de l'installation n'a pas été renseigné lors de la simulation.
        </Text>
      )}

      <View style={s.noteBox}>
        <Text style={s.noteTitle}>Une approche volontairement conservatrice</Text>
        <Text style={s.noteText}>
          Le surplus de production non autoconsommé est valorisé 0 € dans toute cette étude (revente non prise en
          compte — arrêté du 1er juin 2026). Les économies proviennent uniquement de l'électricité autoconsommée.
          Hypothèses : inflation du prix de l'électricité +{numStr(Math.round(config.inflation_rate * 1000) / 10)} %/an, dégradation
          des panneaux -{numStr(config.degradation_rate * 100)} %/an, horizon {config.horizon_years} ans.
        </Text>
        {annexLabels?.length > 0 && (
          <Text style={[s.noteText, { marginTop: 3 }]}>
            Annexes jointes : {annexLabels.join(' · ')}.
          </Text>
        )}
      </View>

      <Footer company={company} />
    </Page>
  );
}
