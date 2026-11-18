/**
 * pvPdfShared.jsx - Styles et petits blocs communs aux PDF du PV de réception
 * et du PV de levée des réserves (couleurs, feuille de style, case à cocher,
 * parties, pied de page).
 * ============================================================================
 */
/* eslint-disable react-refresh/only-export-components -- react-pdf : jamais monté dans le DOM */

import { StyleSheet, Text, View } from '@react-pdf/renderer';

// ============================================================================
// COULEURS
// ============================================================================

export const C = {
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

export const s = StyleSheet.create({
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

  // Points de la déclaration (PV en ligne)
  pointRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
    gap: 6,
  },
  pointText: { fontSize: 9, flex: 1, lineHeight: 1.4 },
  pointAnswer: { fontSize: 9, fontFamily: 'Helvetica-Bold', width: 60, textAlign: 'right' },
  pointsBox: {
    borderWidth: 1,
    borderColor: C.grisBorder,
    borderStyle: 'solid',
    borderRadius: 3,
    padding: 8,
    marginBottom: 10,
  },
  pointsTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: C.orange,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  garantiesBox: { marginTop: 4 },
  garantiesTitle: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: C.gris, marginBottom: 1 },
  garantiesText: { fontSize: 7, color: C.gris, lineHeight: 1.2 },
  bodyText: { fontSize: 9, lineHeight: 1.5 },
});

export function Checkbox({ checked }) {
  return (
    <View style={[s.checkbox, checked && s.checkboxChecked]}>
      {checked && <Text style={s.checkMark}>✓</Text>}
    </View>
  );
}

/** Coordonnées de l'entreprise telles qu'imprimées (`company` = buildCompanyInfo). */
export function identiteEntreprise(company) {
  return {
    name: company.name,
    legalName: company.legalName,
    legalForm: company.legalForm,
    capital: company.capital,
    rcs: company.rcs,
    address: `${company.address} – ${company.postalCode} ${company.city}`,
    phone: company.phone,
    email: company.email,
  };
}

export function piedLegal(c) {
  return `${c.legalName} — ${c.legalForm}, capital ${c.capital} € — ${c.rcs} — ${c.address} — ${c.email}`;
}

/** Bloc Entreprise + bloc Client. */
export function Parties({ entreprise, client }) {
  return (
    <View style={s.parties}>
      <View style={s.party}>
        <Text style={s.partyLabel}>Entreprise</Text>
        <Text style={s.partyLineBold}>{entreprise.name}</Text>
        <Text style={s.partyLine}>{entreprise.address}</Text>
        <Text style={s.partyLine}>Tél. : {entreprise.phone}</Text>
        <Text style={s.partyLine}>{entreprise.email}</Text>
      </View>
      <View style={s.party}>
        <Text style={s.partyLabel}>Client (Maître d&apos;ouvrage)</Text>
        <Text style={s.partyLineBold}>{client.name}</Text>
        <Text style={s.partyLine}>{client.address}</Text>
        <Text style={s.partyLine}>{client.postalCode} {client.city}</Text>
        {client.phone ? <Text style={s.partyLine}>Tél. : {client.phone}</Text> : null}
        {client.email ? <Text style={s.partyLine}>{client.email}</Text> : null}
      </View>
    </View>
  );
}

/** Une ligne par devis cité : `Devis <libellé> du <date>` (date déjà en toutes lettres). */
export function LignesDevis({ devis }) {
  return (devis || []).map((d, i) => (
    <Text key={i} style={{ fontSize: 9, marginTop: 2 }}>Devis {d.libelle} du {d.date}</Text>
  ));
}
