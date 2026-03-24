/**
 * DevisPDF.jsx — Template PDF devis (@react-pdf/renderer)
 * ============================================================================
 * Placeholder — sera complété en Phase 6
 * ============================================================================
 */

import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import { formatEuro } from '@/lib/utils';

// ============================================================================
// STYLES
// ============================================================================

const s = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#1a1a1a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#F97316',
  },
  subtitle: {
    fontSize: 10,
    color: '#666',
    marginTop: 4,
  },
  partiesRow: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 20,
  },
  partyBox: {
    flex: 1,
    padding: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 4,
  },
  partyTitle: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  partyText: {
    fontSize: 9,
    lineHeight: 1.5,
  },
  subjectBox: {
    backgroundColor: '#fff7ed',
    padding: 10,
    borderRadius: 4,
    marginBottom: 16,
  },
  subjectLabel: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#9ca3af',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  subjectText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  // Table
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F97316',
    color: '#fff',
    padding: '6 8',
    borderRadius: 2,
    fontSize: 8,
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    padding: '5 8',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e5e7eb',
    fontSize: 9,
  },
  tableRowAlt: {
    backgroundColor: '#fafafa',
  },
  sectionRow: {
    padding: '6 8',
    backgroundColor: '#f3f4f6',
    fontSize: 9,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    color: '#6b7280',
    letterSpacing: 0.5,
  },
  colDesignation: { flex: 4 },
  colRef: { flex: 1.5 },
  colQty: { flex: 1, textAlign: 'center' },
  colPU: { flex: 1.5, textAlign: 'right' },
  colTVA: { flex: 1, textAlign: 'center' },
  colTotal: { flex: 1.5, textAlign: 'right' },
  // Totals
  totalsBox: {
    marginTop: 16,
    marginLeft: 'auto',
    width: 220,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    fontSize: 9,
  },
  totalRowBold: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    fontSize: 12,
    fontWeight: 'bold',
    borderTopWidth: 1,
    borderTopColor: '#d1d5db',
    marginTop: 4,
  },
  // Conditions
  conditionsBox: {
    marginTop: 30,
    padding: 10,
    backgroundColor: '#f9fafb',
    borderRadius: 4,
  },
  conditionsTitle: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#9ca3af',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  conditionsText: {
    fontSize: 8,
    lineHeight: 1.6,
    color: '#4b5563',
  },
  // Validity
  validityText: {
    marginTop: 16,
    fontSize: 9,
    color: '#6b7280',
    fontStyle: 'italic',
  },
  // Signature
  signatureBox: {
    marginTop: 30,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  signatureZone: {
    width: 200,
    padding: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 4,
  },
  signatureLabel: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#6b7280',
    marginBottom: 30,
  },
  signatureLine: {
    borderTopWidth: 0.5,
    borderTopColor: '#9ca3af',
    paddingTop: 4,
    fontSize: 8,
    color: '#9ca3af',
  },
  // Footer
  footer: {
    position: 'absolute',
    bottom: 25,
    left: 40,
    right: 40,
    fontSize: 7,
    color: '#9ca3af',
    textAlign: 'center',
    borderTopWidth: 0.5,
    borderTopColor: '#e5e7eb',
    paddingTop: 8,
  },
});

// ============================================================================
// COMPANY INFO (same as ContractPDF)
// ============================================================================

const COMPANY = {
  name: 'Mayer Énergie',
  address: '17 Rue Jean Moulin',
  postalCode: '81600',
  city: 'Gaillac',
  phone: '05 63 57 48 00',
  siret: '449 776 916 00039',
  tvaIntra: 'FR 06 449776916',
};

// ============================================================================
// DOCUMENT
// ============================================================================

