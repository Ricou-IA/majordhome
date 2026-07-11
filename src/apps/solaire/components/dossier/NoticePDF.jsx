// src/apps/solaire/components/dossier/NoticePDF.jsx
// Notice descriptive du projet PV (pièce jointe de la déclaration préalable) —
// @react-pdf/renderer, brandée buildCompanyInfo, modèle pur buildNoticeModel (dossierDocs.js).
// ⚠️ Helvetica ne couvre pas tous les glyphes Unicode → formatters PDF-safe (charte projet).
import { Document, Page, Text, View, Image, StyleSheet, pdf } from '@react-pdf/renderer';
import { formatFullAddress, buildLegalFooter } from '@lib/orgBranding';

// Palette deutan stricte (identique EtudePDF)
const C = {
  jaune: '#F5C542',
  bleuF: '#0D47A1',
  grisTxt: '#6B7280',
  grisClair: '#F3F4F6',
  noir: '#1F2937',
};

// Formatters PDF-safe (copie EtudePDF — \s couvre U+202F/U+00A0)
const fmtInt = (n) => Math.round(n).toLocaleString('fr-FR').replace(/\s/g, ' ');
const numStr = (x) => String(x).replace('.', ',');

const s = StyleSheet.create({
  page: { padding: 32, paddingBottom: 52, fontSize: 9, fontFamily: 'Helvetica', color: C.noir },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14, paddingBottom: 10, borderBottom: `1.5px solid ${C.bleuF}` },
  companyName: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  companyLine: { fontSize: 7.5, color: C.grisTxt, marginTop: 1.5 },
  logo: { width: 64, height: 32, objectFit: 'contain' },
  title: { fontSize: 12.5, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  subtitle: { fontSize: 8.5, color: C.grisTxt, marginBottom: 12 },
  sectionTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.bleuF, marginTop: 12, marginBottom: 5, paddingBottom: 2, borderBottom: `0.75px solid ${C.grisClair}` },
  p: { lineHeight: 1.45, marginBottom: 4 },
  row: { flexDirection: 'row', paddingVertical: 2.5, borderBottom: `0.5px solid ${C.grisClair}` },
  cellLabel: { width: '38%', color: C.grisTxt },
  cellValue: { width: '62%' },
  abfBox: { backgroundColor: '#FFF8E1', border: `1px solid ${C.jaune}`, borderRadius: 3, padding: 7, marginTop: 6 },
  footer: { position: 'absolute', bottom: 18, left: 32, right: 32, fontSize: 6.5, color: C.grisTxt, textAlign: 'center', borderTop: `0.5px solid ${C.grisClair}`, paddingTop: 5 },
});

function Row({ label, children }) {
  return (
    <View style={s.row}>
      <Text style={s.cellLabel}>{label}</Text>
      <Text style={s.cellValue}>{children}</Text>
    </View>
  );
}

function NoticeDocument({ model, company, dateLabel }) {
  const address = formatFullAddress(company);
  return (
    <Document title={`Notice descriptive — ${model.client.name}`} author={company.name}>
      <Page size="A4" style={s.page}>
        {/* Cartouche société */}
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={[s.companyName, { color: company.accentColor || C.bleuF }]}>{company.name}</Text>
            {address ? <Text style={s.companyLine}>{address}</Text> : null}
            <Text style={s.companyLine}>{[company.phone, company.email].filter(Boolean).join('  ·  ')}</Text>
            {company.rgeCertifications?.length > 0 && (
              <Text style={s.companyLine}>Certifications : {company.rgeCertifications.join(', ')}</Text>
            )}
          </View>
          {company.logoUrl ? <Image src={company.logoUrl} style={s.logo} /> : null}
        </View>

        <Text style={s.title}>Notice descriptive du projet photovoltaïque</Text>
        <Text style={s.subtitle}>
          Pièce jointe à la déclaration préalable (CERFA 16702) — {model.client.name}
          {dateLabel ? ` — ${dateLabel}` : ''}
        </Text>

        {/* Le terrain */}
        <Text style={s.sectionTitle}>1. Le terrain</Text>
        <Row label="Adresse">{model.terrain.adresse || '—'}</Row>
        {model.terrain.commune ? <Row label="Commune">{model.terrain.commune}</Row> : null}
        {model.terrain.parcelles.length > 0 && (
          <Row label="Références cadastrales">
            {model.terrain.parcelles
              .map((p) => `${p.ref}${p.superficie_m2 != null ? ` (${fmtInt(p.superficie_m2)} m²)` : ''}`)
              .join(' · ')}
          </Row>
        )}
        {model.terrain.superficieTotaleM2 != null && (
          <Row label="Superficie totale">{fmtInt(model.terrain.superficieTotaleM2)} m²</Row>
        )}

        {/* Le projet */}
        <Text style={s.sectionTitle}>2. Le projet</Text>
        <Row label="Installation">
          {model.projet.panels} modules photovoltaïques — {numStr(model.projet.kwc)} kWc
        </Row>
        <Row label="Matériel">{model.projet.materiel}</Row>
        <Row label="Aspect">{model.projet.aspectLabel}</Row>
        <Row label="Mode de pose">Surimposition à la toiture existante (épaisseur &lt; 15 cm)</Row>
        {model.projet.pans?.length > 0 && (
          <Row label="Pans concernés">
            {model.projet.pans
              .map((p, i) => `Pan ${i + 1} : pente ${p.pitchDeg != null ? `${p.pitchDeg}°` : '—'}, orientation ${p.orientation}${p.slopeAreaM2 != null ? `, ${fmtInt(p.slopeAreaM2)} m²` : ''}`)
              .join(' · ')}
          </Row>
        )}
        <Text style={[s.p, { marginTop: 6 }]}>{model.projet.description}</Text>

        {/* Insertion paysagère */}
        <Text style={s.sectionTitle}>3. Insertion dans l'environnement</Text>
        {model.insertion.paragraphs.map((para, i) => (
          <Text key={i} style={s.p}>{para}</Text>
        ))}
        {model.insertion.abfProtege && (
          <View style={s.abfBox}>
            <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 8.5 }}>
              Secteur protégé — {model.insertion.protectionsLabel || 'périmètre patrimonial'}
            </Text>
            <Text style={{ fontSize: 8, marginTop: 2, lineHeight: 1.4 }}>
              Délai d'instruction susceptible d'être porté à 2 mois (avis de l'Architecte des Bâtiments de France).
            </Text>
          </View>
        )}

        <Text style={s.footer} fixed>{buildLegalFooter(company)}</Text>
      </Page>
    </Document>
  );
}

/** Modèle (buildNoticeModel) + company → Blob PDF. */
export async function generateNoticePdfBlob({ model, company, dateLabel }) {
  return pdf(<NoticeDocument model={model} company={company} dateLabel={dateLabel} />).toBlob();
}
