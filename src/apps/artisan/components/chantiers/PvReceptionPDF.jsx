/**
 * PvReceptionPDF.jsx - PV de Réception des Travaux
 * ============================================================================
 * Template PDF A4 avec @react-pdf/renderer.
 * Inspiré du modèle Qualit'EnR (Procès-verbal Réception des travaux).
 * 2 signatures : client + entreprise. Logo, nom et signature de l'entreprise viennent des
 * réglages de l'organisation (`company` = buildCompanyInfo, `visuels` = images déjà chargées) :
 * aucune valeur propre à une entreprise n'est écrite ici. Sur tablette, le technicien signe
 * lui-même ; en ligne, c'est la signature du signataire de l'organisation qui est posée.
 *
 * Exporté : generatePvReceptionPdfBlob(data, company, visuels) → Blob
 * ============================================================================
 */
/* eslint-disable react-refresh/only-export-components -- react-pdf : jamais monté dans le DOM, le fast refresh ne s'applique pas */

import {
  Document,
  Page,
  Text,
  View,
  Image,
  pdf,
} from '@react-pdf/renderer';

import { GARANTIES_RECEPTION } from '@/lib/pvPoints';

import { C, s, Checkbox, identiteEntreprise, piedLegal, Parties, LignesDevis } from './pvPdfShared';

// ============================================================================
// CONSTANTES
// ============================================================================

// Sans `company` (jamais le cas dans l'app) : un document neutre, pas celui d'une entreprise.
const VIDE = { name: '', address: '', phone: '', email: '', legalName: '', legalForm: '', capital: '', rcs: '', signataire: '' };

// ============================================================================
// COMPOSANT PDF
// ============================================================================

