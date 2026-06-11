/**
 * EtudePDF.jsx — Étude de rentabilité photovoltaïque personnalisée (2 pages A4)
 * ============================================================================
 * Template @react-pdf/renderer, brandé via buildCompanyInfo (multi-tenant).
 * Palette deutan (jaunes/bleus/neutres). Le surplus n'est JAMAIS valorisé.
 * Graphique mensuel redessiné en primitives (pas de capture d'écran).
 * ============================================================================
 */
import { Document, Page, Text, View, Image, StyleSheet, pdf } from '@react-pdf/renderer';
import { formatFullAddress, buildLegalFooter } from '@lib/orgBranding';
import { percentToDegrees } from '../lib/pvEngine';
import { PRESET_LABELS } from '../lib/etudeModel';

const C = {
  jaune: '#F5C542',
  bleuF: '#0D47A1',
  bleuM: '#1565C0',
  bleuC: '#2196F3',
  bleuPale: '#E3F2FD',
  gris: '#9CA3AF',
  grisBar: '#D1D5DB',
  grisClair: '#F3F4F6',
  grisTxt: '#6B7280',
  noir: '#1F2937',
  blanc: '#FFFFFF',
};

const s = StyleSheet.create({
  page: { padding: 32, paddingBottom: 52, fontSize: 8, fontFamily: 'Helvetica', color: C.noir },
  // Header entreprise
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, paddingBottom: 8, borderBottom: `1.5px solid ${C.bleuF}` },
  companyName: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  companyLine: { fontSize: 7, color: C.grisTxt, marginTop: 1 },
  logo: { width: 64, maxHeight: 40, objectFit: 'contain' },
  // Titre
  titleBand: { backgroundColor: C.bleuF, borderRadius: 4, paddingVertical: 8, paddingHorizontal: 10, marginBottom: 10 },
  title: { color: C.blanc, fontSize: 13, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  subtitle: { color: C.bleuPale, fontSize: 8, textAlign: 'center', marginTop: 2 },
  // Sections
  sectionTitle: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.bleuF, marginTop: 10, marginBottom: 4, borderBottom: `0.5px solid ${C.grisBar}`, paddingBottom: 2 },
  row2: { flexDirection: 'row', gap: 12 },
  col: { flex: 1 },
  fieldRow: { flexDirection: 'row', marginBottom: 2 },
  fieldLabel: { width: 95, color: C.grisTxt },
  fieldValue: { flex: 1, fontFamily: 'Helvetica-Bold' },
  // Scénario retenu
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
  // Légende chart
  legendRow: { flexDirection: 'row', gap: 10, marginTop: 5, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  legendSwatch: { width: 7, height: 7, borderRadius: 1 },
  legendText: { fontSize: 6.5, color: C.grisTxt },
  totalsRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  totalBox: { flex: 1, backgroundColor: C.grisClair, borderRadius: 3, padding: 5 },
  // Indicateurs P2
  indicRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  indicBox: { flex: 1, border: `1px solid ${C.grisBar}`, borderRadius: 4, padding: 7 },
  indicLabel: { fontSize: 6.5, color: C.grisTxt },
  indicValue: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  // Tableau annuel
  tHead: { flexDirection: 'row', backgroundColor: C.bleuF, paddingVertical: 3, paddingHorizontal: 4, borderRadius: 2, marginTop: 4 },
  tHeadCell: { color: C.blanc, fontSize: 6.5, fontFamily: 'Helvetica-Bold' },
  tRow: { flexDirection: 'row', paddingVertical: 1.8, paddingHorizontal: 4, borderBottom: `0.5px solid ${C.grisClair}` },
  tCell: { fontSize: 6.8 },
  cYear: { width: '14%' },
  cNum: { width: '21%', textAlign: 'right' },
  cEffort: { width: '23%', textAlign: 'right' },
  badge: { fontSize: 5.5, fontFamily: 'Helvetica-Bold', color: C.bleuM },
  // Encadré conservateur
  noteBox: { backgroundColor: C.grisClair, borderRadius: 4, padding: 8, marginTop: 10 },
  noteTitle: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  noteText: { fontSize: 6.8, color: C.grisTxt, lineHeight: 1.4 },
  // Footer
  footer: { position: 'absolute', bottom: 18, left: 32, right: 32, borderTop: `0.5px solid ${C.grisBar}`, paddingTop: 4 },
  footerText: { fontSize: 5.8, color: C.grisTxt, textAlign: 'center' },
});

// ⚠️ Helvetica (police PDF de base) ne couvre pas tous les glyphes Unicode :
// l'espace fine insécable (U+202F) des milliers fr-FR, ≈, ▲/▼ et le signe
// moins U+2212 sortent en artefacts. Formatters PDF-safe obligatoires.
const fmtInt = (n) => Math.round(n).toLocaleString('fr-FR').replace(/\s/g, ' '); // \s couvre U+202F/U+00A0
const numStr = (x) => String(x).replace('.', ',');
const eur = (n) => `${fmtInt(n)} €`;
const kwh = (n) => `${fmtInt(n)} kWh`;
const pct = (x) => `${Math.round(x * 100)} %`;

