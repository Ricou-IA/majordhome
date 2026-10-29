/* eslint-disable react-refresh/only-export-components -- module de rendu PDF (blob), jamais monté
   dans l'arbre React : Fast Refresh ne s'applique pas. */
/**
 * ProgrammesPDF.jsx — Programmes du chantier Gaillac (A4 portrait, une page par code de planning)
 * ============================================================================
 * Feuille papier du technicien pour sa journée ou demi-journée : site par site, chaque tâche avec son n°,
 * l'action, les observations, la durée, Stock / Achat, et une case à cocher à la main.
 *
 * Le document n'effectue AUCUN calcul ni tri : tout vient de `buildProgrammesModel`.
 * Socle graphique commun `@lib/pdfShared`, comme le planning hebdo.
 *
 * ⚠️ Helvetica / WinAnsi : pas de flèches ni de glyphes hors cp1252 (« – · — » OK).
 * ============================================================================
 */
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import { C, accentOf, sharedStyles, CompanyHeader } from '@lib/pdfShared';

const s = StyleSheet.create({
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 },
  title: { fontSize: 15, fontFamily: 'Helvetica-Bold' },
  subtitle: { fontSize: 9, color: C.grisTxt, marginTop: 2 },
  badge: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.blanc, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 4 },
  kpis: { flexDirection: 'row', gap: 14, marginBottom: 6 },
  kpi: { fontSize: 8, color: C.slate },
  kpiStrong: { fontFamily: 'Helvetica-Bold' },

  site: { marginTop: 8 },
  siteHeader: { paddingVertical: 3, paddingHorizontal: 6, borderRadius: 3, marginBottom: 2 },
  siteName: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.blanc },
  siteAddress: { fontSize: 7.5, color: C.blanc },

  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 4, paddingHorizontal: 4, borderBottom: `0.4px solid ${C.grisBar}` },
  box: { width: 11, height: 11, borderRadius: 2, border: `1px solid ${C.slate}`, marginRight: 6, marginTop: 1 },
  boxDone: { backgroundColor: C.bleuF, borderColor: C.bleuF },
  numero: { width: 26, fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.grisTxt },
  main: { flex: 1 },
  action: { fontSize: 8.5 },
  actionDone: { color: C.grisTxt, textDecoration: 'line-through' },
  releve: { fontFamily: 'Helvetica-Oblique', color: C.slate },
  tags: { flexDirection: 'row', gap: 4, marginBottom: 2 },
  tag: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', paddingVertical: 1, paddingHorizontal: 4, borderRadius: 3 },
  tagSecu: { backgroundColor: C.ambre, color: '#3A2A00' },
  tagReleve: { backgroundColor: C.bleuPale, color: C.bleuF },
  obs: { fontSize: 7.5, color: C.slate, marginTop: 1.5 },
  commentaire: { fontSize: 7.5, color: C.bleuF, marginTop: 1.5, fontFamily: 'Helvetica-Oblique' },
  side: { width: 130, alignItems: 'flex-end' },
  duree: { fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
  sideMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  theme: { fontSize: 6.5, color: C.grisTxt },
  achat: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', paddingVertical: 1, paddingHorizontal: 4, borderRadius: 3 },
  achatOui: { backgroundColor: C.ambrePale, color: C.ambreTxt },
  achatNon: { backgroundColor: C.grisClair, color: C.grisTxt },

  footer: { position: 'absolute', bottom: 18, left: 32, right: 32, borderTop: `0.5px solid ${C.grisBar}`, paddingTop: 4, flexDirection: 'row', justifyContent: 'space-between' },
  footerTxt: { fontSize: 6.5, color: C.grisTxt },
});

function Row({ r }) {
  return (
    <View style={s.row} wrap={false}>
      <View style={[s.box, r.fait ? s.boxDone : null]} />
      <Text style={s.numero}>{r.numero}</Text>
      <View style={s.main}>
        {(r.securite || r.releve) ? (
          <View style={s.tags}>
            {r.securite ? <Text style={[s.tag, s.tagSecu]}>SÉCURITÉ</Text> : null}
            {r.releve ? <Text style={[s.tag, s.tagReleve]}>Relevé pour commande</Text> : null}
          </View>
        ) : null}
        <Text style={[s.action, r.fait ? s.actionDone : null, r.releve ? s.releve : null]}>{r.action}</Text>
        {r.observations ? <Text style={s.obs}>{r.observations}</Text> : null}
        {r.commentaire ? <Text style={s.commentaire}>Terrain : {r.commentaire}</Text> : null}
      </View>
      <View style={s.side}>
        <Text style={s.duree}>{r.dureeLabel}</Text>
        <View style={s.sideMeta}>
          {r.theme ? <Text style={s.theme}>{r.theme}</Text> : null}
          <Text style={[s.achat, r.achat === 'Achat' ? s.achatOui : s.achatNon]}>{r.achat}</Text>
        </View>
      </View>
    </View>
  );
}

function Site({ site, accent }) {
  const [first, ...rest] = site.rows;
  return (
    <View style={s.site}>
      {/* L'en-tête de site part avec sa première ligne : jamais orphelin en bas de page */}
      <View wrap={false}>
        <View style={[s.siteHeader, { backgroundColor: accent }]}>
          <Text style={s.siteName}>{site.site}</Text>
          {site.adresse || site.zone ? (
            <Text style={s.siteAddress}>{[site.adresse, site.zone].filter(Boolean).join(' · ')}</Text>
          ) : null}
        </View>
        {first ? <Row r={first} /> : null}
      </View>
      {rest.map((r) => <Row key={r.numero} r={r} />)}
    </View>
  );
}

function ProgrammesDocument({ model, company }) {
  const accent = accentOf(company);
  return (
    <Document title="Programmes – Chantier Gaillac" author={company?.name || ''}>
      {model.pages.map((p) => (
        <Page key={p.key} size="A4" style={sharedStyles.page}>
          <CompanyHeader company={company} />
          <View style={s.titleRow}>
            <View>
              <Text style={[s.title, { color: accent }]}>{p.title}</Text>
              <Text style={s.subtitle}>
                Chantier Gaillac – Préconisations P2 · Mayer Énergie pour Veolia
                {p.date ? '' : ` · ${p.techName ? `${p.techName}, ` : ''}à programmer`}
              </Text>
            </View>
            <Text style={[s.badge, { backgroundColor: accent }]}>{p.code}</Text>
          </View>
          <View style={s.kpis}>
            <Text style={s.kpi}><Text style={s.kpiStrong}>{p.count}</Text> ligne{p.count > 1 ? 's' : ''}</Text>
            <Text style={s.kpi}><Text style={s.kpiStrong}>{p.totalLabel}</Text> accès compris (20 min par site)</Text>
            <Text style={s.kpi}><Text style={s.kpiStrong}>{p.done}</Text> validée{p.done > 1 ? 's' : ''} à l’édition</Text>
          </View>

          {p.sites.map((site) => <Site key={site.site} site={site} accent={accent} />)}

          <View style={s.footer} fixed>
            <Text style={s.footerTxt}>{model.editedLabel}</Text>
            <Text style={s.footerTxt} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
          </View>
        </Page>
      ))}
    </Document>
  );
}

/** Rendu → Blob (point d'entrée de `programmesExport.js`). */
export async function generateProgrammesPdfBlob({ model, company }) {
  return pdf(<ProgrammesDocument model={model} company={company} />).toBlob();
}