function PvReceptionDocument({ data, company, visuels }) {
  const COMPANY = company ? identiteEntreprise(company) : VIDE;
  const LEGAL_FOOTER = company ? piedLegal(COMPANY) : '';
  const {
    pvNumber,
    pvDate,
    clientName,
    clientAddress,
    clientPostalCode,
    clientCity,
    clientPhone,
    clientEmail,
    equipmentLabel,
    equipmentRef,
    orderAmountHT,
    technicianName,
    receptionType, // 'sans_reserves' | 'avec_reserves'
    reservesNature,
    reservesTravaux,
    infoRecues,
    noticesRecues,
    entretienRecues,
    signatureClientBase64,
    signatureClientNom,
    signatureTechBase64,
    signatureTechNom,
    lieu,
    devis,
    pointsEntreprise,
    pointsClient,
  } = data;
  const pointsEnLigne = Boolean(pointsEntreprise?.length);

  // Signature de l'entreprise : celle du technicien quand il a signé sur tablette, sinon celle du
  // signataire de l'organisation, avec son nom et sa qualité.
  const signatureEntreprise = signatureTechBase64 || visuels?.signatureSrc || null;
  const nomSignataire = signatureTechBase64
    ? signatureTechNom || technicianName
    : COMPANY.signataire || signatureTechNom || technicianName;

  const sansReserves = receptionType === 'sans_reserves';
  const avecReserves = receptionType === 'avec_reserves';

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          {visuels?.logoSrc ? <Image src={visuels.logoSrc} style={s.logo} /> : <View />}
          <View style={s.headerRight}>
            <Text style={s.title}>Procès-Verbal</Text>
            <Text style={s.subtitle}>Réception des Travaux</Text>
          </View>
        </View>

        {/* Ref */}
        <View style={s.refLine}>
          <Text>Réf. : {pvNumber}</Text>
          <Text>Date : {pvDate}</Text>
        </View>

        {/* Parties */}
        <Parties
          entreprise={COMPANY}
          client={{
            name: clientName,
            address: clientAddress,
            postalCode: clientPostalCode,
            city: clientCity,
            phone: clientPhone,
            email: clientEmail,
          }}
        />

        {/* Objet des travaux */}
        <Text style={s.sectionTitle}>Objet des Travaux</Text>
        <View style={s.receptionBox}>
          <Text style={{ fontSize: 9, lineHeight: 1.5 }}>
            Installation et mise en service : {equipmentLabel || 'Équipement'}
          </Text>
          {equipmentRef ? (
            <Text style={{ fontSize: 8, color: C.gris, marginTop: 2 }}>
              Réf. : {equipmentRef}
            </Text>
          ) : null}
          <LignesDevis devis={devis} />
          {orderAmountHT ? (
            <Text style={{ fontSize: 9, marginTop: 4, fontFamily: 'Helvetica-Bold' }}>
              Montant HT : {orderAmountHT}
            </Text>
          ) : null}
        </View>

        {/* Réception */}
        <Text style={s.sectionTitle}>Déclaration de Réception</Text>
        <View style={s.receptionBox}>
          <Text style={{ fontSize: 8, color: C.gris, marginBottom: 5, lineHeight: 1.4 }}>
            Je soussigné(e), {clientName}, maître de l&apos;ouvrage, après avoir procédé à la visite
            des travaux effectués par l&apos;entreprise {COMPANY.name}, déclare :
          </Text>

          <View style={s.checkRow}>
            <Checkbox checked={sansReserves} />
            <Text style={[s.checkLabel, sansReserves && { fontFamily: 'Helvetica-Bold' }]}>
              Accepter la réception des travaux sans réserves
            </Text>
          </View>

          <View style={s.checkRow}>
            <Checkbox checked={avecReserves} />
            <Text style={[s.checkLabel, avecReserves && { fontFamily: 'Helvetica-Bold' }]}>
              Accepter la réception des travaux assortie de réserves
            </Text>
          </View>

          {avecReserves && (reservesNature || reservesTravaux) && (
            <View style={s.reservesBox}>
              {reservesNature ? (
                <>
                  <Text style={s.reservesLabel}>Nature des réserves :</Text>
                  <Text style={s.reservesText}>{reservesNature}</Text>
                </>
              ) : null}
              {reservesTravaux ? (
                <>
                  <Text style={{ ...s.reservesLabel, marginTop: 4 }}>Travaux à exécuter :</Text>
                  <Text style={s.reservesText}>{reservesTravaux}</Text>
                </>
              ) : null}
            </View>
          )}
        </View>

        {/* Points de la déclaration (PV en ligne) ou cases d'avant (PV sur tablette) */}
        {pointsEnLigne ? (
          <>
            <View style={s.pointsBox}>
              <Text style={s.pointsTitle} minPresenceAhead={40}>L’entreprise déclare</Text>
              {pointsEntreprise.map((p, i) => (
                <View key={i} style={s.pointRow} wrap={false}>
                  <Text style={s.pointText}>{p.texte}</Text>
                  <Text style={s.pointAnswer}>{p.reponse}</Text>
                </View>
              ))}
            </View>
            {pointsClient?.length ? (
              <View style={s.pointsBox}>
                <Text style={[s.pointsTitle, { color: C.vert }]} minPresenceAhead={40}>Le client confirme</Text>
                {pointsClient.map((p, i) => (
                  <View key={i} style={s.checkRow} wrap={false}>
                    <Checkbox checked={p.confirme} />
                    <Text style={s.checkLabel}>{p.texte}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <>
          {/* Confirmations */}
          <View style={s.confirmBox}>
            <Text style={s.confirmTitle}>
              Le client reconnaît avoir reçu :
            </Text>
            <View style={s.checkRow}>
              <Checkbox checked={infoRecues} />
              <Text style={s.checkLabel}>
                Les informations nécessaires pour le fonctionnement des matériels installés
              </Text>
            </View>
            <View style={s.checkRow}>
              <Checkbox checked={noticesRecues} />
              <Text style={s.checkLabel}>
                Les notices d&apos;utilisation en français des matériels installés
              </Text>
            </View>
            <View style={s.checkRow}>
              <Checkbox checked={entretienRecues} />
              <Text style={s.checkLabel}>
                Les informations relatives à l&apos;entretien et la maintenance des matériels installés
              </Text>
            </View>
          </View>
          </>
        )}

        {/* Garanties, « Fait à », signatures et note : un seul bloc, jamais coupé. Si le PV déborde
            (réserves longues), les signatures passent à la page suivante AVEC les garanties, jamais seules. */}
        <View wrap={false}>
        <View style={s.garantiesBox}>
          <Text style={s.garantiesTitle}>Garanties</Text>
          {GARANTIES_RECEPTION.map((g, i) => (
            <Text key={i} style={s.garantiesText}>{g}</Text>
          ))}
        </View>

          {/* Date et lieu */}
          <View style={s.dateRow}>
            <Text>Fait à : {lieu || clientCity || '—'}</Text>
            <Text>Le : {pvDate}</Text>
            <Text>En 2 exemplaires</Text>
          </View>

          {/* Signatures */}
          <View style={s.signaturesRow}>
            <View style={s.signatureBlock}>
              <Text style={s.signatureLabel}>Signature de l&apos;entreprise</Text>
              {signatureEntreprise ? (
                <Image src={signatureEntreprise} style={s.signatureImage} />
              ) : (
                <View style={{ height: 34 }} />
              )}
              <Text style={s.signatureName}>{nomSignataire || '—'}</Text>
            </View>
            <View style={s.signatureBlock}>
              <Text style={s.signatureLabel}>Signature du client</Text>
              {signatureClientBase64 ? (
                <Image src={signatureClientBase64} style={s.signatureImage} />
              ) : (
                <View style={{ height: 34 }} />
              )}
              <Text style={s.signatureName}>{signatureClientNom || clientName || '—'}</Text>
            </View>
          </View>

          {/* Note conservation */}
          <View style={s.conservationNote}>
            <Text style={s.conservationText}>
              DOCUMENT À CONSERVER 10 ANS — La réception des travaux est indispensable
              pour faire valoir les garanties légales et les assurances.
            </Text>
          </View>
        </View>

        {/* Footer */}
        <Text style={s.footer} fixed>{LEGAL_FOOTER}</Text>
      </Page>
    </Document>
  );
}

// ============================================================================
// EXPORT : generatePvReceptionPdfBlob
// ============================================================================

/**
 * @param {Object} data     données du PV (`donneesPdfPv`, ou la saisie sur tablette)
 * @param {Object} company  buildCompanyInfo(settings)
 * @param {{ logoSrc?: string|null, signatureSrc?: string|null }} [visuels] logo et signature de l'organisation
 */
export async function generatePvReceptionPdfBlob(data, company, visuels) {
  const blob = await pdf(<PvReceptionDocument data={data} company={company} visuels={visuels} />).toBlob();
  return blob;
}
