/* eslint-disable react-refresh/only-export-components -- module de rendu PDF (blob), rien n'est monté dans l'app */
// src/apps/artisan/components/facturation/InvoicePDF.jsx
// ============================================================================
// PDF d'une facture émise par Majord'home (hub de facturation phase 1, spec
// 2026-09-22). Ce composant NE CALCULE ET NE FORMATE RIEN : il dessine le modèle
// produit par `buildInvoicePdfModel` (src/lib/invoiceDocumentModel.js) — un
// chiffre du PDF absent de ce modèle est un bug du modèle, pas d'ici.
// Socle graphique commun : src/lib/pdfShared.jsx (Helvetica : glyphes cp1252 only).
// ============================================================================
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import { C, sharedStyles, CompanyHeader, accentOf } from '@lib/pdfShared';

const s = StyleSheet.create({
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 4, marginBottom: 10 },
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold' },
  number: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  meta: { fontSize: 7.5, color: C.grisTxt, marginTop: 2 },
  blocks: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  block: { flex: 1, border: `0.7px solid ${C.grisBar}`, borderRadius: 4, padding: 7 },
  blockLabel: { fontSize: 6.5, color: C.grisTxt, marginBottom: 3 },
  blockLine: { fontSize: 8 },
  subject: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  th: { flexDirection: 'row', paddingVertical: 3, borderBottom: `0.7px solid ${C.grisBar}` },
  tr: { flexDirection: 'row', paddingVertical: 4, borderBottom: `0.4px solid ${C.grisClair}` },
  cLabel: { flex: 1 },
  cQty: { width: 34, textAlign: 'right' },
  cUnit: { width: 62, textAlign: 'right' },
  cVat: { width: 40, textAlign: 'right' },
  cHt: { width: 66, textAlign: 'right' },
  desc: { fontSize: 6.8, color: C.grisTxt, marginTop: 1 },
  totalsRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  totals: { width: 220 },
  totLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  totLabel: { fontSize: 7.5, color: C.grisTxt },
  totValue: { fontSize: 7.5 },
  totTtc: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, marginTop: 3, borderTop: `0.9px solid ${C.noir}` },
  totTtcTxt: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  discount: { fontSize: 7, color: C.grisTxt, marginTop: 4, textAlign: 'right' },
  para: { fontSize: 7, marginTop: 3 },
  legal: { fontSize: 6.5, color: C.grisTxt, marginTop: 2 },
});

function Th({ children, style }) { return <Text style={[sharedStyles.th, style]}>{children}</Text>; }
function Td({ children, style }) { return <Text style={[sharedStyles.td, style]}>{children}</Text>; }

/** @param {{ model: ReturnType<import('@/lib/invoiceDocumentModel').buildInvoicePdfModel>, company: object }} p */
export function InvoiceDocument({ model, company }) {
  const accent = accentOf(company);
  return (
    <Document title={`${model.title} ${model.number}`} author={company.name}>
      <Page size="A4" style={sharedStyles.page}>
        <CompanyHeader company={company} />

        <View style={s.titleRow}>
          <View>
            <Text style={[s.title, { color: accent }]}>{model.title}</Text>
            {model.creditedNumber ? <Text style={s.meta}>Avoir sur la facture {model.creditedNumber}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.number}>N° {model.number}</Text>
            <Text style={s.meta}>Date : {model.dates.invoice}</Text>
            <Text style={s.meta}>Échéance : {model.dates.due}</Text>
          </View>
        </View>

        <View style={s.blocks}>
          <View style={s.block}>
            <Text style={s.blockLabel}>Émetteur</Text>
            <Text style={s.blockLine}>{company.legalName || company.name}</Text>
            {model.companyAddress ? <Text style={s.blockLine}>{model.companyAddress}</Text> : null}
            {company.siret ? <Text style={s.blockLine}>SIRET {company.siret}</Text> : null}
            {company.tvaIntra ? <Text style={s.blockLine}>TVA {company.tvaIntra}</Text> : null}
          </View>
          <View style={s.block}>
            <Text style={s.blockLabel}>Client</Text>
            {model.customer.map((line, i) => <Text key={i} style={s.blockLine}>{line}</Text>)}
          </View>
        </View>

        {model.subject ? <Text style={s.subject}>{model.subject}</Text> : null}

        <View style={s.th}>
          <Th style={s.cLabel}>Désignation</Th>
          <Th style={s.cQty}>Qté</Th>
          <Th style={s.cUnit}>PU HT</Th>
          <Th style={s.cVat}>TVA</Th>
          <Th style={s.cHt}>Total HT</Th>
        </View>
        {model.rows.map((r, i) => (
          <View key={i} style={s.tr} wrap={false}>
            <View style={s.cLabel}>
              <Td>{r.label}</Td>
              {r.description ? <Text style={s.desc}>{r.description}</Text> : null}
            </View>
            <Td style={s.cQty}>{r.qty}</Td>
            <Td style={s.cUnit}>{r.unitHt}</Td>
            <Td style={s.cVat}>{r.vat}</Td>
            <Td style={s.cHt}>{r.ht}</Td>
          </View>
        ))}

        <View style={s.totalsRow}>
          <View style={s.totals}>
            <View style={s.totLine}><Text style={s.totLabel}>Total HT</Text><Text style={s.totValue}>{model.totals.ht}</Text></View>
            {model.vatRows.map((v, i) => (
              <View key={i} style={s.totLine}><Text style={s.totLabel}>TVA {v.rate} sur {v.base}</Text><Text style={s.totValue}>{v.amount}</Text></View>
            ))}
            <View style={s.totTtc}><Text style={s.totTtcTxt}>Total TTC</Text><Text style={s.totTtcTxt}>{model.totals.ttc}</Text></View>
            {model.discountLine ? <Text style={s.discount}>{model.discountLine}</Text> : null}
          </View>
        </View>

        <View style={{ marginTop: 14 }}>
          <Text style={[sharedStyles.sectionTitle, { color: accent }]}>Règlement</Text>
          {model.payment.map((p, i) => <Text key={i} style={s.para}>{p}</Text>)}
          {model.legal.map((l, i) => <Text key={i} style={s.legal}>{l}</Text>)}
          {model.rge ? <Text style={s.legal}>{model.rge}</Text> : null}
        </View>

        <View style={sharedStyles.footer} fixed>
          <Text style={sharedStyles.footerText}>{model.footer}</Text>
          <Text style={sharedStyles.pageNum} render={({ pageNumber, totalPages }) => `${model.number} — page ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Blob PDF d'une facture émise. Point d'entrée unique du rendu. */
export async function generateInvoicePdfBlob(pdfModel, company) {
  return pdf(<InvoiceDocument model={pdfModel} company={company} />).toBlob();
}
