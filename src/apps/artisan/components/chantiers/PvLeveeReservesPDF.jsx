/**
 * PvLeveeReservesPDF.jsx - PV de levée des réserves
 * ============================================================================
 * Version minimale : la mise en page est complétée par le commit suivant du même lot.
 * Exporté : generatePvLeveePdfBlob(data, company) → Blob
 * ============================================================================
 */
/* eslint-disable react-refresh/only-export-components -- react-pdf : jamais monté dans le DOM, le fast refresh ne s'applique pas */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica', color: '#1e293b' },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 12 },
  line: { marginBottom: 6 },
  statement: { marginTop: 20 },
});

function PvLeveeDocument({ data, company }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Procès-verbal de levée des réserves</Text>
        <View>
          {company?.name ? <Text style={styles.line}>{company.name}</Text> : null}
          <Text style={styles.line}>Référence : {data?.numero || '-'}</Text>
          <Text style={styles.line}>Date : {data?.date || '-'}</Text>
          <Text style={styles.line}>Client : {data?.clientName || 'Client'}</Text>
        </View>
        <Text style={styles.statement}>Le client constate que les réserves ci-dessus sont levées.</Text>
      </Page>
    </Document>
  );
}

export async function generatePvLeveePdfBlob(data, company) {
  const blob = await pdf(<PvLeveeDocument data={data} company={company} />).toBlob();
  return blob;
}
