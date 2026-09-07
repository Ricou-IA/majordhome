/* eslint-disable react-refresh/only-export-components -- module de rendu PDF (blob), jamais monté
   dans l'arbre React : Fast Refresh ne s'applique pas. */
/**
 * PlanningWeekPDF.jsx — Planning hebdomadaire imprimable d'une personne (A4 portrait)
 * ============================================================================
 * Feuille de route papier pour qui n'a pas de tablette (sous-traitant, stagiaire) :
 * un bloc par jour, une carte par RDV avec l'essentiel du terrain — heure, type,
 * client, secteur, adresse, téléphone, équipements, consignes.
 *
 * Le document n'effectue AUCUN calcul ni tri : tout vient de `buildWeeklyPlanningModel`.
 * Socle graphique commun `@lib/pdfShared`, comme la synthèse DPE.
 *
 * ⚠️ Helvetica / WinAnsi : pas de flèches ni de glyphes hors cp1252 (« – · — » OK).
 * ============================================================================
 */
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import { C, accentOf, sharedStyles, CompanyHeader } from '@lib/pdfShared';

const s = StyleSheet.create({
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6 },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  subtitle: { fontSize: 9, color: C.grisTxt, marginTop: 2 },
  weekBadge: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.blanc, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 4 },

  day: { marginTop: 10 },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3, paddingHorizontal: 6, borderRadius: 3, marginBottom: 4 },
  dayLabel: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.blanc },
  dayCount: { fontSize: 7.5, color: C.blanc },
  empty: { fontSize: 8, color: C.grisTxt, fontFamily: 'Helvetica-Oblique', paddingVertical: 4, paddingHorizontal: 6 },

  card: { flexDirection: 'row', marginBottom: 4, borderRadius: 3, backgroundColor: C.grisClair, overflow: 'hidden' },
  cardBar: { width: 5 },
  cardBody: { flex: 1, paddingVertical: 5, paddingHorizontal: 7 },
  line1: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  time: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', width: 64 },
  type: { fontSize: 9.5, fontFamily: 'Helvetica-Bold' },
  client: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', flex: 1 },
  sector: { fontSize: 7.5, color: C.slate },
  meta: { flexDirection: 'row', gap: 6, marginTop: 2, marginLeft: 70 },
  metaTxt: { fontSize: 8, color: C.slate },
  metaLabel: { fontSize: 8, color: C.grisTxt },
  note: { fontSize: 7.5, color: C.slate, marginTop: 2, marginLeft: 70, fontFamily: 'Helvetica-Oblique' },

  footer: { position: 'absolute', bottom: 18, left: 32, right: 32, borderTop: `0.5px solid ${C.grisBar}`, paddingTop: 4, flexDirection: 'row', justifyContent: 'space-between' },
  footerTxt: { fontSize: 6.5, color: C.grisTxt },
});

function Card({ item }) {
  const hasMeta = item.address || item.phone || item.equipments.length > 0;
  return (
    <View style={s.card} wrap={false}>
      <View style={[s.cardBar, { backgroundColor: item.color }]} />
      <View style={s.cardBody}>
        <View style={s.line1}>
          <Text style={s.time}>{item.time}</Text>
          <Text style={s.type}>{item.typeLabel}</Text>
          <Text style={s.client}>{item.clientName || ''}</Text>
          {item.sector ? <Text style={s.sector}>Secteur {item.sector}</Text> : null}
        </View>
        {hasMeta ? (
          <View style={s.meta}>
            {item.address ? <Text style={s.metaTxt}>{item.address}</Text> : null}
            {item.phone ? <Text style={s.metaTxt}>· {item.phone}</Text> : null}
          </View>
        ) : null}
        {item.equipments.length > 0 ? (
          <View style={s.meta}>
            <Text style={s.metaLabel}>Équipements :</Text>
            <Text style={s.metaTxt}>{item.equipments.join(' · ')}</Text>
          </View>
        ) : null}
        {item.subject ? <Text style={s.note}>{item.subject}</Text> : null}
        {item.description ? <Text style={s.note}>{item.description}</Text> : null}
      </View>
    </View>
  );
}

function Day({ day, accent }) {
  const n = day.items.length;
  return (
    <View style={s.day}>
      <View style={[s.dayHeader, { backgroundColor: n ? accent : C.grisBar }]} minPresenceAhead={40}>
        <Text style={s.dayLabel}>{day.label}</Text>
        <Text style={s.dayCount}>{n === 0 ? '' : n === 1 ? '1 rendez-vous' : `${n} rendez-vous`}</Text>
      </View>
      {n === 0
        ? <Text style={s.empty}>Aucun rendez-vous</Text>
        : day.items.map((it) => <Card key={it.id} item={it} />)}
    </View>
  );
}

export function PlanningWeekDocument({ model, company }) {
  const accent = accentOf(company);
  return (
    <Document title={`Planning ${model.personName} — S${model.weekNumber}`} author={company?.name || ''}>
      <Page size="A4" style={sharedStyles.page}>
        <CompanyHeader company={company} />
        <View style={s.titleRow}>
          <View>
            <Text style={[s.title, { color: accent }]}>Planning de {model.personName}</Text>
            <Text style={s.subtitle}>
              Semaine du {model.weekLabel} · {model.totalCount === 0 ? 'aucun rendez-vous' : `${model.totalCount} rendez-vous`}
            </Text>
          </View>
          <Text style={[s.weekBadge, { backgroundColor: accent }]}>S{model.weekNumber}</Text>
        </View>

        {model.days.map((d) => <Day key={d.dateISO} day={d} accent={accent} />)}

        <View style={s.footer} fixed>
          <Text style={s.footerTxt}>{model.editedLabel}</Text>
          <Text style={s.footerTxt} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Rendu → Blob (point d'entrée de `planningPrintExport.js`). */
export async function generatePlanningWeekPdfBlob({ model, company }) {
  return pdf(<PlanningWeekDocument model={model} company={company} />).toBlob();
}
