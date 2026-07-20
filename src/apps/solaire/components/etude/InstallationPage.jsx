// src/apps/solaire/components/etude/InstallationPage.jsx
// Page « L'installation & la production » : hypothèses de l'étude, dimensionnement
// retenu (hero), transparence du calcul (production → superposition horaire →
// autoconso → économie) et grand graphe production vs consommation mensuelle.
import { Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { percentToDegrees } from '../../lib/pvEngine';
import { C, fmtInt, numStr, eur, kwh, pct, CompanyHeader, Footer, sharedStyles } from './pdfShared';
import { MonthlyProdConsoChart } from './charts';

const CHART_W = 531;

const s = StyleSheet.create({
  row2: { flexDirection: 'row', gap: 12 },
  col: { flex: 1 },
  fieldRow: { flexDirection: 'row', marginBottom: 2 },
  fieldLabel: { width: 95, color: C.grisTxt },
  fieldValue: { flex: 1, fontFamily: 'Helvetica-Bold' },
  heroBox: { borderRadius: 4, border: `1.5px solid ${C.bleuM}`, padding: 10, marginTop: 4, backgroundColor: C.bleuPale },
  heroKwc: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: C.bleuF },
  heroSub: { fontSize: 8, color: C.grisTxt, marginBottom: 6 },
  heroStats: { flexDirection: 'row', gap: 8 },
  heroStat: { flex: 1, backgroundColor: C.blanc, borderRadius: 3, padding: 5 },
  heroStatLabel: { fontSize: 6.5, color: C.grisTxt },
  heroStatValue: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 1 },
  altLine: { fontSize: 7, color: C.grisTxt, marginTop: 4 },
  calcLine: { fontSize: 6.8, color: C.grisTxt, marginBottom: 1.5, lineHeight: 1.35 },
  calcStrong: { fontFamily: 'Helvetica-Bold', color: C.noir },
  legendRow: { flexDirection: 'row', gap: 10, marginTop: 5, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  legendSwatch: { width: 7, height: 7, borderRadius: 1 },
  legendText: { fontSize: 6.5, color: C.grisTxt },
  totalsRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  totalBox: { flex: 1, backgroundColor: C.grisClair, borderRadius: 3, padding: 5 },
});

function Field({ label, value }) {
  return (
    <View style={s.fieldRow}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={s.fieldValue}>{value}</Text>
    </View>
  );
}

