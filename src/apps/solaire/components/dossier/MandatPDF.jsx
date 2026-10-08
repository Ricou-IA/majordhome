// src/apps/solaire/components/dossier/MandatPDF.jsx
// Mandat spécial de représentation (mairie + Enedis) — @react-pdf/renderer, brandé
// buildCompanyInfo (Enedis autorise le modèle sous le logo du mandataire), modèle pur
// buildMandatModel (lib/demarches/mandatModel.js) : ce composant ne fait que rendre.
// ⚠️ Helvetica ne couvre pas tous les glyphes Unicode → texte du modèle déjà PDF-safe,
// cases rendues « [x] » / « [ ] ».
/* eslint-disable react-refresh/only-export-components -- react-pdf : jamais monté dans le DOM, le fast refresh ne s'applique pas */
import { Document, Page, Text, View, Image, StyleSheet, pdf } from '@react-pdf/renderer';
import { buildLegalFooter } from '@lib/orgBranding';
import { C, CompanyHeader, sharedStyles } from '../etude/pdfShared';

const s = StyleSheet.create({
  page: { ...sharedStyles.page, fontSize: 8.2, lineHeight: 1.4 },
  titre: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.bleuF, marginTop: 2 },
  sousTitre: { fontSize: 8.5, color: C.grisTxt, marginBottom: 10 },
  h: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.bleuF, marginTop: 9, marginBottom: 3 },
  p: { marginBottom: 3.5, textAlign: 'justify' },
  partie: { marginBottom: 4 },
  strong: { fontFamily: 'Helvetica-Bold' },
  siteRow: { flexDirection: 'row', marginBottom: 1.5 },
  siteLbl: { width: 120, color: C.grisTxt },
  siteVal: { flex: 1 },
  caseRow: { flexDirection: 'row', marginBottom: 3 },
  caseBox: { width: 16, fontFamily: 'Helvetica-Bold', color: C.bleuM },
  caseTxt: { flex: 1, textAlign: 'justify' },
  sigRow: { flexDirection: 'row', gap: 16, marginTop: 14 },
  sigCol: { flex: 1, border: `0.75px solid ${C.grisBar}`, borderRadius: 3, padding: 8, minHeight: 110 },
  sigTitle: { fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  sigMeta: { fontSize: 7, color: C.grisTxt },
  sigImg: { height: 48, width: 150, objectFit: 'contain', marginTop: 6 },
  sigBlank: { height: 48, marginTop: 6 },
  footer: { position: 'absolute', bottom: 18, left: 32, right: 32, fontSize: 6.3, color: C.grisTxt, textAlign: 'center', borderTop: `0.5px solid ${C.grisBar}`, paddingTop: 4 },
  pageNum: { position: 'absolute', bottom: 8, right: 32, fontSize: 6.3, color: C.grisTxt },
});

/** Octets PNG → data URL (react-pdf accepte les data URI dans Image.src). */
function pngDataUrl(bytes) {
  if (!bytes?.length) return null;
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return `data:image/png;base64,${btoa(bin)}`;
}

function Article({ a }) {
  return (
    <View wrap={false}>
      <Text style={s.h}>Article {a.numero} — {a.titre}</Text>
      {a.paragraphes.map((t, i) => <Text key={i} style={s.p}>{t}</Text>)}
      {a.cases?.map((c, i) => (
        <View key={i} style={s.caseRow}>
          <Text style={s.caseBox}>{c.cochee ? '[x]' : '[ ]'}</Text>
          <Text style={s.caseTxt}>{c.texte}</Text>
        </View>
      ))}
      {a.apres?.map((t, i) => <Text key={`a${i}`} style={s.p}>{t}</Text>)}
    </View>
  );
}

function Signature({ titre, sig, png }) {
  const src = pngDataUrl(png);
  return (
    <View style={s.sigCol}>
      <Text style={s.sigTitle}>{titre}</Text>
      <Text>{sig.nom || ' '}</Text>
      <Text style={s.sigMeta}>{[sig.lieu ? `À ${sig.lieu}` : '', sig.date ? `le ${sig.date}` : ''].filter(Boolean).join(', ')}</Text>
      {src ? <Image src={src} style={s.sigImg} /> : <View style={s.sigBlank} />}
    </View>
  );
}