function DevisDocument({ data }) {
  const { quoteNumber, date, validityDate, subject, clientName, clientAddress, clientPostalCode, clientCity, clientPhone, clientEmail, lines = [], globalDiscountPercent = 0, totals, conditions } = data;

  const formatDate = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.title}>DEVIS</Text>
            <Text style={s.subtitle}>N° {quoteNumber}</Text>
            <Text style={s.subtitle}>Date : {formatDate(date)}</Text>
          </View>
          <View style={{ textAlign: 'right' }}>
            <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#F97316' }}>{COMPANY.name}</Text>
            <Text style={s.subtitle}>{COMPANY.address}</Text>
            <Text style={s.subtitle}>{COMPANY.postalCode} {COMPANY.city}</Text>
            <Text style={s.subtitle}>Tél. {COMPANY.phone}</Text>
          </View>
        </View>

        {/* Parties */}
        <View style={s.partiesRow}>
          <View style={s.partyBox}>
            <Text style={s.partyTitle}>Prestataire</Text>
            <Text style={s.partyText}>{COMPANY.name}</Text>
            <Text style={s.partyText}>{COMPANY.address}</Text>
            <Text style={s.partyText}>{COMPANY.postalCode} {COMPANY.city}</Text>
            <Text style={s.partyText}>SIRET : {COMPANY.siret}</Text>
            <Text style={s.partyText}>TVA : {COMPANY.tvaIntra}</Text>
          </View>
          <View style={s.partyBox}>
            <Text style={s.partyTitle}>Client</Text>
            <Text style={s.partyText}>{clientName || '—'}</Text>
            {clientAddress && <Text style={s.partyText}>{clientAddress}</Text>}
            {(clientPostalCode || clientCity) && (
              <Text style={s.partyText}>{[clientPostalCode, clientCity].filter(Boolean).join(' ')}</Text>
            )}
            {clientPhone && <Text style={s.partyText}>Tél. {clientPhone}</Text>}
            {clientEmail && <Text style={s.partyText}>{clientEmail}</Text>}
          </View>
        </View>

        {/* Subject */}
        {subject && (
          <View style={s.subjectBox}>
            <Text style={s.subjectLabel}>Objet</Text>
            <Text style={s.subjectText}>{subject}</Text>
          </View>
        )}

        {/* Table header */}
        <View style={s.tableHeader}>
          <Text style={s.colDesignation}>Désignation</Text>
          <Text style={s.colRef}>Réf.</Text>
          <Text style={s.colQty}>Qté</Text>
          <Text style={s.colPU}>P.U. HT</Text>
          <Text style={s.colTVA}>TVA</Text>
          <Text style={s.colTotal}>Total HT</Text>
        </View>

        {/* Table lines */}
        {lines.map((line, i) => {
          if (line.line_type === 'section_title') {
            return (
              <View key={i} style={s.sectionRow}>
                <Text>{line.designation}</Text>
              </View>
            );
          }
          return (
            <View key={i} style={[s.tableRow, i % 2 === 1 && s.tableRowAlt]}>
              <Text style={s.colDesignation}>{line.designation}</Text>
              <Text style={s.colRef}>{line.reference || ''}</Text>
              <Text style={s.colQty}>{line.quantity}</Text>
              <Text style={s.colPU}>{formatEuro(line.unit_price_ht)}</Text>
              <Text style={s.colTVA}>{line.tva_rate}%</Text>
              <Text style={s.colTotal}>{formatEuro(line.total_ht)}</Text>
            </View>
          );
        })}

        {/* Totals */}
        {totals && (
          <View style={s.totalsBox}>
            <View style={s.totalRow}>
              <Text>Sous-total HT</Text>
              <Text>{formatEuro(totals.subtotal_ht)}</Text>
            </View>
            {globalDiscountPercent > 0 && (
              <View style={s.totalRow}>
                <Text>Remise ({globalDiscountPercent}%)</Text>
                <Text>-{formatEuro(totals.discount_amount)}</Text>
              </View>
            )}
            <View style={s.totalRow}>
              <Text style={{ fontWeight: 'bold' }}>Total HT</Text>
              <Text style={{ fontWeight: 'bold' }}>{formatEuro(totals.total_ht)}</Text>
            </View>
            {totals.tva_breakdown?.map((t) => (
              <View key={t.rate} style={s.totalRow}>
                <Text>TVA {t.rate}%</Text>
                <Text>{formatEuro(t.tva_amount)}</Text>
              </View>
            ))}
            <View style={s.totalRowBold}>
              <Text>Total TTC</Text>
              <Text>{formatEuro(totals.total_ttc)}</Text>
            </View>
          </View>
        )}

        {/* Validity */}
        {validityDate && (
          <Text style={s.validityText}>
            Ce devis est valable jusqu'au {formatDate(validityDate)}.
          </Text>
        )}

        {/* Conditions */}
        {conditions && (
          <View style={s.conditionsBox}>
            <Text style={s.conditionsTitle}>Conditions de vente</Text>
            <Text style={s.conditionsText}>{conditions}</Text>
          </View>
        )}

        {/* Signature */}
        <View style={s.signatureBox}>
          <View style={s.signatureZone}>
            <Text style={s.signatureLabel}>Bon pour accord</Text>
            <Text style={s.signatureLine}>Date et signature du client</Text>
          </View>
        </View>

        {/* Footer */}
        <Text style={s.footer}>
          {COMPANY.name} — {COMPANY.address}, {COMPANY.postalCode} {COMPANY.city} — SIRET {COMPANY.siret} — TVA {COMPANY.tvaIntra}
        </Text>
      </Page>
    </Document>
  );
}

// ============================================================================
// EXPORT
// ============================================================================

export async function generateDevisPdfBlob(data) {
  return pdf(<DevisDocument data={data} />).toBlob();
}

export default DevisDocument;