export function InstallationPage({ model, config, company, inputs }) {
  const { roof, conso, ev } = inputs;
  const totals = model.active.totals;
  const tiltDeg = Math.round(percentToDegrees(Number(roof.tiltPercent) || 0) * 10) / 10;
  const consoSaisie = conso.monthly.reduce((a, v) => a + (Number(v) || 0), 0);
  const others = model.scenarios.filter((sc) => sc.kwc !== model.activeKwc);

  return (
    <Page size="A4" style={sharedStyles.page}>
      <CompanyHeader company={company} />

      <Text style={sharedStyles.sectionTitle}>Hypothèses de l'étude</Text>
      <View style={s.row2}>
        <View style={s.col}>
          <Field label="Pente toiture" value={`${numStr(roof.tiltPercent)} % (soit ${numStr(tiltDeg)}°)`} />
          <Field label="Orientation" value={typeof roof.orientation === 'number' ? `${roof.orientation}° (Sud = 0)` : String(roof.orientation)} />
          <Field label="Surface disponible" value={`${numStr(roof.surfaceM2)} m²`} />
          <Field label="Panneau de référence" value={`${config.panel_power_wc} Wc / ${numStr(config.panel_area_m2)} m²`} />
          <Field label="Pertes système" value={`${numStr(config.system_loss)} % (PVGIS)`} />
        </View>
        <View style={s.col}>
          <Field label="Consommation saisie" value={`${kwh(consoSaisie)}/an`} />
          {model.evAnnual > 0 && (
            <Field label="Véhicule électrique" value={`+ ${kwh(model.evAnnual)}/an (${fmtInt(ev.kmPerYear)} km, ${numStr(ev.kwhPer100km)} kWh/100 km)`} />
          )}
          {ev.enabled && ev.owned && (
            <Field label="Véhicule électrique" value={`inclus dans la consommation (${fmtInt(ev.kmPerYear)} km, ${numStr(ev.kwhPer100km)} kWh/100 km)`} />
          )}
          <Field label="Prix du kWh" value={`${numStr(model.priceKwh)} € TTC`} />
          <Field label="Consommation type" value={`Foyer ${conso.profile === 'RES2' ? 'avec' : 'sans'} chauffage électrique (talon Enedis horaire)`} />
          <Field label="Projection" value={`${config.horizon_years} ans · inflation élec +${numStr(Math.round(config.inflation_rate * 1000) / 10)} %/an · dégradation -${numStr(config.degradation_rate * 100)} %/an`} />
        </View>
      </View>

      <Text style={sharedStyles.sectionTitle}>Installation proposée</Text>
      <View style={s.heroBox}>
        <Text style={s.heroKwc}>{numStr(model.activeKwc)} kWc — {model.activePanels} panneaux</Text>
        <Text style={s.heroSub}>
          {model.activeKwc === model.recommendedKwc
            ? 'Dimensionnement optimisé suggéré par l’étude'
            : `Palier choisi (dimensionnement optimisé suggéré : ${numStr(model.recommendedKwc)} kWc)`}
          {model.cappedByOffer ? ` — plafonné à ${config.max_power_kwc} kWc (offre résidentielle)` : ''}
        </Text>
        <View style={s.heroStats}>
          <View style={s.heroStat}>
            <Text style={s.heroStatLabel}>Production an 1</Text>
            <Text style={s.heroStatValue}>{kwh(totals.prod)}</Text>
          </View>
          <View style={s.heroStat}>
            <Text style={s.heroStatLabel}>Autoconsommation</Text>
            <Text style={s.heroStatValue}>{pct(totals.tauxAutoconso)}</Text>
          </View>
          <View style={s.heroStat}>
            <Text style={s.heroStatLabel}>Facture couverte</Text>
            <Text style={s.heroStatValue}>{pct(totals.tauxAutoproduction)}</Text>
          </View>
          <View style={s.heroStat}>
            <Text style={s.heroStatLabel}>Économie an 1</Text>
            <Text style={s.heroStatValue}>{eur(model.economyYear1)}</Text>
          </View>
        </View>
      </View>
      {others.length > 0 && (
        <Text style={s.altLine}>
          Également étudié : {others.map((sc) => `${numStr(sc.kwc)} kWc${sc.isOptimum ? ' (optimisé)' : ''} — économie an 1 : ${eur(sc.economyYear1)}, surplus perdu ${pct(sc.surplusPct)}`).join(' · ')}
        </Text>
      )}

      <Text style={sharedStyles.sectionTitle}>Transparence du calcul</Text>
      <Text style={s.calcLine}>
        1. <Text style={s.calcStrong}>Production an 1 : {kwh(totals.prod)}</Text> — données solaires PVGIS pour ce
        lieu (pente {numStr(roof.tiltPercent)} % soit {numStr(tiltDeg)}°, orientation {typeof roof.orientation === 'number' ? `${roof.orientation}°` : String(roof.orientation)}, pertes {numStr(config.system_loss)} %) × {numStr(model.activeKwc)} kWc.
      </Text>
      <Text style={s.calcLine}>
        2. <Text style={s.calcStrong}>Superposition heure par heure</Text> — la production est confrontée à une
        consommation type reconstituée heure par heure (profil de foyer Enedis calé sur vos 12 factures). Le solaire ne
        compte que quand un besoin existe au même instant : on ne compare pas des totaux annuels.
      </Text>
      <Text style={s.calcLine}>
        3. <Text style={s.calcStrong}>Autoconsommation : {pct(totals.tauxAutoconso)}</Text> = somme, sur les 8 760 heures
        annuelles, de la production réellement consommée sur place, soit {kwh(totals.autoconso)} autoconsommés
        ({pct(totals.tauxAutoproduction)} de la facture couverte).
      </Text>
      <Text style={s.calcLine}>
        4. <Text style={s.calcStrong}>Économie an 1 : {eur(model.economyYear1)}</Text> = {kwh(totals.autoconso)} × {numStr(model.priceKwh)} €/kWh — le surplus ({kwh(totals.surplus)}) est valorisé 0 €.
      </Text>

      <Text style={sharedStyles.sectionTitle}>Production vs consommation (kWh/mois)</Text>
      <MonthlyProdConsoChart model={model} width={CHART_W} height={168} />
      <View style={s.legendRow}>
        <View style={s.legendItem}>
          <View style={[s.legendSwatch, { backgroundColor: C.jaune }]} />
          <Text style={s.legendText}>Production autoconsommée</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.legendSwatch, { backgroundColor: C.grisBar }]} />
          <Text style={s.legendText}>Surplus perdu (0 €)</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.legendSwatch, { backgroundColor: C.bleuF }]} />
          <Text style={s.legendText}>Consommation</Text>
        </View>
      </View>
      <View style={s.totalsRow}>
        <View style={s.totalBox}>
          <Text style={s.heroStatLabel}>Production /an</Text>
          <Text style={{ fontSize: 8.5, fontFamily: 'Helvetica-Bold' }}>{kwh(totals.prod)}</Text>
        </View>
        <View style={s.totalBox}>
          <Text style={s.heroStatLabel}>Consommation /an</Text>
          <Text style={{ fontSize: 8.5, fontFamily: 'Helvetica-Bold' }}>{kwh(totals.conso)}</Text>
        </View>
        <View style={s.totalBox}>
          <Text style={s.heroStatLabel}>Autoconsommée /an</Text>
          <Text style={{ fontSize: 8.5, fontFamily: 'Helvetica-Bold' }}>{kwh(totals.autoconso)}</Text>
        </View>
        <View style={s.totalBox}>
          <Text style={s.heroStatLabel}>Surplus perdu /an</Text>
          <Text style={{ fontSize: 8.5, fontFamily: 'Helvetica-Bold' }}>{kwh(totals.surplus)}</Text>
        </View>
      </View>

      <Footer company={company} />
    </Page>
  );
}
