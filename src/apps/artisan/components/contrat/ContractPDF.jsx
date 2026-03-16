/**
 * ContractPDF.jsx - Contrat d'Entretien Annuel
 * ============================================================================
 * Template PDF A4 avec @react-pdf/renderer.
 * Palette Mayer Énergie : bleu #1B4F72, orange #E67E22.
 *
 * Exporté : generateContractPdfBlob(data) → Blob
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

// ============================================================================
// COULEURS
// ============================================================================

const C = {
  bleu: '#1B4F72',
  bleuClair: '#D6EAF8',
  orange: '#E67E22',
  vert: '#27AE60',
  gris: '#5D6D7E',
  grisClair: '#F2F3F4',
  blanc: '#FFFFFF',
  noir: '#2C3E50',
};

// ============================================================================
// STYLES
// ============================================================================

const s = StyleSheet.create({
  page: { padding: 30, paddingBottom: 60, fontSize: 9, fontFamily: 'Helvetica', color: C.noir },
  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12, borderBottom: `2px solid ${C.bleu}`, paddingBottom: 8 },
  headerLeft: {},
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: C.bleu },
  subtitle: { fontSize: 9, color: C.gris, marginTop: 2 },
  headerRight: { alignItems: 'flex-end' },
  reference: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.orange },
  dateText: { fontSize: 8, color: C.gris, marginTop: 2 },
  // Section
  sectionTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.bleu, marginTop: 14, marginBottom: 4, borderBottom: `1px solid ${C.bleuClair}`, paddingBottom: 2 },
  // Fields
  row2: { flexDirection: 'row', gap: 12 },
  col: { flex: 1 },
  fieldRow: { flexDirection: 'row', marginBottom: 2 },
  fieldLabel: { width: 100, color: C.gris, fontSize: 8 },
  fieldValue: { flex: 1, fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
  // Table
  tableHeader: { flexDirection: 'row', backgroundColor: C.bleu, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 2 },
  tableHeaderCell: { color: C.blanc, fontSize: 7.5, fontFamily: 'Helvetica-Bold' },
  tableRow: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 6, borderBottom: `0.5px solid ${C.grisClair}` },
  tableCell: { fontSize: 8 },
  tableCellRight: { fontSize: 8, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  // Total
  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 3, paddingHorizontal: 6 },
  totalLabel: { fontSize: 9, marginRight: 20 },
  totalValue: { fontSize: 9, fontFamily: 'Helvetica-Bold', textAlign: 'right', width: 70 },
  grandTotal: { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 5, paddingHorizontal: 6, backgroundColor: C.bleuClair, borderRadius: 2, marginTop: 2 },
  grandTotalLabel: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.bleu, marginRight: 20 },
  grandTotalValue: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.bleu, textAlign: 'right', width: 70 },
  // Conditions
  conditionsText: { fontSize: 7, color: C.gris, lineHeight: 1.4, marginBottom: 2 },
  conditionsBold: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.noir, marginBottom: 1 },
  // Signature
  signatureZone: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, paddingTop: 8, borderTop: `1px solid ${C.grisClair}` },
  signatureBlock: { width: '45%' },
  signatureLabel: { fontSize: 7, color: C.gris, marginBottom: 3 },
  signatureImage: { maxHeight: 60, maxWidth: 180 },
  signatureName: { fontSize: 8, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  signatureLine: { borderBottom: `1px solid ${C.gris}`, height: 50, marginBottom: 2 },
  // Footer
  footer: { position: 'absolute', bottom: 20, left: 30, right: 30, borderTop: `0.5px solid ${C.grisClair}`, paddingTop: 4, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 6, color: C.gris },
});

// ============================================================================
// HELPERS
// ============================================================================

const fmtEuro = (v) => {
  const n = parseFloat(v) || 0;
  return n.toFixed(2).replace('.', ',') + ' \u20ac';
};

const fmtDate = (d) => {
  if (!d) return '-';
  try {
    return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return d;
  }
};

const MONTHS_FR = [
  '', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

// ============================================================================
// DOCUMENT
// ============================================================================

function ContractDocument({ data }) {
  const {
    contractNumber,
    startDate,
    maintenanceMonth,
    clientName,
    clientAddress,
    clientPostalCode,
    clientCity,
    clientPhone,
    clientEmail,
    equipmentLines = [],
    subtotal,
    discountPercent,
    discountAmount,
    total,
    zoneName,
    notes,
    signatureBase64,
    signataireNom,
    signedAt,
  } = data;

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* HEADER */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <Text style={s.title}>Contrat d'entretien annuel</Text>
            <Text style={s.subtitle}>Mayer Énergie — Entretien & Maintenance CVC</Text>
          </View>
          <View style={s.headerRight}>
            {contractNumber && <Text style={s.reference}>{contractNumber}</Text>}
            <Text style={s.dateText}>Édité le {fmtDate(new Date().toISOString())}</Text>
          </View>
        </View>

        {/* CLIENT */}
        <Text style={s.sectionTitle}>Informations client</Text>
        <View style={s.row2}>
          <View style={s.col}>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Nom</Text>
              <Text style={s.fieldValue}>{clientName || '-'}</Text>
            </View>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Adresse</Text>
              <Text style={s.fieldValue}>{clientAddress || '-'}</Text>
            </View>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Ville</Text>
              <Text style={s.fieldValue}>{clientPostalCode} {clientCity}</Text>
            </View>
          </View>
          <View style={s.col}>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Téléphone</Text>
              <Text style={s.fieldValue}>{clientPhone || '-'}</Text>
            </View>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Email</Text>
              <Text style={s.fieldValue}>{clientEmail || '-'}</Text>
            </View>
          </View>
        </View>

        {/* CONDITIONS */}
        <Text style={s.sectionTitle}>Conditions du contrat</Text>
        <View style={s.row2}>
          <View style={s.col}>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Date de début</Text>
              <Text style={s.fieldValue}>{fmtDate(startDate)}</Text>
            </View>
          </View>
          <View style={s.col}>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Mois d'entretien</Text>
              <Text style={s.fieldValue}>{maintenanceMonth ? MONTHS_FR[maintenanceMonth] || '-' : '-'}</Text>
            </View>
          </View>
          <View style={s.col}>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Zone tarifaire</Text>
              <Text style={s.fieldValue}>{zoneName || '-'}</Text>
            </View>
          </View>
        </View>

        {/* ÉQUIPEMENTS */}
        <Text style={s.sectionTitle}>Équipements sous contrat</Text>
        <View style={s.tableHeader}>
          <Text style={[s.tableHeaderCell, { flex: 3 }]}>Équipement</Text>
          <Text style={[s.tableHeaderCell, { flex: 1, textAlign: 'center' }]}>Qté</Text>
          <Text style={[s.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Prix</Text>
        </View>
        {equipmentLines.map((line, i) => (
          <View key={i} style={s.tableRow}>
            <Text style={[s.tableCell, { flex: 3 }]}>{line.label}</Text>
            <Text style={[s.tableCell, { flex: 1, textAlign: 'center' }]}>{line.quantity}</Text>
            <Text style={[s.tableCellRight, { flex: 1 }]}>{fmtEuro(line.lineTotal)}</Text>
          </View>
        ))}

        {/* TOTAUX */}
        {discountPercent > 0 && (
          <>
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Sous-total</Text>
              <Text style={s.totalValue}>{fmtEuro(subtotal)}</Text>
            </View>
            <View style={s.totalRow}>
              <Text style={[s.totalLabel, { color: C.vert }]}>Remise -{discountPercent}%</Text>
              <Text style={[s.totalValue, { color: C.vert }]}>-{fmtEuro(discountAmount)}</Text>
            </View>
          </>
        )}
        <View style={s.grandTotal}>
          <Text style={s.grandTotalLabel}>Total annuel TTC</Text>
          <Text style={s.grandTotalValue}>{fmtEuro(total)}</Text>
        </View>

        {/* NOTES */}
        {notes && (
          <>
            <Text style={s.sectionTitle}>Observations</Text>
            <Text style={s.conditionsText}>{notes}</Text>
          </>
        )}

        {/* CONDITIONS GÉNÉRALES */}
        <Text style={s.sectionTitle}>Conditions générales</Text>
        <Text style={s.conditionsBold}>Objet du contrat</Text>
        <Text style={s.conditionsText}>
          Le présent contrat a pour objet l'entretien annuel des équipements listés ci-dessus, conformément aux réglementations en vigueur.
          L'entretien comprend le contrôle, le nettoyage et la vérification du bon fonctionnement des installations.
        </Text>
        <Text style={s.conditionsBold}>Durée et renouvellement</Text>
        <Text style={s.conditionsText}>
          Le contrat est conclu pour une durée d'un an à compter de la date de début. Il est renouvelable par tacite reconduction,
          sauf dénonciation par l'une des parties avec un préavis de 30 jours avant la date anniversaire.
        </Text>
        <Text style={s.conditionsBold}>Obligations de l'entreprise</Text>
        <Text style={s.conditionsText}>
          Mayer Énergie s'engage à effectuer l'entretien annuel dans les règles de l'art et à délivrer une attestation
          d'entretien conformément à la réglementation en vigueur. En cas de dysfonctionnement constaté, le technicien
          informera le client des réparations nécessaires.
        </Text>
        <Text style={s.conditionsBold}>Obligations du client</Text>
        <Text style={s.conditionsText}>
          Le client s'engage à permettre l'accès aux installations et à signaler tout dysfonctionnement constaté.
          Le règlement du contrat est dû à la signature ou selon les modalités convenues.
        </Text>

        {/* SIGNATURES */}
        <View style={s.signatureZone}>
          <View style={s.signatureBlock}>
            <Text style={s.signatureLabel}>Pour Mayer Énergie</Text>
            <View style={s.signatureLine} />
            <Text style={s.signatureName}>Mayer Énergie</Text>
          </View>
          <View style={s.signatureBlock}>
            <Text style={s.signatureLabel}>Le client (lu et approuvé, bon pour accord)</Text>
            {signatureBase64 ? (
              <>
                <Image src={signatureBase64} style={s.signatureImage} />
                <Text style={s.signatureName}>{signataireNom || '-'}</Text>
                {signedAt && <Text style={{ fontSize: 6, color: C.gris }}>Signé le {fmtDate(signedAt)}</Text>}
              </>
            ) : (
              <View style={s.signatureLine} />
            )}
          </View>
        </View>

        {/* FOOTER */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>Mayer Énergie — 26 Rue des Pyrénées, 81600 Gaillac</Text>
          <Text style={s.footerText}>SIRET 123 456 789 00000 — RGE QualiPAC / Qualibois</Text>
        </View>
      </Page>
    </Document>
  );
}

// ============================================================================
// EXPORT
// ============================================================================

/**
 * Génère un Blob PDF du contrat d'entretien.
 * @param {Object} data - Données du contrat
 * @returns {Promise<Blob>}
 */
export async function generateContractPdfBlob(data) {
  const blob = await pdf(<ContractDocument data={data} />).toBlob();
  return blob;
}