function MandatDocument({ model, company, signatureMandantPng, signatureMandatairePng }) {
  const legal = buildLegalFooter(company);
  const PageFooter = () => (
    <>
      <Text style={s.footer} fixed>{legal || company.name} — Mandat de représentation, modèle aligné sur Enedis-FOR-RAC_02E</Text>
      <Text style={s.pageNum} fixed render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </>
  );
  return (
    <Document title={`Mandat de représentation — ${model.mandant.nom}`} author={company.name}>
      <Page size="A4" style={s.page}>
        <CompanyHeader company={company} />
        <Text style={s.titre}>{model.titre}</Text>
        <Text style={s.sousTitre}>{model.sousTitre}</Text>

        <Text style={s.h}>Désignation des parties</Text>
        <Text style={s.partie}>
          <Text style={s.strong}>Entre les soussignés :</Text> {model.mandant.nom}{model.mandant.naissance ? `, ${model.mandant.naissance}` : ''}{model.mandant.domicile ? `, domicilié(e) ${model.mandant.domicile}` : ''},
          ci-après désigné(e) « le Mandant », d&apos;une part,
        </Text>
        <Text style={s.partie}>
          <Text style={s.strong}>et</Text> la société {model.mandataire.denomination}{model.mandataire.siege ? `, dont le siège est ${model.mandataire.siege}` : ''}{model.mandataire.rcs ? `, ${model.mandataire.rcs}` : ''},
          représentée par {model.mandataire.signataire}, dûment habilité(e) à cet effet, ci-après désignée « le Mandataire », d&apos;autre part.
          Le Mandant et le Mandataire sont désignés individuellement « Partie » et collectivement « Parties ».
        </Text>

        <Text style={s.h}>Désignation du site et du projet</Text>
        <View style={s.siteRow}><Text style={s.siteLbl}>Adresse du site</Text><Text style={s.siteVal}>{model.site.adresse || 'à préciser'}</Text></View>
        <View style={s.siteRow}><Text style={s.siteLbl}>Références cadastrales</Text><Text style={s.siteVal}>{model.site.parcelles}</Text></View>
        <View style={s.siteRow}><Text style={s.siteLbl}>Nature des opérations</Text><Text style={s.siteVal}>{model.site.nature}</Text></View>
        <View style={s.siteRow}><Text style={s.siteLbl}>Devis de référence</Text><Text style={s.siteVal}>{model.site.devis.replace('Devis de référence : ', '')}</Text></View>

        {model.articles.slice(0, 2).map((a) => <Article key={a.numero} a={a} />)}
        <PageFooter />
      </Page>
      <Page size="A4" style={s.page}>
        <CompanyHeader company={company} />
        {model.articles.slice(2).map((a) => <Article key={a.numero} a={a} />)}
        <Text style={[s.p, { marginTop: 8 }]}>{model.mentionExemplaires}</Text>
        <View style={s.sigRow}>
          <Signature titre="Le Mandant" sig={model.signatures.mandant} png={signatureMandantPng} />
          <Signature titre={`Le Mandataire, ${company.legalName || company.name}`} sig={model.signatures.mandataire} png={signatureMandatairePng} />
        </View>
        <PageFooter />
      </Page>
    </Document>
  );
}

/**
 * @param {{ model: object, company: object, signatureMandantPng?: Uint8Array|null, signatureMandatairePng?: Uint8Array|null }} p
 * @returns {Promise<Blob>}
 */
export async function generateMandatPdfBlob({ model, company, signatureMandantPng = null, signatureMandatairePng = null }) {
  return pdf(
    <MandatDocument model={model} company={company} signatureMandantPng={signatureMandantPng} signatureMandatairePng={signatureMandatairePng} />,
  ).toBlob();
}
