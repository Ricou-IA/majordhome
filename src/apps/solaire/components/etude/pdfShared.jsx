// src/apps/solaire/components/etude/pdfShared.jsx
// Socle commun des pages de l'étude PDF : palette deutan, formatters PDF-safe
// (Helvetica ne couvre pas tous les glyphes Unicode — espace fine U+202F, U+2212…),
// cartouche société et footer légal. Consommé par EtudePDF et ses pages annexes.
import { Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { formatFullAddress, buildLegalFooter } from '@lib/orgBranding';

export const C = {
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

// Couleur d'accent de l'org (branding multi-tenant) — bandeaux/couverture/nom.
// Les GRAPHIQUES restent en palette deutan (jaunes/bleus), jamais l'accent org.
export const accentOf = (company) => company?.accentColor || C.bleuF;

// Formatters PDF-safe (\s couvre U+202F/U+00A0)
export const fmtInt = (n) => Math.round(n).toLocaleString('fr-FR').replace(/\s/g, ' ');
export const numStr = (x) => String(x).replace('.', ',');
export const eur = (n) => `${fmtInt(n)} €`;
export const kwh = (n) => `${fmtInt(n)} kWh`;
export const pct = (x) => `${Math.round(x * 100)} %`;
export const pct1Pdf = (x) => `${numStr(Math.round(x * 1000) / 10)} %`; // 1 décimale, virgule FR

export const sharedStyles = StyleSheet.create({
  page: { padding: 32, paddingBottom: 52, fontSize: 8, fontFamily: 'Helvetica', color: C.noir },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, paddingBottom: 8, borderBottom: `1.5px solid ${C.bleuF}` },
  companyName: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  companyLine: { fontSize: 7, color: C.grisTxt, marginTop: 1 },
  logo: { width: 64, maxHeight: 40, objectFit: 'contain' },
  sectionTitle: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.bleuF, marginTop: 10, marginBottom: 4, borderBottom: `0.5px solid ${C.grisBar}`, paddingBottom: 2 },
  footer: { position: 'absolute', bottom: 18, left: 32, right: 32, borderTop: `0.5px solid ${C.grisBar}`, paddingTop: 4 },
  footerText: { fontSize: 5.8, color: C.grisTxt, textAlign: 'center' },
});

export function CompanyHeader({ company }) {
  const address = formatFullAddress(company);
  return (
    <View style={sharedStyles.header}>
      <View style={{ flex: 1 }}>
        <Text style={[sharedStyles.companyName, { color: company.accentColor || C.bleuF }]}>{company.name}</Text>
        {address ? <Text style={sharedStyles.companyLine}>{address}</Text> : null}
        <Text style={sharedStyles.companyLine}>
          {[company.phone, company.email].filter(Boolean).join('  ·  ')}
        </Text>
        {company.rgeCertifications?.length > 0 && (
          <Text style={sharedStyles.companyLine}>Certifications : {company.rgeCertifications.join(', ')}</Text>
        )}
      </View>
      {company.logoUrl ? <Image src={company.logoUrl} style={sharedStyles.logo} /> : null}
    </View>
  );
}

export function Footer({ company }) {
  const legal = buildLegalFooter(company);
  return (
    <View style={sharedStyles.footer} fixed>
      {legal ? <Text style={sharedStyles.footerText}>{legal}</Text> : null}
      <Text style={sharedStyles.footerText}>
        Étude indicative, non contractuelle — production estimée via PVGIS (Commission européenne).
        Les données de consommation sont fournies par le client ; les résultats réels peuvent varier
        (météo, prix de l'électricité, comportement de consommation).
      </Text>
    </View>
  );
}
