/**
 * FicheTechniquePdf.jsx - Majord'home Artisan
 * ============================================================================
 * Template PDF pour la Fiche Technique Terrain.
 * Utilise @react-pdf/renderer (lazy import dans le consumer).
 *
 * Génère un document sobre et professionnel :
 * - Header : titre + date + client
 * - Sections : Contexte, Bâtiment (si rempli), Relevé technique, Synthèse
 * - Photos : images intégrées par catégorie
 * - Footer : généré le + nom commercial
 * ============================================================================
 */

import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  Font,
} from '@react-pdf/renderer';
import {
  BUILDING_TYPES,
  INSULATION_TYPES,
  GLAZING_TYPES,
  DPE_RATINGS,
  ENERGY_TYPES,
  EQUIPMENT_CONDITIONS,
  ECS_TYPES,
  AC_TYPES,
  OUTDOOR_ACCESS,
  NEXT_STEPS,
} from './FicheTechniqueConfig';

// ============================================================================
// STYLES
// ============================================================================

const colors = {
  primary: '#1e40af',
  dark: '#1f2937',
  medium: '#4b5563',
  light: '#9ca3af',
  border: '#e5e7eb',
  bg: '#f9fafb',
  white: '#ffffff',
};

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: colors.dark,
    paddingTop: 40,
    paddingBottom: 60,
    paddingHorizontal: 40,
  },
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: colors.primary,
  },
  headerSubtitle: {
    fontSize: 10,
    color: colors.medium,
    marginTop: 4,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  headerDate: {
    fontSize: 9,
    color: colors.medium,
  },
  // Section
  section: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: colors.primary,
    marginBottom: 8,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    textTransform: 'uppercase',
  },
  // Grid rows
  row: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  labelCell: {
    width: '35%',
    fontSize: 8,
    color: colors.light,
    textTransform: 'uppercase',
  },
  valueCell: {
    width: '65%',
    fontSize: 9,
    color: colors.dark,
  },
  // Two column grid
  twoColRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  twoColItem: {
    width: '50%',
    flexDirection: 'row',
  },
  twoColLabel: {
    width: '45%',
    fontSize: 8,
    color: colors.light,
    textTransform: 'uppercase',
  },
  twoColValue: {
    width: '55%',
    fontSize: 9,
    color: colors.dark,
  },
  // Text blocks
  textBlock: {
    fontSize: 9,
    color: colors.dark,
    lineHeight: 1.5,
    marginBottom: 6,
    padding: 6,
    backgroundColor: colors.bg,
    borderRadius: 3,
  },
  textBlockLabel: {
    fontSize: 8,
    color: colors.light,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  // Boolean
  boolYes: { color: '#059669' },
  boolNo: { color: '#dc2626' },
  boolWarn: { color: '#d97706' },
  // Photos
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  photoItem: {
    width: '48%',
    marginBottom: 6,
  },
  photoImage: {
    width: '100%',
    height: 140,
    objectFit: 'cover',
    borderRadius: 4,
  },
  photoCaption: {
    fontSize: 7,
    color: colors.light,
    marginTop: 2,
    textAlign: 'center',
  },
  // Checkboxes
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },
  checkBox: {
    width: 10,
    height: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 2,
    marginRight: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkBoxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkMark: {
    fontSize: 7,
    color: colors.white,
    fontFamily: 'Helvetica-Bold',
  },
  checkLabel: {
    fontSize: 9,
    color: colors.dark,
  },
  // Footer
  footer: {
    position: 'absolute',
    bottom: 25,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  footerText: {
    fontSize: 7,
    color: colors.light,
  },
});

// ============================================================================
// HELPERS
// ============================================================================

function getLabel(options, value) {
  if (!value) return '—';
  const opt = options.find((o) => o.value === value);
  return opt?.label || value;
}

