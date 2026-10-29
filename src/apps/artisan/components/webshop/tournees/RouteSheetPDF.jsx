/* eslint-disable react-refresh/only-export-components -- module de rendu PDF (blob), jamais monté
   dans l'arbre React : Fast Refresh ne s'applique pas. */
/**
 * RouteSheetPDF.jsx — Feuille de route d'une tournée de livraison palettes (A4)
 * ============================================================================
 * Page 1 : récapitulatif + arrêts (ordre, client, téléphone, adresse, produits,
 * commentaire, emplacements) et lien d'itinéraire. Puis un bon de livraison par
 * commande (signatures client / chauffeur) — même document que celui que le site
 * envoie au transporteur (lib/boutique/livraison/FeuilleDeRoutePdf.tsx), au gabarit
 * Majord'home (`@lib/pdfShared`).
 *
 * Aucun calcul ici : tout vient de `buildRouteSheet` (src/lib/webshop/tournees.js).
 * ⚠️ Helvetica / WinAnsi : pas de flèches ni de glyphes hors cp1252 (« • × – · — » OK).
 * ============================================================================
 */
import { Document, Page, Text, View, Link, StyleSheet, pdf } from '@react-pdf/renderer';
import { C, accentOf, sharedStyles, CompanyHeader } from '@lib/pdfShared';

// U+202F / U+00A0 absents de Helvetica : espace ordinaire (\s les couvre).
const t = (v) => String(v ?? '').replace(/\s/g, ' ');
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

const s = StyleSheet.create({
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  subtitle: { fontSize: 9, color: C.grisTxt, marginTop: 2 },
  recap: { flexDirection: 'row', gap: 14, backgroundColor: C.grisClair, padding: 7, borderRadius: 4, marginBottom: 6 },
  recapTxt: { fontSize: 8.5 },
  link: { fontSize: 8.5, marginBottom: 8 },
  stop: { border: `0.7px solid ${C.grisBar}`, borderRadius: 4, padding: 7, marginBottom: 6 },
  stopHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  stopNum: { color: C.blanc, fontFamily: 'Helvetica-Bold', fontSize: 9, paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 3, marginRight: 6 },
  stopName: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  muted: { fontSize: 8.5, color: C.grisTxt },
  body: { fontSize: 9 },
  comment: { fontSize: 8.5, fontFamily: 'Helvetica-Oblique', color: C.slate, marginTop: 2 },
  instructions: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.ambreTxt, backgroundColor: C.ambrePale, padding: 3, borderRadius: 2, marginTop: 3 },
  pallets: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  h2: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 10, marginBottom: 4 },
  signature: { marginTop: 40, borderTop: `0.7px solid ${C.grisBar}`, paddingTop: 8, flexDirection: 'row', justifyContent: 'space-between' },
  footer: { position: 'absolute', bottom: 18, left: 32, right: 32, borderTop: `0.5px solid ${C.grisBar}`, paddingTop: 4 },
  footerTxt: { fontSize: 6.5, color: C.grisTxt, textAlign: 'center' },
});

function Footer({ company }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerTxt}>{t([company.name, company.phone, company.email].filter(Boolean).join(' — '))}</Text>
    </View>
  );
}

function Stop({ stop, accent }) {
  return (
    <View style={s.stop} wrap={false}>
      <View style={s.stopHead}>
        <Text style={[s.stopNum, { backgroundColor: accent }]}>{stop.order}</Text>
        <Text style={s.stopName}>{t(stop.name)}</Text>
        {stop.phone ? <Text style={[s.muted, { marginLeft: 6 }]}>— {t(stop.phone)}</Text> : null}
      </View>
      <Text style={s.body}>{t(stop.address)}</Text>
      {stop.orders.map((o) => (
        <View key={o.orderNumber} style={{ marginTop: 4 }}>
          <Text style={s.muted}>Commande {o.orderNumber}</Text>
          {o.lines.map((l, i) => <Text key={i} style={s.body}>• {t(l.name)} × {l.qty}</Text>)}
          {o.comment ? <Text style={s.comment}>Client : {t(o.comment)}</Text> : null}
          {o.instructions ? <Text style={s.instructions}>Consigne : {t(o.instructions)}</Text> : null}
        </View>
      ))}
      <Text style={s.pallets}>{plural(stop.pallets, 'emplacement')} palette</Text>
    </View>
  );
}

function RouteSheetDocument({ sheet, company }) {
  const accent = accentOf(company);
  const km = sheet.kmEstimated !== null
    ? `${sheet.kmEstimated} km estimés${sheet.maxKm ? ` (plafond ${sheet.maxKm} km)` : ''}`
    : (sheet.maxKm ? `Plafond ${sheet.maxKm} km` : null);
  return (
    <Document title={`Feuille de route ${sheet.date} ${sheet.sector.code}`} author={company.name}>
      <Page size="A4" style={sharedStyles.page}>
        <CompanyHeader company={company} />
        <View style={s.titleRow}>
          <View>
            <Text style={[s.title, { color: accent }]}>Feuille de route</Text>
            <Text style={s.subtitle}>{t(sheet.dateLabel)} — {t(sheet.sector.label)} ({sheet.sector.code})</Text>
          </View>
        </View>
        <View style={s.recap}>
          <Text style={s.recapTxt}>Départ : {t(sheet.depot)}</Text>
          <Text style={s.recapTxt}>{plural(sheet.stops.length, 'arrêt')}</Text>
          <Text style={s.recapTxt}>{plural(sheet.pallets, 'emplacement')}</Text>
          {km ? <Text style={s.recapTxt}>{km}</Text> : null}
        </View>
        <Link src={sheet.itineraryUrl} style={[s.link, { color: accent }]}>Ouvrir l&apos;itinéraire complet dans Google Maps</Link>
        <Text style={s.h2}>Arrêts</Text>
        {sheet.stops.map((stop) => <Stop key={stop.order} stop={stop} accent={accent} />)}
        <Footer company={company} />
      </Page>
      {sheet.stops.flatMap((stop) => stop.orders.map((o) => (
        <Page key={o.orderNumber} size="A4" style={sharedStyles.page}>
          <CompanyHeader company={company} />
          <Text style={[s.title, { color: accent }]}>Bon de livraison</Text>
          <Text style={s.subtitle}>Commande {o.orderNumber} — {t(sheet.dateLabel)}</Text>
          <Text style={s.h2}>Destinataire</Text>
          <Text style={s.body}>{t(o.name)}</Text>
          <Text style={s.body}>{t(stop.address)}</Text>
          <Text style={s.body}>{t([o.phone, o.email].filter(Boolean).join(' — '))}</Text>
          <Text style={s.h2}>Produits livrés</Text>
          {o.lines.map((l, i) => <Text key={i} style={s.body}>• {t(l.name)} × {l.qty}</Text>)}
          {o.comment ? <Text style={[s.comment, { marginTop: 8 }]}>Commentaire client : {t(o.comment)}</Text> : null}
          {o.instructions ? <Text style={[s.instructions, { marginTop: 6 }]}>Consigne de livraison : {t(o.instructions)}</Text> : null}
          <View style={s.signature}>
            <Text style={s.body}>Signature du client :</Text>
            <Text style={s.body}>Signature du chauffeur :</Text>
          </View>
          <Footer company={company} />
        </Page>
      )))}
    </Document>
  );
}

export async function generateRouteSheetPdfBlob({ sheet, company }) {
  return pdf(<RouteSheetDocument sheet={sheet} company={company} />).toBlob();
}
