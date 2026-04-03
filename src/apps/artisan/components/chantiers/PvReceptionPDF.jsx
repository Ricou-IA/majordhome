/**
 * PvReceptionPDF.jsx - PV de Réception des Travaux
 * ============================================================================
 * Template PDF A4 avec @react-pdf/renderer.
 * Inspiré du modèle Qualit'EnR (Procès-verbal Réception des travaux).
 * 2 signatures : client + technicien.
 *
 * Exporté : generatePvReceptionPdfBlob(data) → Blob
 * ============================================================================
 */

import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  pdf,
} from '@react-pdf/renderer';

import { LOGO_BASE64 } from '../contrat/logo-base64';

// ============================================================================
// CONSTANTES
// ============================================================================

const COMPANY = {
  name: 'Mayer Énergie',
  legalName: 'MAYER ENERGIE',
  legalForm: 'SAS à associé unique',
  capital: '6 000',
  rcs: '100 288 224 R.C.S. Albi',
  address: '26 Rue des Pyrénées – 81600 Gaillac',
  phone: '05 63 33 23 14',
  email: 'contact@mayer-energie.fr',
};

const LEGAL_FOOTER = `${COMPANY.legalName} — ${COMPANY.legalForm}, capital ${COMPANY.capital} € — ${COMPANY.rcs} — ${COMPANY.address} — ${COMPANY.email}`;

// ============================================================================
// COULEURS
// ============================================================================

const C = {
  orange: '#F97316',
  orangeLight: '#FFF7ED',
  orangeBorder: '#FDBA74',
  noir: '#1a1a1a',
  gris: '#666',
  grisBorder: '#e5e7eb',
  grisBg: '#fafafa',
  blanc: '#FFFFFF',
  vert: '#16a34a',
  vertBg: '#f0fdf4',
  vertBorder: '#bbf7d0',
};

// ============================================================================
// STYLES
// ============================================================================

const s = StyleSheet.create({
  page: {
    padding: '15mm 18mm 20mm 18mm',
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: C.noir,
    position: 'relative',
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingBottom: 4,
    borderBottomWidth: 3,
    borderBottomColor: C.orange,
    borderBottomStyle: 'solid',
  },
  logo: { height: 90, marginTop: -10, marginBottom: -10 },
  headerRight: { alignItems: 'flex-end' },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: C.noir },
  subtitle: { fontSize: 10, color: C.orange, marginTop: 2 },

  // Ref line
  refLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 9,
    color: C.gris,
    marginBottom: 10,
  },

  // Parties (client + entreprise)
  parties: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  party: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.grisBorder,
    borderStyle: 'solid',
    padding: 8,
    borderRadius: 3,
  },
  partyLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    color: C.orange,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  partyLine: { fontSize: 9, lineHeight: 1.5 },
  partyLineBold: { fontSize: 9, lineHeight: 1.5, fontFamily: 'Helvetica-Bold' },

  // Section title
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: C.noir,
    backgroundColor: C.grisBg,
    padding: '6 8',
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: C.orange,
    borderLeftStyle: 'solid',
  },

  // Equipment table
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: C.orange,
    padding: '5 8',
    marginBottom: 0,
  },
  tableHeaderText: {
    color: C.blanc,
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    padding: '5 8',
    borderBottomWidth: 0.5,
    borderBottomColor: C.grisBorder,
    borderBottomStyle: 'solid',
  },
  tableRowAlt: {
    backgroundColor: C.grisBg,
  },
  tableCell: { fontSize: 9 },

  // Réception
  receptionBox: {
    borderWidth: 1,
    borderColor: C.grisBorder,
    borderStyle: 'solid',
    borderRadius: 3,
    padding: 10,
    marginBottom: 12,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 6,
  },
  checkbox: {
    width: 12,
    height: 12,
    borderWidth: 1.5,
    borderColor: C.noir,
    borderStyle: 'solid',
    borderRadius: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: C.vert,
    borderColor: C.vert,
  },
  checkMark: {
    color: C.blanc,
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
  },
  checkLabel: { fontSize: 9, flex: 1 },

  // Réserves
  reservesBox: {
    marginLeft: 18,
    marginTop: 4,
    padding: 8,
    borderWidth: 1,
    borderColor: C.grisBorder,
    borderStyle: 'dashed',
    borderRadius: 3,
  },
  reservesLabel: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: C.gris,
    marginBottom: 3,
  },
  reservesText: {
    fontSize: 9,
    lineHeight: 1.5,
    minHeight: 30,
  },

  // Confirmations client
  confirmBox: {
    backgroundColor: C.vertBg,
    borderWidth: 1,
    borderColor: C.vertBorder,
    borderStyle: 'solid',
    borderRadius: 3,
    padding: 8,
    marginBottom: 12,
  },
  confirmTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: C.vert,
    marginBottom: 4,
    textTransform: 'uppercase',
  },

  // Signatures
  signaturesRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 10,
  },
  signatureBlock: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.grisBorder,
    borderStyle: 'solid',
    borderRadius: 3,
    padding: 8,
    alignItems: 'center',
  },
  signatureLabel: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: C.orange,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  signatureImage: {
    maxHeight: 60,
    maxWidth: 160,
    marginBottom: 4,
  },
  signatureName: {
    fontSize: 8,
    color: C.gris,
    marginTop: 2,
  },

  // Date & lieu
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    fontSize: 9,
    color: C.gris,
  },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 10,
    left: 18,
    right: 18,
    borderTopWidth: 0.5,
    borderTopColor: C.grisBorder,
    borderTopStyle: 'solid',
    paddingTop: 4,
    textAlign: 'center',
    fontSize: 6.5,
    color: '#aaa',
  },

  // Note conservation
  conservationNote: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderStyle: 'solid',
    borderRadius: 3,
    padding: 6,
    marginTop: 10,
  },
  conservationText: {
    fontSize: 7.5,
    color: '#92400E',
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
  },
});

