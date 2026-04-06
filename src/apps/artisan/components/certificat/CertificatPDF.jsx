/**
 * CertificatPDF.jsx - Certificat d'Entretien & Ramonage
 * ============================================================================
 * Template PDF A4 compact (1 page) avec @react-pdf/renderer.
 * Palette Mayer Énergie : bleu #1B4F72, orange #E67E22.
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
import {
  EQUIPMENT_CATEGORY_LABELS,
  CONTROLES_SECURITE_ITEMS,
  NETTOYAGE_ITEMS,
  MESURES_PAR_TYPE,
  SECTIONS_PAR_EQUIPEMENT,
  getNettoyageItems,
} from './constants';
import logoMayer from '@/assets/logo-mayer.png';

// ============================================================================
// COULEURS
// ============================================================================

const C = {
  bleu: '#1B4F72',
  bleuClair: '#D6EAF8',
  orange: '#E67E22',
  vert: '#27AE60',
  rouge: '#E74C3C',
  gris: '#5D6D7E',
  grisClair: '#F2F3F4',
  blanc: '#FFFFFF',
  noir: '#2C3E50',
};

// ============================================================================
// STYLES — ultra compact pour tenir sur 1 page A4
// ============================================================================

const s = StyleSheet.create({
  page: { padding: 24, paddingBottom: 40, fontSize: 7, fontFamily: 'Helvetica', color: C.noir },
  // Header
  header: { flexDirection: 'column', alignItems: 'center', marginBottom: 10, borderBottom: `2px solid ${C.bleu}`, paddingBottom: 6 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%' },
  headerCenter: { alignItems: 'center', marginTop: 4 },
  logo: { width: 50, height: 50 },
  title: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: C.bleu, textAlign: 'center' },
  subtitle: { fontSize: 8, color: C.gris, marginTop: 2, textAlign: 'center' },
  reference: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.orange },
  // Section
  sectionTitle: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.bleu, marginTop: 10, marginBottom: 3, borderBottom: `0.5px solid ${C.bleuClair}`, paddingBottom: 1 },
  // Layout
  row2: { flexDirection: 'row', gap: 8 },
  col: { flex: 1 },
  // Champs
  fieldRow: { flexDirection: 'row', marginBottom: 1 },
  fieldLabel: { width: 80, color: C.gris, fontSize: 6.5 },
  fieldValue: { flex: 1, fontFamily: 'Helvetica-Bold', fontSize: 6.5 },
  // Table compacte
  tableHeader: { flexDirection: 'row', backgroundColor: C.bleu, paddingVertical: 2, paddingHorizontal: 3, borderRadius: 1 },
  tableHeaderCell: { color: C.blanc, fontSize: 6, fontFamily: 'Helvetica-Bold' },
  tableRow: { flexDirection: 'row', paddingVertical: 1.5, paddingHorizontal: 3, borderBottom: `0.5px solid ${C.grisClair}` },
  tableCell: { fontSize: 6.5 },
  // Conformité
  conforme: { color: C.vert, fontFamily: 'Helvetica-Bold', fontSize: 6.5 },
  nonConforme: { color: C.rouge, fontFamily: 'Helvetica-Bold', fontSize: 6.5 },
  na: { color: C.gris, fontSize: 6.5 },
  // Bilan
  bilanBox: { padding: 5, borderRadius: 2, marginTop: 2 },
  bilanTitle: { fontSize: 8, fontFamily: 'Helvetica-Bold' },
  // Signature
  signatureZone: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingTop: 4, borderTop: `0.5px solid ${C.grisClair}` },
  signatureBlock: { width: '45%' },
  signatureLabel: { fontSize: 6, color: C.gris, marginBottom: 2 },
  signatureImage: { maxHeight: 50, maxWidth: 150 },
  signatureName: { fontSize: 7, fontFamily: 'Helvetica-Bold', marginTop: 1 },
  signatureDate: { fontSize: 6, color: C.gris },
  // Footer
  footer: { position: 'absolute', bottom: 14, left: 24, right: 24, borderTop: `0.5px solid ${C.grisClair}`, paddingTop: 3 },
  footerText: { fontSize: 5.5, color: C.gris, textAlign: 'center' },
});

// ============================================================================
// HELPERS
// ============================================================================

function Conf({ value }) {
  if (value === 'conforme') return <Text style={s.conforme}>C</Text>;
  if (value === 'non_conforme') return <Text style={s.nonConforme}>NC</Text>;
  return <Text style={s.na}>-</Text>;
}

function Field({ label, value }) {
  return (
    <View style={s.fieldRow}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={s.fieldValue}>{value || '-'}</Text>
    </View>
  );
}

// ============================================================================
// DOCUMENT PDF
// ============================================================================

function CertificatDocument({ data }) {
  const config = SECTIONS_PAR_EQUIPEMENT[data.equipement_type] || {};
  const controles = data.donnees_entretien?.controles_securite || {};
  const nettoyage = data.donnees_entretien?.nettoyage || {};
  const fgaz = data.donnees_entretien?.fgaz || {};
  const ramonage = data.donnees_ramonage || {};
  const mesures = data.mesures || {};
  const mesuresItems = MESURES_PAR_TYPE[config.mesuresLabel] || [];
  const pieces = data.pieces_remplacees || [];
  const nettoyageItems = getNettoyageItems(data.equipement_type);

  const bilanColor = data.bilan_conformite === 'conforme' ? C.vert :
    data.bilan_conformite === 'anomalie' ? C.orange : C.rouge;
  const bilanBg = data.bilan_conformite === 'conforme' ? '#EAFAF1' :
    data.bilan_conformite === 'anomalie' ? '#FDEBD0' : '#FADBD8';
  const bilanLabel = data.bilan_conformite === 'conforme' ? 'INSTALLATION CONFORME' :
    data.bilan_conformite === 'anomalie' ? 'ANOMALIE(S) DETECTEE(S)' : "ARRET D'URGENCE";

  // Fusionner contrôles + nettoyage en une seule liste
  const allChecks = [
    ...CONTROLES_SECURITE_ITEMS.filter(item => !item.hasNumericField).map(item => ({ label: item.label, value: controles[item.key] })),
    ...nettoyageItems.map(item => ({ label: item.label, value: nettoyage[item.key] })),
  ];
  // Split en 2 colonnes
  const midIdx = Math.ceil(allChecks.length / 2);
  const checksLeft = allChecks.slice(0, midIdx);
  const checksRight = allChecks.slice(midIdx);

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* EN-TETE */}
        <View style={s.header}>
          <View style={s.headerTop}>
            <Image src={logoMayer} style={s.logo} />
            <View style={{ alignItems: 'flex-end' }}>
              {data.reference ? <Text style={s.reference}>{data.reference}</Text> : null}
              <Text style={s.subtitle}>{data.date_intervention || ' '}</Text>
            </View>
          </View>
          <View style={s.headerCenter}>
            <Text style={s.title}>MAYER ENERGIE</Text>
            <Text style={s.subtitle}>CERTIFICAT D'ENTRETIEN{config.showRamonage ? ' & RAMONAGE' : ''}</Text>
          </View>
        </View>

        {/* CLIENT & TECHNICIEN */}
        <Text style={s.sectionTitle}>CLIENT & TECHNICIEN</Text>
        <View style={s.row2}>
          <View style={s.col}>
            <Field label="Client" value={data.client_name} />
            <Field label="Adresse" value={data.client_address} />
            <Field label="Telephone" value={data.client_phone} />
          </View>
          <View style={s.col}>
            <Field label="Technicien" value={data.technicien_nom} />
            <Field label="Certifications" value={(data.technicien_certifications || []).join(', ')} />
          </View>
        </View>

        {/* EQUIPEMENT */}
        <Text style={s.sectionTitle}>EQUIPEMENT</Text>
        <View style={s.row2}>
          <View style={s.col}>
            <Field label="Type" value={EQUIPMENT_CATEGORY_LABELS[data.equipement_type] || data.equipement_type} />
            <Field label="Marque / Modele" value={[data.equipement_marque, data.equipement_modele].filter(Boolean).join(' ')} />
            <Field label="N. serie" value={data.equipement_numero_serie} />
          </View>
          <View style={s.col}>
            <Field label="Puissance" value={data.equipement_puissance_kw ? `${data.equipement_puissance_kw} kW` : '-'} />
            {data.combustible && <Field label="Combustible" value={data.combustible} />}
            {data.equipement_fluide && <Field label="Fluide" value={`${data.equipement_fluide} ${data.equipement_charge_kg ? `(${data.equipement_charge_kg} kg)` : ''}`} />}
          </View>
        </View>

        {/* CONTROLES & NETTOYAGE — 2 colonnes compactes */}
        <Text style={s.sectionTitle}>CONTROLES & NETTOYAGE</Text>
        <View style={s.row2}>
          {/* Col gauche */}
          <View style={s.col}>
            {checksLeft.map((item, i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1, borderBottom: `0.5px solid ${C.grisClair}` }}>
                <Text style={{ fontSize: 6, flex: 3 }}>{item.label}</Text>
                <Conf value={item.value} />
              </View>
            ))}
          </View>
          {/* Col droite */}
          <View style={s.col}>
            {checksRight.map((item, i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1, borderBottom: `0.5px solid ${C.grisClair}` }}>
                <Text style={{ fontSize: 6, flex: 3 }}>{item.label}</Text>
                <Conf value={item.value} />
              </View>
            ))}
          </View>
        </View>

        {/* RAMONAGE (conditionnel) */}
        {config.showRamonage && ramonage.conduits && (
          <>
            <Text style={s.sectionTitle}>RAMONAGE</Text>
            <View style={s.row2}>
              <View style={s.col}>
                {(ramonage.conduits || []).map((conduit, i) => (
                  <Field key={i} label={conduit.label || `Conduit ${i + 1}`} value={conduit.resultat === 'ramone' ? 'Ramone' : conduit.resultat === 'obstrue' ? 'Obstrue' : '-'} />
                ))}
                <Field label="Methode" value={ramonage.methode} />
              </View>
              <View style={s.col}>
                <Field label="Taux depots" value={ramonage.taux_depots} />
                {ramonage.observations_conduit && <Field label="Observations" value={ramonage.observations_conduit} />}
              </View>
            </View>
          </>
        )}

        {/* F-GAZ (conditionnel) */}
        {config.showFGaz && fgaz.detection_fuites && (
          <>
            <Text style={s.sectionTitle}>CONTROLE F-GAZ</Text>
            <View style={s.row2}>
              <View style={s.col}>
                <Field label="Detection fuites" value={fgaz.detection_fuites === 'conforme' ? 'Conforme' : 'Non conforme'} />
                <Field label="Certificat verifie" value={fgaz.certificat_aptitude_verifie ? 'Oui' : 'Non'} />
              </View>
              <View style={s.col}>
                <Field label="Charge actuelle" value={fgaz.charge_actuelle_kg ? `${fgaz.charge_actuelle_kg} kg` : '-'} />
                <Field label="Fluide ajoute" value={`${fgaz.fluide_ajoute_kg || 0} kg`} />
              </View>
            </View>
          </>
        )}

        {/* MESURES */}
        {mesuresItems.length > 0 && (
          <>
            <Text style={s.sectionTitle}>MESURES & PERFORMANCES</Text>
            <View style={s.row2}>
              <View style={s.col}>
                {mesuresItems.slice(0, Math.ceil(mesuresItems.length / 2)).map(m => (
                  <Field key={m.key} label={m.label} value={mesures[m.key] != null ? `${mesures[m.key]} ${m.unit}` : '-'} />
                ))}
              </View>
              <View style={s.col}>
                {mesuresItems.slice(Math.ceil(mesuresItems.length / 2)).map(m => (
                  <Field key={m.key} label={m.label} value={mesures[m.key] != null ? `${mesures[m.key]} ${m.unit}` : '-'} />
                ))}
              </View>
            </View>
          </>
        )}

        {/* PIECES REMPLACEES */}
        {pieces.length > 0 && (
          <>
            <Text style={s.sectionTitle}>PIECES REMPLACEES</Text>
            <View style={s.tableHeader}>
              <Text style={[s.tableHeaderCell, { flex: 3 }]}>Designation</Text>
              <Text style={[s.tableHeaderCell, { flex: 2 }]}>Reference</Text>
              <Text style={[s.tableHeaderCell, { flex: 1, textAlign: 'center' }]}>Qte</Text>
              <Text style={[s.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Prix HT</Text>
            </View>
            {pieces.map((p, i) => (
              <View key={i} style={s.tableRow}>
                <Text style={[s.tableCell, { flex: 3 }]}>{p.designation}</Text>
                <Text style={[s.tableCell, { flex: 2 }]}>{p.reference || '-'}</Text>
                <Text style={[s.tableCell, { flex: 1, textAlign: 'center' }]}>{p.quantite}</Text>
                <Text style={[s.tableCell, { flex: 1, textAlign: 'right' }]}>{p.prix_ht ? `${p.prix_ht} EUR` : '-'}</Text>
              </View>
            ))}
          </>
        )}

        {/* BILAN */}
        <Text style={s.sectionTitle}>BILAN REGLEMENTAIRE</Text>
        <View style={[s.bilanBox, { backgroundColor: bilanBg, border: `1px solid ${bilanColor}` }]}>
          <Text style={[s.bilanTitle, { color: bilanColor }]}>{bilanLabel}</Text>
          {data.anomalies_detail && <Text style={{ fontSize: 6.5, marginTop: 2 }}>{data.anomalies_detail}</Text>}
          {data.action_corrective && <Text style={{ fontSize: 6, color: C.gris, marginTop: 1 }}>Action : {data.action_corrective}</Text>}
        </View>
        {data.recommandations && (
          <View style={{ marginTop: 2 }}>
            <Field label="Recommandations" value={data.recommandations} />
          </View>
        )}
        {/* TVA retirée du certificat — information contractuelle, pas technique */}

        {/* SIGNATURE TECHNICIEN */}
        <View style={s.signatureZone}>
          <View style={s.signatureBlock}>
            <Text style={s.signatureLabel}>Technicien</Text>
            {data.signature_client_base64 ? (
              <Image style={s.signatureImage} src={data.signature_client_base64} />
            ) : null}
            <Text style={s.signatureName}>{data.technicien_nom || '-'}</Text>
            <Text style={s.signatureDate}>{data.date_intervention}</Text>
          </View>
        </View>

        {/* PIED DE PAGE */}
        <View style={s.footer}>
          <Text style={s.footerText}>
            Mayer Energie - SASU SIRET 100 288 224 00015 - Gaillac (81600) - RGE QualiPAC, QualiBois
          </Text>
        </View>
      </Page>
    </Document>
  );
}

// ============================================================================
// EXPORT
// ============================================================================

export async function generatePdfBlob(data) {
  const blob = await pdf(<CertificatDocument data={data} />).toBlob();
  return blob;
}

export { CertificatDocument };
