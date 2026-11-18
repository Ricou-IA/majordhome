/**
 * PvLeveeReservesPDF.jsx - Procès-verbal de levée des réserves
 * ============================================================================
 * Une page A4. Données = `donneesPdfLevee` (src/lib/pvReception.js) : le composant
 * ne calcule ni ne formate rien. Styles communs avec le PV de réception.
 * Pas de logo : celui du PV est une constante propre à une entreprise.
 *
 * Exporté : generatePvLeveePdfBlob(data, company) → Blob
 * ============================================================================
 */
/* eslint-disable react-refresh/only-export-components -- react-pdf : jamais monté dans le DOM, le fast refresh ne s'applique pas */

import { Document, Page, Text, View, Image, pdf } from '@react-pdf/renderer';

import { s, identiteEntreprise, piedLegal, Parties, LignesDevis } from './pvPdfShared';

const VIDE = { name: '', address: '', phone: '', email: '', legalName: '', legalForm: '', capital: '', rcs: '' };

function PvLeveeDocument({ data, company }) {
  const COMPANY = company ? identiteEntreprise(company) : VIDE;
  const {
    numero,
    date,
    pvNumber,
    pvDate,
    clientName,
    clientAddress,
    clientPostalCode,
    clientCity,
    equipmentLabel,
    devis,
    reservesNature,
    reservesTravaux,
    reponse,
    echeance,
    signatureNom,
    signatureBase64,
    lieu,
  } = data;

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View />
          <View style={s.headerRight}>
            <Text style={s.title}>Procès-Verbal</Text>
            <Text style={s.subtitle}>Levée des réserves</Text>
          </View>
        </View>

        <View style={s.refLine}>
          <Text>Réf. : {numero}</Text>
          <Text>Date : {date}</Text>
        </View>

        <Parties
          entreprise={COMPANY}
          client={{ name: clientName, address: clientAddress, postalCode: clientPostalCode, city: clientCity }}
        />

        <Text style={{ ...s.bodyText, marginBottom: 10 }}>
          Levée des réserves du procès-verbal de réception {pvNumber} du {pvDate}
        </Text>

        <Text style={s.sectionTitle}>Objet des Travaux</Text>
        <View style={s.receptionBox}>
          <Text style={s.bodyText}>Installation et mise en service : {equipmentLabel || 'Équipement'}</Text>
          <LignesDevis devis={devis} />
        </View>

        <Text style={s.sectionTitle}>Réserves du client</Text>
        <View style={s.receptionBox}>
          {reservesNature ? (
            <>
              <Text style={s.reservesLabel}>Nature des réserves :</Text>
              <Text style={s.bodyText}>{reservesNature}</Text>
            </>
          ) : null}
          {reservesTravaux ? (
            <>
              <Text style={{ ...s.reservesLabel, marginTop: 6 }}>Travaux à exécuter :</Text>
              <Text style={s.bodyText}>{reservesTravaux}</Text>
            </>
          ) : null}
        </View>

        {reponse || echeance ? (
          <>
            <Text style={s.sectionTitle}>Réponse de l&apos;entreprise</Text>
            <View style={s.receptionBox}>
              {reponse ? <Text style={s.bodyText}>{reponse}</Text> : null}
              {echeance ? (
                <Text style={{ ...s.bodyText, fontFamily: 'Helvetica-Bold', marginTop: reponse ? 4 : 0 }}>
                  Engagement : réserves levées avant le {echeance}
                </Text>
              ) : null}
            </View>
          </>
        ) : null}

        <Text style={{ ...s.bodyText, fontFamily: 'Helvetica-Bold', marginTop: 4 }}>
          Le client constate que les réserves ci-dessus sont levées.
        </Text>

        <View style={s.dateRow}>
          <Text>Fait à : {lieu || clientCity || '—'}</Text>
          <Text>Le : {date}</Text>
        </View>

        <View style={s.signaturesRow} wrap={false}>
          <View style={s.signatureBlock}>
            <Text style={s.signatureLabel}>Signature du client</Text>
            {signatureBase64 ? (
              <Image src={signatureBase64} style={s.signatureImage} />
            ) : (
              <View style={{ height: 60 }} />
            )}
            <Text style={s.signatureName}>{signatureNom || clientName || '—'}</Text>
          </View>
        </View>

        {COMPANY.legalName ? <Text style={s.footer} fixed>{piedLegal(COMPANY)}</Text> : null}
      </Page>
    </Document>
  );
}

export async function generatePvLeveePdfBlob(data, company) {
  const blob = await pdf(<PvLeveeDocument data={data} company={company} />).toBlob();
  return blob;
}
