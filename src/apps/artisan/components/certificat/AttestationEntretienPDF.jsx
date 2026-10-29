// src/apps/artisan/components/certificat/AttestationEntretienPDF.jsx
// Attestation d'entretien et de ramonage, mise en lettre (modèle validé par Eric, GARDERES 14/09/2026).
// Ne calcule ni ne formate rien : tout le texte vient de `buildAttestationEntretien`
// (src/lib/attestationEntretienModel.js). Logo et signature arrivent en data URL (chargés par
// l'appelant) ; absents, le document reste lisible sans eux.
/* eslint-disable react-refresh/only-export-components -- react-pdf : jamais monté dans le DOM, le fast refresh ne s'applique pas */
import { Document, Page, Text, View, Image, StyleSheet, pdf } from '@react-pdf/renderer';
import { buildLegalFooter } from '@lib/orgBranding';

const C = { noir: '#1f2937', gris: '#6b7280', grisClair: '#e5e7eb', fond: '#f3f4f6' };

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingHorizontal: 56, paddingBottom: 64, fontSize: 10, fontFamily: 'Helvetica', color: C.noir },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 14, borderBottomWidth: 1 },
  logoZone: { flexDirection: 'row', alignItems: 'stretch', gap: 14 },
  accentBar: { width: 3 },
  logo: { width: 120, maxHeight: 70, objectFit: 'contain' },
  company: { alignItems: 'flex-end' },
  companyName: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  companyLine: { fontSize: 8, color: C.gris, lineHeight: 1.35 },
  lieuDate: { marginTop: 22, textAlign: 'right', color: C.gris },
  destinataire: { alignSelf: 'flex-end', width: 200, marginTop: 6, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: C.fond, borderLeftWidth: 1, borderLeftColor: C.gris },
  destLine: { fontSize: 10, lineHeight: 1.35 },
  destLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.gris, marginBottom: 2 },
  objet: { marginTop: 26, fontFamily: 'Helvetica-Bold' },
  objetLabel: { fontFamily: 'Helvetica', color: C.gris },
  references: { marginTop: 8, fontSize: 9.5, lineHeight: 1.4 },
  salutation: { marginTop: 10 },
  para: { marginTop: 9, fontSize: 10, lineHeight: 1.45, textAlign: 'justify' },
  bold: { fontFamily: 'Helvetica-Bold' },
  faitA: { marginTop: 14 },
  sigBloc: { alignSelf: 'flex-end', width: 200, marginTop: 18, alignItems: 'center' },
  sigEntreprise: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  sigNom: { fontSize: 9.5 },
  sigFonction: { fontSize: 8, color: C.gris },
  sigImg: { marginTop: 6, maxWidth: 180, maxHeight: 60, objectFit: 'contain' },
  footer: { position: 'absolute', bottom: 24, left: 56, right: 56, borderTopWidth: 0.5, borderTopColor: C.grisClair, paddingTop: 5 },
  footerText: { fontSize: 7, color: C.gris, textAlign: 'center' },
});

// Pas de césure : un nom de marque ou une adresse e-mail coupés (« EDILKA-MIN ») se lisent mal.
const sansCesure = (word) => [word];

function Paragraphe({ segments }) {
  return (
    <Text style={s.para} hyphenationCallback={sansCesure}>
      {segments.map((seg, i) => (
        <Text key={i} style={seg.bold ? s.bold : null}>{seg.text}</Text>
      ))}
    </Text>
  );
}

/**
 * @param {{ lettre: object, company: object, logoSrc?: string|null, signatureSrc?: string|null }} p
 */
function AttestationEntretienDocument({ lettre, company, logoSrc = null, signatureSrc = null }) {
  const accent = company.accentColor || '#64748b';
  const adresse = [company.address, [company.postalCode, company.city].filter(Boolean).join(' ')].filter(Boolean).join(' - ');
  return (
    <Document title={`Attestation d'entretien - ${lettre.destinataire[0] || ''}`} author={company.name}>
      <Page size="A4" style={s.page}>
        <View style={[s.header, { borderBottomColor: accent }]}>
          <View style={s.logoZone}>
            <View style={[s.accentBar, { backgroundColor: accent }]} />
            {logoSrc ? <Image src={logoSrc} style={s.logo} /> : <Text style={[s.companyName, { color: accent, fontSize: 14 }]}>{company.name}</Text>}
          </View>
          <View style={s.company}>
            <Text style={[s.companyName, { color: accent }]}>{(company.legalName || company.name || '').toUpperCase()}</Text>
            {[company.legalForm, company.capital ? `au capital de ${company.capital} €` : null].filter(Boolean).length > 0 && (
              <Text style={s.companyLine}>{[company.legalForm, company.capital ? `au capital de ${company.capital} €` : null].filter(Boolean).join(' ')}</Text>
            )}
            {adresse ? <Text style={s.companyLine}>{adresse}</Text> : null}
            {company.phone ? <Text style={s.companyLine}>Tél. {company.phone}</Text> : null}
            {company.email ? <Text style={s.companyLine}>{company.email}</Text> : null}
            {company.websiteUrl ? <Text style={[s.companyLine, { color: accent }]}>{company.websiteUrl.replace(/^https?:\/\//, '')}</Text> : null}
          </View>
        </View>

        <Text style={s.lieuDate}>{lettre.lieuDate}</Text>
        <View style={s.destinataire}>
          <Text style={s.destLabel}>À l’attention de :</Text>
          {lettre.destinataire.map((l, i) => <Text key={i} style={s.destLine}>{l}</Text>)}
        </View>

        <Text style={s.objet}><Text style={s.objetLabel}>Objet : </Text>{lettre.objet}</Text>
        <Text style={s.references} hyphenationCallback={sansCesure}>{lettre.references}</Text>
        <Text style={s.salutation}>{lettre.salutation}</Text>

        {lettre.paragraphes.map((p, i) => <Paragraphe key={i} segments={p} />)}

        <Text style={s.faitA}>{lettre.faitA}</Text>

        <View style={s.sigBloc} wrap={false}>
          <Text style={[s.sigEntreprise, { color: accent }]}>{lettre.signataire.entreprise}</Text>
          <Text style={s.sigNom}>{lettre.signataire.nom}</Text>
          {lettre.signataire.fonction ? <Text style={s.sigFonction}>{lettre.signataire.fonction}</Text> : null}
          {signatureSrc ? <Image src={signatureSrc} style={s.sigImg} /> : null}
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerText} hyphenationCallback={sansCesure}>{buildLegalFooter(company)}</Text>
        </View>
      </Page>
    </Document>
  );
}

/**
 * @param {{ lettre: object, company: object, logoSrc?: string|null, signatureSrc?: string|null }} p
 * @returns {Promise<Blob>}
 */
export async function generateAttestationPdfBlob(p) {
  return pdf(<AttestationEntretienDocument {...p} />).toBlob();
}
