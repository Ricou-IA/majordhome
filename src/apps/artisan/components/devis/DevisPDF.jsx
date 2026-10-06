/**
 * DevisPDF.jsx — Template PDF devis (@react-pdf/renderer)
 * ============================================================================
 * Ne calcule ni ne formate RIEN : il dessine le modèle produit par
 * `buildDevisDocumentModel` (src/lib/devisDocumentModel.js), la même source que
 * l'aperçu de Settings → Devis. Ajouter une zone = l'ajouter au modèle (et à
 * ZONES), puis ici ET dans ApercuDevis.jsx.
 * ============================================================================
 */
/* eslint-disable react-refresh/only-export-components -- react-pdf : jamais monté dans le DOM, le fast refresh ne s'applique pas */

import { Document, Page, Text, View, Image, StyleSheet, pdf } from '@react-pdf/renderer';

// ============================================================================
// STYLES
// ============================================================================

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica', color: '#1a1a1a' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  title: { fontSize: 24, fontWeight: 'bold' },
  subtitle: { fontSize: 10, color: '#666', marginTop: 4 },
  logo: { width: 110, height: 50, objectFit: 'contain', marginBottom: 6, alignSelf: 'flex-end' },
  partiesRow: { flexDirection: 'row', gap: 20, marginBottom: 16 },
  partyBox: { flex: 1, padding: 12, backgroundColor: '#f9fafb', borderRadius: 4 },
  partyTitle: { fontSize: 8, fontWeight: 'bold', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  partyText: { fontSize: 9, lineHeight: 1.5 },
  subjectBox: { backgroundColor: '#fff7ed', padding: 10, borderRadius: 4, marginBottom: 12 },
  subjectLabel: { fontSize: 8, fontWeight: 'bold', color: '#9ca3af', textTransform: 'uppercase', marginBottom: 4 },
  subjectText: { fontSize: 10, fontWeight: 'bold' },
  paragraphe: { fontSize: 9, lineHeight: 1.5, color: '#374151', marginBottom: 10 },
  tableHeader: { flexDirection: 'row', color: '#fff', padding: '6 8', borderRadius: 2, fontSize: 8, fontWeight: 'bold' },
  tableRow: { flexDirection: 'row', padding: '5 8', borderBottomWidth: 0.5, borderBottomColor: '#e5e7eb', fontSize: 9 },
  tableRowAlt: { backgroundColor: '#fafafa' },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', padding: '6 8', backgroundColor: '#f3f4f6', fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase', color: '#6b7280', letterSpacing: 0.5 },
  lineDescription: { fontSize: 7.5, color: '#6b7280', marginTop: 1 },
  colDesignation: { flex: 4 },
  colRef: { flex: 1.5 },
  colQty: { flex: 1, textAlign: 'center' },
  colPU: { flex: 1.5, textAlign: 'right' },
  colTVA: { flex: 1, textAlign: 'center' },
  colTotal: { flex: 1.5, textAlign: 'right' },
  totalsBox: { marginTop: 16, marginLeft: 'auto', width: 220 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, fontSize: 9 },
  totalRowBold: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, fontSize: 12, fontWeight: 'bold', borderTopWidth: 1, borderTopColor: '#d1d5db', marginTop: 4 },
  validityText: { marginTop: 16, fontSize: 9, color: '#6b7280', fontStyle: 'italic' },
  bloc: { marginTop: 14, padding: 10, backgroundColor: '#f9fafb', borderRadius: 4 },
  blocTitle: { fontSize: 8, fontWeight: 'bold', color: '#9ca3af', textTransform: 'uppercase', marginBottom: 4 },
  blocText: { fontSize: 8, lineHeight: 1.6, color: '#4b5563' },
  mentionText: { marginTop: 12, fontSize: 9, fontWeight: 'bold', color: '#374151' },
  signatureBox: { marginTop: 24, flexDirection: 'row', justifyContent: 'flex-end' },
  signatureZone: { width: 200, padding: 12, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 4 },
  signatureLabel: { fontSize: 8, fontWeight: 'bold', color: '#6b7280', marginBottom: 30 },
  signatureLine: { borderTopWidth: 0.5, borderTopColor: '#9ca3af', paddingTop: 4, fontSize: 8, color: '#9ca3af' },
  footer: { position: 'absolute', bottom: 25, left: 40, right: 40, fontSize: 7, color: '#9ca3af', textAlign: 'center', borderTopWidth: 0.5, borderTopColor: '#e5e7eb', paddingTop: 8 },
});

// ============================================================================
// DOCUMENT
// ============================================================================

