/**
 * ContractPDF.jsx - Contrat d'Entretien Annuel
 * ============================================================================
 * Template PDF A4 avec @react-pdf/renderer.
 * Reproduit le template HTML N8N (contrat-entretien.ts) de Mayer Énergie.
 * Palette : orange #F97316, noir #1a1a1a, gris #666.
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

// Logo Mayer Énergie (PNG base64)
import { LOGO_BASE64 } from './logo-base64';

// ============================================================================
// CONSTANTES
// ============================================================================

const COMPANY = {
  name: 'Mayer Energie',
  legalName: 'MAYER ENERGIE',
  legalForm: 'SAS à associé unique',
  capital: '6 000',
  rcs: '100 288 224 R.C.S. Albi',
  address: '26 Rue des Pyrénées – 81600 Gaillac',
  phone: '05 63 33 23 14',
  email: 'contact@mayer-energie.fr',
  domain: 'mayer-energie.fr',
  assurance: 'Couvert par une assurance responsabilité civile professionnelle',
};

const LEGAL_FOOTER = `${COMPANY.legalName} — ${COMPANY.legalForm}, capital ${COMPANY.capital} € — ${COMPANY.rcs} — ${COMPANY.address} — ${COMPANY.email}`;

// ============================================================================
// COULEURS
// ============================================================================

const C = {
  orange: '#F97316',
  orangeLight: '#FFF7ED',
  orangeBorder: '#FDBA74',
  orangeDark: '#9A3412',
  vert: '#16a34a',
  rouge: '#DC2626',
  noir: '#1a1a1a',
  gris: '#666',
  grisFonce: '#444',
  grisTexte: '#333',
  grisLight: '#aaa',
  grisBorder: '#e5e7eb',
  grisBg: '#fafafa',
  blanc: '#FFFFFF',
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
  pageCGV: {
    padding: '15mm 20mm 20mm 20mm',
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: C.noir,
    position: 'relative',
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
    paddingBottom: 6,
    borderBottomWidth: 3,
    borderBottomColor: C.orange,
    borderBottomStyle: 'solid',
  },
  headerCGV: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 3,
    borderBottomColor: C.orange,
    borderBottomStyle: 'solid',
  },
  logo: { height: 32 },
  headerRight: { alignItems: 'flex-end' },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: C.noir },
  titleCGV: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.noir },
  subtitle: { fontSize: 10, color: C.orange, marginTop: 2 },

  // Ref line
  refLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 9,
    color: C.gris,
    marginBottom: 8,
  },

  // Instructions
  instructions: {
    backgroundColor: C.orangeLight,
    borderWidth: 1,
    borderColor: C.orangeBorder,
    borderStyle: 'solid',
    padding: 8,
    marginBottom: 10,
  },
  instructionText: { fontSize: 8, color: C.orangeDark, marginBottom: 2, lineHeight: 1.4 },

  // Parties
  parties: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  party: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.grisBorder,
    borderStyle: 'solid',
    padding: 8,
  },
  partyLabel: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: C.orange,
    marginBottom: 4,
  },
  partyName: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 3 },
  partyDetail: { fontSize: 8.5, color: C.grisFonce, lineHeight: 1.4 },

  // Section title
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: C.noir,
    marginBottom: 4,
    paddingBottom: 3,
    borderBottomWidth: 2,
    borderBottomColor: C.orange,
    borderBottomStyle: 'solid',
  },

  // Table
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: C.orange,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  tableHeaderCell: {
    color: C.blanc,
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: C.grisBorder,
    borderBottomStyle: 'solid',
  },
  tableRowEven: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: C.grisBorder,
    borderBottomStyle: 'solid',
    backgroundColor: C.grisBg,
  },
  tableCell: { fontSize: 9 },
  tableCellRight: { fontSize: 9, textAlign: 'right' },
  // Subtotal
  rowSubtotal: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: '#ccc',
    borderTopStyle: 'solid',
  },
  subtotalCell: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#555' },
  // Discount
  rowDiscount: {
    flexDirection: 'row',
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  discountCell: { fontSize: 9, color: C.vert, fontStyle: 'italic' },
  // Total
  rowTotal: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderTopWidth: 2,
    borderTopColor: C.orange,
    borderTopStyle: 'solid',
  },
  totalLabel: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  totalValue: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.orange, textAlign: 'right' },

  // Notes
  notes: { fontSize: 8, color: '#888', marginTop: 4, marginBottom: 10, lineHeight: 1.3 },

  // Comments
  commentaires: { marginBottom: 10 },
  commentairesLabel: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#555', marginBottom: 6 },
  commentairesContent: {
    fontSize: 10,
    color: C.grisTexte,
    borderWidth: 1,
    borderColor: C.grisBorder,
    borderStyle: 'solid',
    padding: 8,
    backgroundColor: C.grisBg,
  },

  // Signature
  signatureBlock: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    gap: 20,
  },
  signatureCol: { flex: 1 },
  sigLabel: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#555', marginBottom: 6 },
  signatureBox: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderStyle: 'solid',
    height: 65,
    justifyContent: 'flex-end',
    padding: 5,
  },
  sigHint: { fontSize: 7.5, color: C.grisLight, fontStyle: 'italic' },
  signatureImage: { maxHeight: 60, maxWidth: 180 },
  signatureName: { fontSize: 8, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  signatureDate: { fontSize: 6, color: C.gris },

  // CGV
  cgvTitle: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    marginBottom: 8,
    color: C.noir,
  },
  cgvIntro: { fontSize: 8.5, color: C.grisTexte, marginBottom: 8, lineHeight: 1.4 },
  cgvSection: { marginBottom: 8 },
  cgvSectionTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.orange, marginBottom: 3 },
  cgvText: { fontSize: 8.5, color: C.grisTexte, lineHeight: 1.4 },
  cgvHighlight: { fontSize: 8.5, color: C.rouge, fontFamily: 'Helvetica-Bold' },
  cgvIndent: { marginLeft: 14, fontSize: 8.5, color: C.grisTexte, marginTop: 2 },
  cgvListItem: { fontSize: 8.5, color: C.grisTexte, lineHeight: 1.4, marginLeft: 14, marginBottom: 1.5 },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 22,
    left: 50,
    right: 50,
    borderTopWidth: 0.5,
    borderTopColor: C.grisBorder,
    borderTopStyle: 'solid',
    paddingTop: 4,
    textAlign: 'center',
  },
  footerText: { fontSize: 7.5, color: C.grisLight, textAlign: 'center' },
});

// ============================================================================
// HELPERS
// ============================================================================

const fmtEuro = (v) => {
  const n = parseFloat(v) || 0;
  return n.toFixed(2).replace('.', ',') + ' €';
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

  const hasDiscount = discountPercent > 0 && discountAmount > 0;

  return (
    <Document>
      {/* ================================================================
          PAGE 1 — CONTRAT
          ================================================================ */}
      <Page size="A4" style={s.page}>
        {/* HEADER */}
        <View style={s.header}>
          <View>
            <Image src={LOGO_BASE64} style={s.logo} />
          </View>
          <View style={s.headerRight}>
            <Text style={s.title}>CONTRAT D'ENTRETIEN</Text>
            <Text style={s.subtitle}>Chauffage, Climatisation & Energies Renouvelables</Text>
          </View>
        </View>

        {/* REF LINE */}
        <View style={s.refLine}>
          <Text>Réf. : {contractNumber || '-'}</Text>
          <Text>Date : {fmtDate(new Date().toISOString())}</Text>
        </View>

        {/* INSTRUCTIONS */}
        <View style={s.instructions}>
          <Text style={s.instructionText}>
            En souscrivant à ce contrat, {COMPANY.name} s'engage à vous proposer chaque année un rendez-vous d'entretien dans les 12 mois suivant la dernière intervention.
          </Text>
          <Text style={s.instructionText}>
            Lors de chaque visite, notre technicien vérifiera l'état de vos équipements. Si des pièces défectueuses sont constatées, un devis de remplacement vous sera proposé afin de maintenir votre installation en bon état de fonctionnement.
          </Text>
          <Text style={s.instructionText}>
            Des recommandations pourront être émises à l'issue de l'entretien. Nous vous invitons à les suivre afin de garantir la conformité de votre installation et la validité de l'attestation d'entretien délivrée.
          </Text>
        </View>

        {/* PARTIES */}
        <View style={s.parties}>
          {/* Prestataire */}
          <View style={s.party}>
            <Text style={s.partyLabel}>Le prestataire</Text>
            <Text style={s.partyName}>{COMPANY.legalName}</Text>
            <Text style={s.partyDetail}>
              {COMPANY.legalForm}, capital {COMPANY.capital} €{'\n'}
              {COMPANY.address}{'\n'}
              {COMPANY.rcs}{'\n'}
              Tél : {COMPANY.phone}{'\n'}
              Email : {COMPANY.email}
            </Text>
          </View>
          {/* Client */}
          <View style={s.party}>
            <Text style={s.partyLabel}>Le client</Text>
            <Text style={s.partyName}>{clientName || '-'}</Text>
            <Text style={s.partyDetail}>
              {clientAddress || '-'}{'\n'}
              {clientPostalCode} {clientCity}{'\n'}
              Tél : {clientPhone || '-'}{'\n'}
              Email : {clientEmail || '-'}
            </Text>
          </View>
        </View>

        {/* PRESTATIONS */}
        <Text style={s.sectionTitle}>Prestations souscrites</Text>
        <View style={s.tableHeader}>
          <Text style={[s.tableHeaderCell, { flex: 3 }]}>Prestation</Text>
          <Text style={[s.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Montant TTC</Text>
        </View>
        {equipmentLines.map((line, i) => (
          <View key={i} style={i % 2 === 1 ? s.tableRowEven : s.tableRow}>
            <View style={{ flex: 3 }}>
              <Text style={s.tableCell}>
                {line.label}{line.quantity > 1 ? ` (×${line.quantity})` : ''}
              </Text>
              {line.reference && (
                <Text style={{ fontSize: 8, color: C.gris, marginTop: 1 }}>
                  {line.reference}
                </Text>
              )}
            </View>
            <Text style={[s.tableCellRight, { flex: 1, fontFamily: 'Helvetica-Bold' }]}>
              {line.lineTotal > 0 ? fmtEuro(line.lineTotal) : 'Sur devis'}
            </Text>
          </View>
        ))}

        {/* Sous-total + remise */}
        {hasDiscount && (
          <>
            <View style={s.rowSubtotal}>
              <Text style={[s.subtotalCell, { flex: 3 }]}>Sous-total</Text>
              <Text style={[s.subtotalCell, { flex: 1, textAlign: 'right' }]}>{fmtEuro(subtotal)}</Text>
            </View>
            <View style={s.rowDiscount}>
              <Text style={[s.discountCell, { flex: 3 }]}>
                Dégressivité -{discountPercent}%
              </Text>
              <Text style={[s.discountCell, { flex: 1, textAlign: 'right' }]}>
                -{fmtEuro(discountAmount)}
              </Text>
            </View>
          </>
        )}

        {/* Total */}
        <View style={s.rowTotal}>
          <Text style={[s.totalLabel, { flex: 3 }]}>Total TTC / an</Text>
          <Text style={[s.totalValue, { flex: 1 }]}>{fmtEuro(total)}</Text>
        </View>

        {/* Notes */}
        <View style={s.notes}>
          <Text>
            * Les tarifs mentionnés sont à titre indicatif pour l'année en cours.
            Pour les années suivantes, consulter les tarifs actualisés sur {COMPANY.domain}.
          </Text>
          <Text>
            * Dégressivité : -10% sur le total pour 2 équipements, -15% pour 3 et plus.
          </Text>
        </View>

        {/* Commentaires */}
        {notes && (
          <View style={s.commentaires}>
            <Text style={s.commentairesLabel}>Commentaires :</Text>
            <Text style={s.commentairesContent}>{notes}</Text>
          </View>
        )}

        {/* SIGNATURES */}
        <View style={s.signatureBlock}>
          <View style={s.signatureCol}>
            <Text style={s.sigLabel}>Fait à : {clientCity || '_________________________'}</Text>
            <Text style={{ fontSize: 9, color: '#555', marginTop: 6 }}>Le : {fmtDate(new Date().toISOString())}</Text>
          </View>
          <View style={s.signatureCol}>
            <Text style={s.sigLabel}>Signature du client</Text>
            <View style={s.signatureBox}>
              {signatureBase64 ? (
                <>
                  <Image src={signatureBase64} style={s.signatureImage} />
                </>
              ) : (
                <Text style={s.sigHint}>Précédée de la mention « lu et approuvé, bon pour accord »</Text>
              )}
            </View>
            {signataireNom && <Text style={s.signatureName}>{signataireNom}</Text>}
            {signedAt && <Text style={s.signatureDate}>Signé le {fmtDate(signedAt)}</Text>}
          </View>
        </View>

        {/* FOOTER */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>{LEGAL_FOOTER}</Text>
        </View>
      </Page>

      {/* ================================================================
          PAGE 2 — CONDITIONS GÉNÉRALES
          ================================================================ */}
      <Page size="A4" style={s.pageCGV}>
        {/* HEADER */}
        <View style={s.headerCGV}>
          <View>
            <Image src={LOGO_BASE64} style={s.logo} />
          </View>
          <View style={s.headerRight}>
            <Text style={s.titleCGV}>CONDITIONS GÉNÉRALES</Text>
            <Text style={s.subtitle}>Contrat d'entretien annuel</Text>
          </View>
        </View>

        <Text style={s.cgvTitle}>Conditions générales du contrat d'entretien annuel</Text>
        <Text style={s.cgvIntro}>
          {COMPANY.assurance}.{'\n'}
          Une visite d'entretien devra être effectuée chaque année.
        </Text>

        {/* Article 1 */}
        <View style={s.cgvSection}>
          <Text style={s.cgvSectionTitle}>Article 1 – Objet du contrat</Text>
          <Text style={s.cgvText}>
            Le contrat d'entretien comprend uniquement 1 visite annuelle contractuelle de contrôle technique et de maintenance préventive de l'installation. Les dépannages et réparations ne font pas partie du présent contrat. Seule la maintenance préventive est incluse.
          </Text>
        </View>

        {/* Article 2 */}
        <View style={s.cgvSection}>
          <Text style={s.cgvSectionTitle}>Article 2 – Accès aux équipements</Text>
          <Text style={s.cgvText}>
            Le client s'engage à permettre au technicien de {COMPANY.name} d'intervenir dans les meilleures conditions en lui laissant un libre accès au matériel et un espace suffisant nécessaire à l'exécution des travaux de maintenance.
          </Text>
          <View style={s.cgvIndent}>
            <Text style={s.cgvHighlight}>→ Dans le cas où le technicien ne pourrait pas avoir accès aux équipements, le déplacement sera facturé.</Text>
          </View>
        </View>

        {/* Article 3 */}
        <View style={s.cgvSection}>
          <Text style={s.cgvSectionTitle}>Article 3 – État des équipements</Text>
          <Text style={s.cgvText}>
            Les appareils concernés devront impérativement être à l'arrêt et froids au moment de l'intervention du technicien.
          </Text>
          <View style={s.cgvIndent}>
            <Text style={s.cgvHighlight}>→ Dans le cas contraire, le déplacement sera facturé.</Text>
          </View>
        </View>

        {/* Article 4 */}
        <View style={s.cgvSection}>
          <Text style={s.cgvSectionTitle}>Article 4 – Interventions hors contrat</Text>
          <Text style={s.cgvText}>
            En cas d'intervention d'un technicien de {COMPANY.name} sur appel du client pour des prestations sortant du contrat d'entretien et du cadre de la garantie, il sera appliqué le barème de facturation en vigueur pour le déplacement et la main d'œuvre.
          </Text>
          <Text style={s.cgvIndent}>
            Fournitures et pièces de rechange : prix suivant devis et accord préalable du client.
          </Text>
        </View>

        {/* Article 5 */}
        <View style={s.cgvSection}>
          <Text style={s.cgvSectionTitle}>Article 5 – Garantie constructeur</Text>
          <Text style={s.cgvText}>
            Toutes les demandes pendant la période de garantie de l'appareil devront être faites auprès de l'entreprise qui a vendu et/ou installé celui-ci.
          </Text>
        </View>

        {/* Article 6 */}
        <View style={s.cgvSection}>
          <Text style={s.cgvSectionTitle}>Article 6 – Durée et reconduction</Text>
          <Text style={s.cgvText}>
            Le présent contrat est conclu pour une durée de 1 an à compter de la date du premier entretien. Il se poursuivra ensuite par tacite reconduction par périodes de 1 an, sauf dénonciation par l'une ou l'autre des parties, en respectant un préavis d'un mois avant la fin de la période en cours, notifiée par Lettre Recommandée avec Accusé de Réception.
          </Text>
        </View>

        {/* Article 7 */}
        <View style={s.cgvSection}>
          <Text style={s.cgvSectionTitle}>Article 7 – Prestations incluses</Text>
          <Text style={s.cgvText}>La visite annuelle d'entretien comprend selon le type d'équipement :</Text>
          <Text style={s.cgvListItem}>• Contrôle général de l'installation et vérification du bon fonctionnement</Text>
          <Text style={s.cgvListItem}>• Nettoyage des composants principaux et pièces de fumée</Text>
          <Text style={s.cgvListItem}>• Ramonage des conduits (si applicable)</Text>
          <Text style={s.cgvListItem}>• Vérification des éléments de sécurité et connexions électriques</Text>
          <Text style={s.cgvListItem}>• Vérification de l'étanchéité et des joints</Text>
          <Text style={s.cgvListItem}>• Mesure des performances et réglages si nécessaire</Text>
          <Text style={s.cgvListItem}>• Délivrance du certificat de conformité / attestation d'entretien</Text>
          <Text style={s.cgvListItem}>• Établissement d'un rapport de visite avec recommandations</Text>
        </View>

        {/* Article 8 */}
        <View style={s.cgvSection}>
          <Text style={s.cgvSectionTitle}>Article 8 – Données personnelles</Text>
          <Text style={s.cgvText}>
            Les données collectées sont traitées conformément au RGPD et sont utilisées exclusivement pour la gestion du contrat d'entretien. Le client dispose d'un droit d'accès, de rectification et de suppression de ses données en contactant {COMPANY.email}.
          </Text>
        </View>

        {/* FOOTER */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>{LEGAL_FOOTER}</Text>
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