function formatBool(value, yesLabel = 'Oui', noLabel = 'Non') {
  if (value === true) return yesLabel;
  if (value === false) return noLabel;
  return '—';
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

// ============================================================================
// FIELD ROW COMPONENT
// ============================================================================

function FieldRow({ label, value }) {
  if (!value || value === '—') return null;
  return (
    <View style={styles.row}>
      <Text style={styles.labelCell}>{label}</Text>
      <Text style={styles.valueCell}>{value}</Text>
    </View>
  );
}

function TwoColField({ label, value }) {
  return (
    <View style={styles.twoColItem}>
      <Text style={styles.twoColLabel}>{label}</Text>
      <Text style={styles.twoColValue}>{value || '—'}</Text>
    </View>
  );
}

function BoolField({ label, value, yesStyle, noStyle }) {
  const display = formatBool(value);
  const textStyle = value === true ? (yesStyle || styles.boolYes) : value === false ? (noStyle || styles.boolNo) : {};
  return (
    <View style={styles.row}>
      <Text style={styles.labelCell}>{label}</Text>
      <Text style={[styles.valueCell, textStyle]}>{display}</Text>
    </View>
  );
}

function CheckItem({ checked, label }) {
  return (
    <View style={styles.checkRow}>
      <View style={[styles.checkBox, checked && styles.checkBoxChecked]}>
        {checked && <Text style={styles.checkMark}>✓</Text>}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </View>
  );
}

// ============================================================================
// PDF DOCUMENT
// ============================================================================

/**
 * @param {Object} props
 * @param {Object} props.visit - Données de la fiche technique
 * @param {Object} props.lead - Données du lead
 * @param {Array} props.photos - Photos avec signed URLs [{category, file_name, signed_url}]
 * @param {string} [props.logoUrl] - URL du logo entreprise (optionnel)
 */
export function FicheTechniquePdf({ visit, lead, photos = [], logoUrl }) {
  if (!visit || !lead) return null;

  const clientName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Sans nom';
  const address = [lead.address, lead.address_complement, lead.postal_code, lead.city].filter(Boolean).join(', ');
  const generatedAt = new Date().toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Grouper photos par catégorie
  const photosByCategory = {};
  photos.forEach((p) => {
    const cat = p.category || 'other';
    if (!photosByCategory[cat]) photosByCategory[cat] = [];
    photosByCategory[cat].push(p);
  });

  const CATEGORY_LABELS = {
    facade: 'Façade / Accès',
    installation: 'Installation existante',
    implantation_zone: "Zone d'implantation",
    electrical_panel: 'Tableau électrique',
    other: 'Autre',
  };

  // Section bâtiment a-t-elle du contenu ?
  const hasBatiment = visit.building_type || visit.building_surface || visit.building_year
    || visit.insulation_type || visit.glazing_type || visit.dpe_rating;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* HEADER */}
        <View style={styles.header}>
          <View>
            {logoUrl && (
              <Image src={logoUrl} style={{ width: 120, height: 40, objectFit: 'contain', marginBottom: 6 }} />
            )}
            <Text style={styles.headerTitle}>Fiche Technique Terrain</Text>
            <Text style={styles.headerSubtitle}>{clientName}</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.headerDate}>{formatDate(visit.visit_date)}</Text>
            <Text style={[styles.headerDate, { marginTop: 2 }]}>
              {visit.commercial_name || ''}
            </Text>
          </View>
        </View>

        {/* CONTEXTE */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contexte</Text>
          <FieldRow label="Client" value={clientName} />
          <FieldRow label="Adresse" value={address} />
          <FieldRow label="Commercial" value={visit.commercial_name} />
          <FieldRow label="Date visite" value={formatDate(visit.visit_date)} />
          <FieldRow label="Projet" value={visit.project_type} />
        </View>

        {/* BÂTIMENT (si rempli) */}
        {hasBatiment && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Description du bâtiment</Text>
            <FieldRow label="Type" value={getLabel(BUILDING_TYPES, visit.building_type)} />
            <View style={styles.twoColRow}>
              <TwoColField label="Surface" value={visit.building_surface ? `${visit.building_surface} m²` : null} />
              <TwoColField label="Année" value={visit.building_year} />
            </View>
            <View style={styles.twoColRow}>
              <TwoColField label="Niveaux" value={visit.building_levels} />
              <TwoColField label="Pièces" value={visit.building_rooms} />
            </View>
            <FieldRow label="Isolation" value={getLabel(INSULATION_TYPES, visit.insulation_type)} />
            <FieldRow label="Vitrage" value={getLabel(GLAZING_TYPES, visit.glazing_type)} />
            <FieldRow label="DPE" value={getLabel(DPE_RATINGS, visit.dpe_rating)} />
            <FieldRow label="N° DPE (ADEME)" value={visit.dpe_number} />
          </View>
        )}

        {/* INSTALLATION EXISTANTE */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Installation existante</Text>
          <FieldRow label="Énergie" value={getLabel(ENERGY_TYPES, visit.existing_energy)} />
          <FieldRow label="Équipement" value={visit.existing_equipment_type} />
          <FieldRow label="Marque/Modèle" value={visit.existing_brand_model} />
          <View style={styles.twoColRow}>
            <TwoColField label="Année" value={visit.existing_year} />
            <TwoColField label="État" value={getLabel(EQUIPMENT_CONDITIONS, visit.existing_condition)} />
          </View>
          <FieldRow label="ECS" value={getLabel(ECS_TYPES, visit.existing_ecs)} />
          <BoolField label="Climatisation" value={visit.existing_ac} />
          {visit.existing_ac === true && (
            <FieldRow label="Type climatisation" value={getLabel(AC_TYPES, visit.existing_ac_type)} />
          )}
          {visit.existing_observations && (
            <>
              <Text style={styles.textBlockLabel}>Observations</Text>
              <Text style={styles.textBlock}>{visit.existing_observations}</Text>
            </>
          )}
        </View>

        {/* CONTRAINTES TERRAIN */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contraintes terrain</Text>
          <FieldRow label="Accès extérieur" value={getLabel(OUTDOOR_ACCESS, visit.outdoor_access)} />
          <BoolField label="Tableau électrique" value={visit.electrical_panel_ok} yesStyle={styles.boolYes} noStyle={styles.boolWarn} />
          {visit.electrical_panel_notes && (
            <Text style={[styles.textBlock, { marginLeft: 0 }]}>{visit.electrical_panel_notes}</Text>
          )}
          {visit.specific_constraints && (
            <>
              <Text style={styles.textBlockLabel}>Contraintes spécifiques</Text>
              <Text style={styles.textBlock}>{visit.specific_constraints}</Text>
            </>
          )}
        </View>

        {/* PHOTOS */}
        {photos.length > 0 && (
          <View style={styles.section} break>
            <Text style={styles.sectionTitle}>Photos</Text>
            {Object.entries(photosByCategory).map(([cat, catPhotos]) => (
              <View key={cat} style={{ marginBottom: 10 }}>
                <Text style={[styles.textBlockLabel, { marginBottom: 4 }]}>
                  {CATEGORY_LABELS[cat] || cat}
                </Text>
                <View style={styles.photoGrid}>
                  {catPhotos.map((photo, idx) => (
                    photo.signed_url ? (
                      <View key={photo.id || idx} style={styles.photoItem}>
                        <Image src={photo.signed_url} style={styles.photoImage} />
                        {photo.file_name && (
                          <Text style={styles.photoCaption}>{photo.file_name}</Text>
                        )}
                      </View>
                    ) : null
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* SYNTHÈSE */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Synthèse & recommandation</Text>
          {visit.key_points && (
            <>
              <Text style={styles.textBlockLabel}>Points clés</Text>
              <Text style={styles.textBlock}>{visit.key_points}</Text>
            </>
          )}
          {visit.product_recommendation && (
            <>
              <Text style={styles.textBlockLabel}>Préconisation produit</Text>
              <Text style={styles.textBlock}>{visit.product_recommendation}</Text>
            </>
          )}

          {/* Next steps */}
          <Text style={[styles.textBlockLabel, { marginTop: 6 }]}>Suites à donner</Text>
          <View style={{ marginTop: 4 }}>
            {NEXT_STEPS.map((step) => (
              <CheckItem
                key={step.key}
                checked={visit[step.key] || false}
                label={step.label}
              />
            ))}
          </View>
        </View>

        {/* FOOTER */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Fiche technique — {clientName}
          </Text>
          <Text style={styles.footerText}>
            Généré le {generatedAt}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export default FicheTechniquePdf;