/** @param {{ model: ReturnType<import('@/lib/devisDocumentModel').buildDevisDocumentModel> }} p */
function DevisDocument({ model: m }) {
  const accent = m.emetteur.couleur;
  const col = m.tableau.colonnes;
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={[s.title, { color: accent }]}>{m.entete.titre}</Text>
            {m.entete.numero ? <Text style={s.subtitle}>{m.entete.numero}</Text> : null}
            {m.entete.date ? <Text style={s.subtitle}>{m.entete.date}</Text> : null}
          </View>
          <View style={{ textAlign: 'right', alignItems: 'flex-end' }}>
            {m.logo.url ? <Image src={m.logo.url} style={s.logo} /> : null}
            <Text style={{ fontSize: 14, fontWeight: 'bold', color: accent }}>{m.emetteur.nom}</Text>
            {m.emetteur.lignes.slice(0, 2).map((l, i) => <Text key={i} style={s.subtitle}>{l}</Text>)}
          </View>
        </View>

        <View style={s.partiesRow}>
          <View style={s.partyBox}>
            <Text style={s.partyTitle}>Prestataire</Text>
            <Text style={s.partyText}>{m.emetteur.nom}</Text>
            {m.emetteur.lignes.map((l, i) => <Text key={i} style={s.partyText}>{l}</Text>)}
          </View>
          <View style={s.partyBox}>
            <Text style={s.partyTitle}>Client</Text>
            {m.client.lignes.length ? m.client.lignes.map((l, i) => <Text key={i} style={s.partyText}>{l}</Text>) : <Text style={s.partyText}>—</Text>}
          </View>
        </View>

        {m.objet.texte ? (
          <View style={s.subjectBox}>
            <Text style={s.subjectLabel}>Objet</Text>
            <Text style={s.subjectText}>{m.objet.texte}</Text>
          </View>
        ) : null}

        {m.intro.lignes.map((l, i) => <Text key={`i${i}`} style={s.paragraphe}>{l}</Text>)}
        {m.acompte.lignes.map((l, i) => <Text key={`a${i}`} style={s.paragraphe}>{l}</Text>)}

        <View style={[s.tableHeader, { backgroundColor: accent }]}>
          <Text style={s.colDesignation}>Désignation</Text>
          {col.reference ? <Text style={s.colRef}>Réf.</Text> : null}
          <Text style={s.colQty}>Qté</Text>
          {col.prix_unitaire ? <Text style={s.colPU}>P.U. HT</Text> : null}
          {col.tva ? <Text style={s.colTVA}>TVA</Text> : null}
          <Text style={s.colTotal}>Total HT</Text>
        </View>

        {m.tableau.chapitres.map((c, ci) => (
          <View key={ci}>
            {c.titre ? (
              <View style={s.sectionRow}>
                <Text>{c.titre}</Text>
                {!col.detail ? <Text>{c.sous_total}</Text> : null}
              </View>
            ) : null}
            {c.lignes.map((l, i) => (
              <View key={i} style={[s.tableRow, i % 2 === 1 && s.tableRowAlt]}>
                <View style={s.colDesignation}>
                  <Text>{l.designation}</Text>
                  {l.description ? <Text style={s.lineDescription}>{l.description}</Text> : null}
                </View>
                {col.reference ? <Text style={s.colRef}>{l.reference}</Text> : null}
                <Text style={s.colQty}>{l.quantite}</Text>
                {col.prix_unitaire ? <Text style={s.colPU}>{l.prix_unitaire}</Text> : null}
                {col.tva ? <Text style={s.colTVA}>{l.tva}</Text> : null}
                <Text style={s.colTotal}>{l.total}</Text>
              </View>
            ))}
          </View>
        ))}

        <View style={s.totalsBox}>
          {m.totaux.lignes.map((l, i) => (
            <View key={i} style={l.libelle === 'Total TTC' ? s.totalRowBold : s.totalRow}>
              <Text style={l.gras ? { fontWeight: 'bold' } : undefined}>{l.libelle}</Text>
              <Text style={l.gras ? { fontWeight: 'bold' } : undefined}>{l.valeur}</Text>
            </View>
          ))}
        </View>

        <Text style={s.validityText}>{m.validite.texte}</Text>

        {m.conditions.lignes.length ? (
          <View style={s.bloc}>
            <Text style={s.blocTitle}>{m.conditions.titre}</Text>
            {m.conditions.lignes.map((l, i) => <Text key={i} style={s.blocText}>{l}</Text>)}
          </View>
        ) : null}

        {m.mention_speciale.lignes.map((l, i) => <Text key={`m${i}`} style={s.mentionText}>{l}</Text>)}

        {m.paiement.visible ? (
          <View style={s.bloc}>
            <Text style={s.blocTitle}>Paiement</Text>
            {m.paiement.etablissement ? <Text style={s.blocText}>Établissement : {m.paiement.etablissement}</Text> : null}
            <Text style={s.blocText}>IBAN : {m.paiement.iban}</Text>
            {m.paiement.bic ? <Text style={s.blocText}>BIC : {m.paiement.bic}</Text> : null}
            {m.paiement.texte ? <Text style={s.blocText}>{m.paiement.texte}</Text> : null}
          </View>
        ) : null}

        <View style={s.signatureBox}>
          <View style={s.signatureZone}>
            <Text style={s.signatureLabel}>{m.signature.libelle}</Text>
            <Text style={s.signatureLine}>{m.signature.sous_libelle}</Text>
          </View>
        </View>

        <Text style={s.footer}>{m.pied_de_page.texte}</Text>
      </Page>
    </Document>
  );
}

// ============================================================================
// EXPORT
// ============================================================================

/** @param {object} model  buildDevisDocumentModel(...) */
export async function generateDevisPdfBlob(model) {
  return pdf(<DevisDocument model={model} />).toBlob();
}

export default DevisDocument;