function Field({ label, value }) {
  return (
    <View style={s.fieldRow}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={s.fieldValue}>{value}</Text>
    </View>
  );
}

function CompanyHeader({ company }) {
  const address = formatFullAddress(company);
  return (
    <View style={s.header}>
      <View style={{ flex: 1 }}>
        <Text style={[s.companyName, { color: company.accentColor || C.bleuF }]}>{company.name}</Text>
        {address ? <Text style={s.companyLine}>{address}</Text> : null}
        <Text style={s.companyLine}>
          {[company.phone, company.email].filter(Boolean).join('  ·  ')}
        </Text>
        {company.rgeCertifications?.length > 0 && (
          <Text style={s.companyLine}>Certifications : {company.rgeCertifications.join(', ')}</Text>
        )}
      </View>
      {company.logoUrl ? <Image src={company.logoUrl} style={s.logo} /> : null}
    </View>
  );
}

function Footer({ company }) {
  const legal = buildLegalFooter(company);
  return (
    <View style={s.footer} fixed>
      {legal ? <Text style={s.footerText}>{legal}</Text> : null}
      <Text style={s.footerText}>
        Étude indicative, non contractuelle — production estimée via PVGIS (Commission européenne).
      </Text>
    </View>
  );
}

/** Graphique mensuel : barre production empilée (autoconsommée + surplus, liseré jaune) + barre conso. */
function MonthlyBarsChart({ model }) {
  const months = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const { autoconso, surplus, prod } = model.active;
  const conso = model.consoMonthly;
  const maxVal = Math.max(...prod, ...conso, 1);
  const H = 90;
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: H + 3, borderBottom: `1px solid ${C.grisBar}` }}>
        {months.map((label, i) => (
          <View key={`${label}-${i}`} style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 1.5 }}>
            <View style={{ width: 9, flexDirection: 'column', justifyContent: 'flex-end' }}>
              {prod[i] > 0 ? <View style={{ height: 2, backgroundColor: C.jaune }} /> : null}
              <View style={{ height: Math.max(0, (surplus[i] / maxVal) * H), backgroundColor: C.grisBar }} />
              <View style={{ height: Math.max(0, (autoconso[i] / maxVal) * H), backgroundColor: C.bleuC }} />
            </View>
            <View style={{ width: 9, height: Math.max(0.5, (conso[i] / maxVal) * H), backgroundColor: C.bleuF }} />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row' }}>
        {months.map((label, i) => (
          <Text key={`${label}-${i}`} style={{ flex: 1, textAlign: 'center', fontSize: 5.5, color: C.grisTxt, marginTop: 1 }}>
            {label}
          </Text>
        ))}
      </View>
      <View style={s.legendRow}>
        <View style={s.legendItem}>
          <View style={[s.legendSwatch, { backgroundColor: C.jaune }]} />
          <Text style={s.legendText}>Production (= autoconsommée + surplus)</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.legendSwatch, { backgroundColor: C.bleuC }]} />
          <Text style={s.legendText}>Autoconsommée</Text>
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
    </View>
  );
}