// ============================================================================
// COMPOSANT PDF
// ============================================================================

function Checkbox({ checked }) {
  return (
    <View style={[s.checkbox, checked && s.checkboxChecked]}>
      {checked && <Text style={s.checkMark}>✓</Text>}
    </View>
  );
}

function PvReceptionDocument({ data }) {
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
  } = data;

  const sansReserves = receptionType === 'sans_reserves';
  const avecReserves = receptionType === 'avec_reserves';

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <Image src={LOGO_BASE64} style={s.logo} />
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
        <View style={s.parties}>
          <View style={s.party}>
            <Text style={s.partyLabel}>Entreprise</Text>
            <Text style={s.partyLineBold}>{COMPANY.name}</Text>
            <Text style={s.partyLine}>{COMPANY.address}</Text>
            <Text style={s.partyLine}>Tél. : {COMPANY.phone}</Text>
            <Text style={s.partyLine}>{COMPANY.email}</Text>
          </View>
          <View style={s.party}>
            <Text style={s.partyLabel}>Client (Maître d'ouvrage)</Text>
            <Text style={s.partyLineBold}>{clientName}</Text>
            <Text style={s.partyLine}>{clientAddress}</Text>
            <Text style={s.partyLine}>{clientPostalCode} {clientCity}</Text>
            {clientPhone ? <Text style={s.partyLine}>Tél. : {clientPhone}</Text> : null}
            {clientEmail ? <Text style={s.partyLine}>{clientEmail}</Text> : null}
          </View>
        </View>

        {/* Objet des travaux */}
        <Text style={s.sectionTitle}>Objet des Travaux</Text>
        <View style={{ ...s.receptionBox, marginBottom: 12 }}>
          <Text style={{ fontSize: 9, lineHeight: 1.5 }}>
            Installation et mise en service : {equipmentLabel || 'Équipement'}
          </Text>
          {equipmentRef ? (
            <Text style={{ fontSize: 8, color: C.gris, marginTop: 2 }}>
              Réf. : {equipmentRef}
            </Text>
          ) : null}
          {orderAmountHT ? (
            <Text style={{ fontSize: 9, marginTop: 4, fontFamily: 'Helvetica-Bold' }}>
              Montant HT : {orderAmountHT}
            </Text>
          ) : null}
        </View>

        {/* Réception */}
        <Text style={s.sectionTitle}>Déclaration de Réception</Text>
        <View style={s.receptionBox}>
          <Text style={{ fontSize: 8, color: C.gris, marginBottom: 8, lineHeight: 1.5 }}>
            Je soussigné(e), {clientName}, maître de l'ouvrage, après avoir procédé à la visite
            des travaux effectués par l'entreprise {COMPANY.name}, déclare :
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
                  <Text style={{ ...s.reservesLabel, marginTop: 6 }}>Travaux à exécuter :</Text>
                  <Text style={s.reservesText}>{reservesTravaux}</Text>
                </>
              ) : null}
            </View>
          )}
        </View>

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
              Les notices d'utilisation en français des matériels installés
            </Text>
          </View>
          <View style={s.checkRow}>
            <Checkbox checked={entretienRecues} />
            <Text style={s.checkLabel}>
              Les informations relatives à l'entretien et la maintenance des matériels installés
            </Text>
          </View>
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
            <Text style={s.signatureLabel}>Signature de l'entreprise</Text>
            {signatureTechBase64 ? (
              <Image src={signatureTechBase64} style={s.signatureImage} />
            ) : (
              <View style={{ height: 60 }} />
            )}
            <Text style={s.signatureName}>{signatureTechNom || technicianName || '—'}</Text>
          </View>
          <View style={s.signatureBlock}>
            <Text style={s.signatureLabel}>Signature du client</Text>
            {signatureClientBase64 ? (
              <Image src={signatureClientBase64} style={s.signatureImage} />
            ) : (
              <View style={{ height: 60 }} />
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

        {/* Footer */}
        <Text style={s.footer}>{LEGAL_FOOTER}</Text>
      </Page>
    </Document>
  );
}

// ============================================================================
// EXPORT : generatePvReceptionPdfBlob
// ============================================================================

export async function generatePvReceptionPdfBlob(data) {
  const blob = await pdf(<PvReceptionDocument data={data} />).toBlob();
  return blob;
}
