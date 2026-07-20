// src/apps/solaire/components/etude/CoverPage.jsx
// Page de couverture de l'étude — entièrement brandée depuis le profil org
// (couleur d'accent, logo, raison sociale, coordonnées via buildCompanyInfo).
// Aucune valeur hardcodée : une autre entreprise onboardée a SA couverture.
// (Point d'extension : image de couverture org quand la DA arrivera.)
import { Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { formatFullAddress } from '@lib/orgBranding';
import { C, accentOf } from './pdfShared';

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', color: C.noir },
  band: { paddingHorizontal: 40, paddingTop: 40, paddingBottom: 34, height: 360, flexDirection: 'column', justifyContent: 'space-between' },
  logoBox: { backgroundColor: C.blanc, borderRadius: 6, padding: 8, alignSelf: 'flex-start' },
  logo: { width: 96, maxHeight: 54, objectFit: 'contain' },
  brandName: { color: C.blanc, fontSize: 22, fontFamily: 'Helvetica-Bold' },
  title: { color: C.blanc, fontSize: 30, fontFamily: 'Helvetica-Bold', lineHeight: 1.15 },
  subtitle: { color: C.blanc, fontSize: 12, marginTop: 8, opacity: 0.9 },
  body: { padding: 40, flexGrow: 1, justifyContent: 'space-between' },
  kicker: { fontSize: 8, letterSpacing: 1, color: C.grisTxt, fontFamily: 'Helvetica-Bold' },
  clientName: { fontSize: 20, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  clientLine: { fontSize: 10, color: C.grisTxt, marginTop: 2 },
  metaLine: { fontSize: 9, color: C.grisTxt, marginTop: 6 },
  companyName: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  companyLine: { fontSize: 8, color: C.grisTxt, marginTop: 1 },
});

export function CoverPage({ company, meta }) {
  const accent = accentOf(company);
  const address = formatFullAddress(company);
  const contact = [company.phone, company.email].filter(Boolean).join('  ·  ');
  return (
    <Page size="A4" style={s.page}>
      <View style={[s.band, { backgroundColor: accent }]}>
        {company.logoUrl ? (
          <View style={s.logoBox}><Image src={company.logoUrl} style={s.logo} /></View>
        ) : (
          <Text style={s.brandName}>{company.name}</Text>
        )}
        <View>
          <Text style={s.title}>Votre projet{'\n'}photovoltaïque</Text>
          <Text style={s.subtitle}>Étude de rentabilité personnalisée</Text>
        </View>
      </View>

      <View style={s.body}>
        <View>
          <Text style={s.kicker}>PRÉPARÉ POUR</Text>
          <Text style={s.clientName}>{meta.clientName || 'Client'}</Text>
          {meta.clientAddress ? <Text style={s.clientLine}>{meta.clientAddress}</Text> : null}
          <Text style={s.metaLine}>
            {meta.dateLabel}{meta.simRef ? `  ·  Réf. ${meta.simRef}` : ''}
          </Text>
        </View>

        <View>
          <Text style={[s.companyName, { color: accent }]}>{company.name}</Text>
          {address ? <Text style={s.companyLine}>{address}</Text> : null}
          {contact ? <Text style={s.companyLine}>{contact}</Text> : null}
          {company.rgeCertifications?.length > 0 && (
            <Text style={s.companyLine}>Certifications : {company.rgeCertifications.join(', ')}</Text>
          )}
        </View>
      </View>
    </Page>
  );
}