function EtudeDocument({ model, config, company, inputs, meta, annexLabels }) {
  const { roof, conso, ev } = inputs;
  const totals = model.active.totals;
  const tiltDeg = Math.round(percentToDegrees(Number(roof.tiltPercent) || 0) * 10) / 10;
  const consoSaisie = conso.monthly.reduce((a, v) => a + (Number(v) || 0), 0);
  const others = model.scenarios.filter((sc) => sc.kwc !== model.activeKwc);
  const ind = model.table?.indicators ?? null;
  const effortLabel = (v) => (v <= 0 ? `Gain ${eur(Math.abs(v))}` : `Effort ${eur(v)}`);
  const parts = model.coeffParts;
  const coeffFormula = [
    `${PRESET_LABELS[parts.preset] || parts.preset} (${pct(parts.presetValue)})`,
    parts.ecsApplied ? `pilotage ECS (+${pct(parts.bonusEcs)})` : null,
    parts.evApplied ? `recharge VE pilotée (+${pct(parts.bonusVe)})` : null,
  ].filter(Boolean).join(' + ');

  return (
    <Document title={`Étude photovoltaïque — ${meta.clientName}`} author={company.name}>
      {/* ===================== PAGE 1 — L'ÉTUDE ===================== */}
      <Page size="A4" style={s.page}>
        <CompanyHeader company={company} />

        <View style={s.titleBand}>
          <Text style={s.title}>ÉTUDE DE RENTABILITÉ PHOTOVOLTAÏQUE</Text>
          <Text style={s.subtitle}>
            {meta.clientName}{meta.clientAddress ? ` — ${meta.clientAddress}` : ''} · {meta.dateLabel}
          </Text>
        </View>

        <Text style={s.sectionTitle}>Hypothèses de l'étude</Text>
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
            <Field label="Prix du kWh" value={`${numStr(model.priceKwh)} € TTC`} />
            <Field label="Profil de présence" value={`${PRESET_LABELS[conso.preset] || conso.preset}${conso.ecsBonus ? ' + pilotage ECS' : ''}${ev.enabled && ev.pilotedCharge ? ' + recharge VE pilotée' : ''}`} />
            <Field label="Projection" value={`${config.horizon_years} ans · inflation élec +${numStr(Math.round(config.inflation_rate * 1000) / 10)} %/an · dégradation -${numStr(config.degradation_rate * 100)} %/an`} />
          </View>
        </View>

        <Text style={s.sectionTitle}>Installation proposée</Text>
        <View style={s.heroBox}>
          <Text style={s.heroKwc}>{numStr(model.activeKwc)} kWc — {model.activePanels} panneaux</Text>
          <Text style={s.heroSub}>
            {model.activeKwc === model.recommendedKwc
              ? 'Dimensionnement optimal suggéré par l’étude'
              : `Dimensionnement choisi (recommandation de l’étude : ${numStr(model.recommendedKwc)} kWc)`}
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
            Également étudié : {others.map((sc) => `${sc.label} ${numStr(sc.kwc)} kWc (économie an 1 ${eur(sc.economyYear1)}, surplus perdu ${pct(sc.surplusPct)})`).join(' · ')}
          </Text>
        )}

        <Text style={s.sectionTitle}>Transparence du calcul</Text>
        <Text style={s.calcLine}>
          1. <Text style={s.calcStrong}>Production an 1 : {kwh(totals.prod)}</Text> — données solaires PVGIS pour ce
          lieu (pente {numStr(roof.tiltPercent)} % soit {numStr(tiltDeg)}°, orientation {typeof roof.orientation === 'number' ? `${roof.orientation}°` : String(roof.orientation)}, pertes {numStr(config.system_loss)} %) × {numStr(model.activeKwc)} kWc.
        </Text>
        <Text style={s.calcLine}>
          2. <Text style={s.calcStrong}>Recouvrement mensuel : {pct(model.overlapRatio)}</Text> — part de la production
          qui reste sous la consommation, mois par mois.
        </Text>
        <Text style={s.calcLine}>
          3. <Text style={s.calcStrong}>Coefficient de simultanéité : {pct(model.coeff)}</Text> = {coeffFormula}
          {parts.capped ? `, plafonné à ${pct(parts.cap)}` : ''} — part du recouvrement réellement consommée au fil de la
          journée (la production de 11h-16h doit coïncider avec les usages).
        </Text>
        <Text style={s.calcLine}>
          4. <Text style={s.calcStrong}>Autoconsommation : {pct(totals.tauxAutoconso)}</Text> = {pct(model.overlapRatio)} × {pct(model.coeff)}, soit {kwh(totals.autoconso)} autoconsommés ({pct(totals.tauxAutoproduction)} de la facture couverte).
        </Text>
        <Text style={s.calcLine}>
          5. <Text style={s.calcStrong}>Économie an 1 : {eur(model.economyYear1)}</Text> = {kwh(totals.autoconso)} × {numStr(model.priceKwh)} €/kWh — le surplus ({kwh(totals.surplus)}) est valorisé 0 €.
        </Text>
        {model.breakEvenAutoconsoRate !== null && (
          <Text style={s.calcLine}>
            6. <Text style={s.calcStrong}>Point mort : {pct(model.breakEvenAutoconsoRate)} d'autoconsommation</Text> suffisent
            pour que les économies couvrent l'annuité de crédit (an 1) — cette étude est à {pct(totals.tauxAutoconso)}
            {totals.tauxAutoconso >= model.breakEvenAutoconsoRate ? ' (au-dessus : gain dès la première année)' : ''}.
          </Text>
        )}
        <Text style={s.calcLine}>
          {model.breakEvenAutoconsoRate !== null ? '7' : '6'}. <Text style={s.calcStrong}>Sensibilité : +1 point
          d'autoconsommation = +{eur(model.sensitivityPerAutoconsoPoint)}/an</Text> d'économies (an 1). Potentiel maximum
          via pilotage : {pct(model.maxAchievableAutoconso)} d'autoconsommation (coefficient plafonné à {pct(parts.cap)}).
        </Text>

        <Text style={s.sectionTitle}>Production vs consommation (kWh/mois)</Text>
        <MonthlyBarsChart model={model} />
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

      {/* ===================== PAGE 2 — LES CHIFFRES ===================== */}
      <Page size="A4" style={s.page}>
        <CompanyHeader company={company} />

        <Text style={s.sectionTitle}>Financement</Text>
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
            <Text style={s.sectionTitle}>Tableau annuel</Text>
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
    </Document>
  );
}

/** Génère le blob PDF de l'étude (sans les annexes — fusionnées ensuite via pdf-lib). */
export async function generateEtudePdfBlob({ model, config, company, inputs, meta, annexLabels }) {
  return pdf(
    <EtudeDocument
      model={model}
      config={config}
      company={company}
      inputs={inputs}
      meta={meta}
      annexLabels={annexLabels}
    />,
  ).toBlob();
}
