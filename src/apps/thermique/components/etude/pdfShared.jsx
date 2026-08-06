/* eslint-disable react-refresh/only-export-components -- module de rendu PDF : rien n'est monté
   dans l'arbre React de l'app (les composants servent à produire un blob), Fast Refresh ne
   s'applique pas. Palette et formatters doivent vivre à côté des composants qui les consomment. */
// src/apps/thermique/components/etude/pdfShared.jsx
// Socle commun des pages du rapport thermique PDF : palette (deutan — bleu/ambre/slate, JAMAIS
// rouge/vert, règle produit R12), formatters PDF-safe, cartouche société et footer légal.
//
// ⚠️ Gotcha Helvetica (police PDF de base, encodage WinAnsi) : les caractères hors cp1252 sortent
// en artefact. Concrètement, dans TOUT texte de ce rapport :
//   — interdits : les lettres grecques (theta, Delta, Phi), les flèches, ≈ ≥ ≤ − (moins typo).
//     On écrit « T° extérieure de base », « majoration Utb », « Puissance » en toutes lettres.
//   — autorisés (présents en cp1252) : ° ² · × — – ’ « » € %
//   — toLocaleString('fr-FR') insère une espace fine insécable U+202F dans les milliers → tous les
//     formatters ci-dessous la normalisent en espace ordinaire (\s couvre U+202F et U+00A0).
import { Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { formatFullAddress, buildLegalFooter } from '@lib/orgBranding';

export const C = {
  bleuF: '#1d4ed8',
  bleu: '#3b82f6',
  bleuPale: '#eff6ff',
  ambre: '#f59e0b',
  ambrePale: '#fffbeb',
  ambreTxt: '#b45309',
  slate: '#334155',
  grisBar: '#d1d5db',
  grisClair: '#f3f4f6',
  grisTxt: '#6b7280',
  noir: '#1f2937',
  blanc: '#ffffff',
};

// Couleur d'accent de l'org (branding multi-tenant) — bandeaux, titres, cartouche.
// Les GRAPHIQUES et l'échelle des pièces restent en palette deutan, jamais l'accent org.
export const accentOf = (company) => company?.accentColor || C.bleuF;

// --- Formatters PDF-safe (cf. gotcha Helvetica en tête de fichier) ---
const sansEspaceFine = (s) => String(s).replace(/\s/g, ' ');
export const fmtInt = (n) => (Number.isFinite(n) ? sansEspaceFine(Math.round(n).toLocaleString('fr-FR')) : '—');
export const numStr = (x) => String(x).replace('.', ',');
/** n décimales, virgule FR, sans passer par toLocaleString (pas d'espace fine à nettoyer). */
export const fmtDec = (n, d = 1) => (Number.isFinite(n) ? numStr(n.toFixed(d)) : '—');
export const watt = (n) => (Number.isFinite(n) ? `${fmtInt(n)} W` : '—');
export const kw = (n) => (Number.isFinite(n) ? `${fmtDec(n / 1000, 1)} kW` : '—');
export const kwh = (n) => (Number.isFinite(n) ? `${fmtInt(n)} kWh` : '—');
export const eur = (n) => (Number.isFinite(n) ? `${fmtInt(n)} €` : '—');
export const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)} %` : '—');
export const degC = (n) => (Number.isFinite(n) ? `${fmtDec(n, 1)} °C` : '—');
export const m2 = (n) => (Number.isFinite(n) ? `${fmtDec(n, 1)} m²` : '—');
export const uVal = (n) => (Number.isFinite(n) ? `${fmtDec(n, 2)} W/(m²·K)` : '—');

export const sharedStyles = StyleSheet.create({
  page: { padding: 32, paddingBottom: 54, fontSize: 8, fontFamily: 'Helvetica', color: C.noir },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, paddingBottom: 8, borderBottom: `1.5px solid ${C.bleuF}` },
  companyName: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  companyLine: { fontSize: 7, color: C.grisTxt, marginTop: 1 },
  logo: { width: 64, maxHeight: 40, objectFit: 'contain' },
  sectionTitle: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 5, borderBottom: `0.5px solid ${C.grisBar}`, paddingBottom: 2 },
  footer: { position: 'absolute', bottom: 18, left: 32, right: 32, borderTop: `0.5px solid ${C.grisBar}`, paddingTop: 4 },
  footerText: { fontSize: 5.8, color: C.grisTxt, textAlign: 'center' },
  pageNum: { fontSize: 5.8, color: C.grisTxt, textAlign: 'center', marginTop: 2 },
  // Cartes d'indicateurs
  kpiRow: { flexDirection: 'row', gap: 8 },
  kpi: { flex: 1, border: `0.7px solid ${C.grisBar}`, borderRadius: 4, padding: 7 },
  kpiLabel: { fontSize: 6.5, color: C.grisTxt },
  kpiValue: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  kpiHint: { fontSize: 6, color: C.grisTxt, marginTop: 1 },
  // Tableaux
  th: { fontSize: 6.5, color: C.grisTxt, fontFamily: 'Helvetica-Bold' },
  td: { fontSize: 7.5 },
  rowLine: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, borderBottom: `0.4px solid ${C.grisClair}` },
  // Encarts
  encart: { flexDirection: 'row', gap: 5, borderRadius: 4, padding: 6, marginTop: 6 },
  encartTxt: { fontSize: 7, flex: 1 },
});

export function CompanyHeader({ company }) {
  const address = formatFullAddress(company);
  return (
    <View style={sharedStyles.header}>
      <View style={{ flex: 1 }}>
        <Text style={[sharedStyles.companyName, { color: accentOf(company) }]}>{company.name}</Text>
        {address ? <Text style={sharedStyles.companyLine}>{address}</Text> : null}
        <Text style={sharedStyles.companyLine}>
          {[company.phone, company.email].filter(Boolean).join('  ·  ')}
        </Text>
        {company.rgeCertifications?.length > 0 && (
          <Text style={sharedStyles.companyLine}>Certifications : {company.rgeCertifications.join(', ')}</Text>
        )}
      </View>
      {company.logoUrl ? <Image src={company.logoUrl} style={sharedStyles.logo} /> : null}
    </View>
  );
}

export function Footer({ company }) {
  const legal = buildLegalFooter(company);
  return (
    <View style={sharedStyles.footer} fixed>
      {legal ? <Text style={sharedStyles.footerText}>{legal}</Text> : null}
      <Text style={sharedStyles.footerText}>
        Étude thermique indicative, non contractuelle — méthode EN 12831 simplifiée avec forfaits
        assumés (ponts thermiques, relance, ventilation). Les puissances et consommations réelles
        varient selon la météo, l’usage et la qualité de mise en oeuvre.
      </Text>
      <Text
        style={sharedStyles.pageNum}
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </View>
  );
}

export function SectionTitle({ children, company }) {
  return <Text style={[sharedStyles.sectionTitle, { color: accentOf(company) }]}>{children}</Text>;
}

/** Carte d'indicateur : libellé, valeur, précision optionnelle. */
export function Kpi({ label, value, hint, color }) {
  return (
    <View style={sharedStyles.kpi}>
      <Text style={sharedStyles.kpiLabel}>{label}</Text>
      <Text style={[sharedStyles.kpiValue, color ? { color } : null]}>{value}</Text>
      {hint ? <Text style={sharedStyles.kpiHint}>{hint}</Text> : null}
    </View>
  );
}

/** Encart d'information / d'alerte (jamais rouge/vert — bleu ou ambre, R12). */
export function Encart({ children, ton = 'info' }) {
  const ambre = ton === 'alerte';
  return (
    <View style={[sharedStyles.encart, { backgroundColor: ambre ? C.ambrePale : C.bleuPale }]}>
      <Text style={[sharedStyles.encartTxt, { color: ambre ? C.ambreTxt : C.bleuF }]}>{children}</Text>
    </View>
  );
}

/** Ligne « libellé / valeur » des tableaux d'hypothèses. */
export function DefLine({ label, value, largeur = 130 }) {
  return (
    <View style={sharedStyles.rowLine}>
      <Text style={[sharedStyles.td, { width: largeur, color: C.grisTxt }]}>{label}</Text>
      <Text style={[sharedStyles.td, { flex: 1 }]}>{value}</Text>
    </View>
  );
}
