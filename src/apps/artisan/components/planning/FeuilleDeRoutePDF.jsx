/* eslint-disable react-refresh/only-export-components -- module de rendu PDF (blob), jamais monté
   dans l'arbre React : Fast Refresh ne s'applique pas. */
/**
 * FeuilleDeRoutePDF.jsx — Feuille de route d'une journée (A4 portrait)
 * ============================================================================
 * Ce que le technicien emporte : la carte du tracé, les arrêts dans l'ordre
 * avec le trajet avant chacun, le retour (point du technicien, agence par défaut) et les totaux.
 *
 * Le document n'effectue AUCUN calcul : tout vient de `buildFeuilleDeRoute`
 * (src/lib/feuilleDeRoute.js), le même modèle que le panneau du Planning.
 *
 * ⚠️ Helvetica / WinAnsi : pas de flèches ni de glyphes hors cp1252 (« – · — » OK).
 * ============================================================================
 */
import { Document, Page, Text, View, Image, StyleSheet, pdf } from '@react-pdf/renderer';
import { C, accentOf, sharedStyles, CompanyHeader } from '@lib/pdfShared';
import { formatDureeRoute, formatKm } from '@/lib/feuilleDeRoute';

const s = StyleSheet.create({
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6 },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  subtitle: { fontSize: 9, color: C.grisTxt, marginTop: 2 },
  totals: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.blanc, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 4 },
  map: { width: '100%', height: 220, objectFit: 'cover', borderRadius: 4, marginTop: 6, marginBottom: 4 },
  warn: { fontSize: 7.5, color: C.slate, fontFamily: 'Helvetica-Oblique', marginBottom: 4 },

  leg: { flexDirection: 'row', alignItems: 'center', marginLeft: 20, marginVertical: 2 },
  legTxt: { fontSize: 7.5, color: C.grisTxt },
  depot: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.slate, marginTop: 4 },

  card: { flexDirection: 'row', borderRadius: 3, backgroundColor: C.grisClair, overflow: 'hidden' },
  rang: { width: 20, alignItems: 'center', justifyContent: 'center' },
  rangTxt: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.blanc },
  cardBody: { flex: 1, paddingVertical: 5, paddingHorizontal: 7 },
  line1: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  time: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', width: 64 },
  type: { fontSize: 9.5, fontFamily: 'Helvetica-Bold' },
  client: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', flex: 1 },
  sector: { fontSize: 7.5, color: C.slate },
  meta: { flexDirection: 'row', gap: 6, marginTop: 2, marginLeft: 70 },
  metaTxt: { fontSize: 8, color: C.slate },
  metaLabel: { fontSize: 8, color: C.grisTxt },
  note: { fontSize: 7.5, color: C.slate, marginTop: 2, marginLeft: 70, fontFamily: 'Helvetica-Oblique' },
  empty: { fontSize: 9, color: C.grisTxt, fontFamily: 'Helvetica-Oblique', marginTop: 10 },

  footer: { position: 'absolute', bottom: 18, left: 32, right: 32, borderTop: `0.5px solid ${C.grisBar}`, paddingTop: 4, flexDirection: 'row', justifyContent: 'space-between' },
  footerTxt: { fontSize: 6.5, color: C.grisTxt },
});

function Leg({ troncon, label, estime }) {
  if (!troncon) return null;
  return (
    <View style={s.leg}>
      <Text style={s.legTxt}>
        {label} : {formatDureeRoute(troncon.minutes)} · {formatKm(troncon.km)}{estime ? ' (estimé)' : ''}
      </Text>
    </View>
  );
}

function Stop({ item, accent, estime }) {
  return (
    <View wrap={false}>
      {item.localise
        ? <Leg troncon={item.trajetAvant} label="Trajet" estime={estime} />
        : <View style={s.leg}><Text style={s.legTxt}>Adresse non localisée — hors itinéraire</Text></View>}
      <View style={s.card}>
        <View style={[s.rang, { backgroundColor: item.localise ? accent : C.grisBar }]}>
          <Text style={s.rangTxt}>{item.rang}</Text>
        </View>
        <View style={s.cardBody}>
          <View style={s.line1}>
            <Text style={s.time}>{item.time}</Text>
            <Text style={s.type}>{item.typeLabel}</Text>
            <Text style={s.client}>{item.clientName || ''}</Text>
            {item.sector ? <Text style={s.sector}>Secteur {item.sector}</Text> : null}
          </View>
          {(item.address || item.phone) ? (
            <View style={s.meta}>
              {item.address ? <Text style={s.metaTxt}>{item.address}</Text> : null}
              {item.phone ? <Text style={s.metaTxt}>· {item.phone}</Text> : null}
            </View>
          ) : null}
          {item.equipments.length > 0 ? (
            <View style={s.meta}>
              <Text style={s.metaLabel}>Équipements :</Text>
              <Text style={s.metaTxt}>{item.equipments.join(' · ')}</Text>
            </View>
          ) : null}
          {item.subject ? <Text style={s.note}>{item.subject}</Text> : null}
          {item.description ? <Text style={s.note}>{item.description}</Text> : null}
        </View>
      </View>
    </View>
  );
}

function FeuilleDeRouteDocument({ model, company, carte }) {
  const accent = accentOf(company);
  const n = model.items.length;
  return (
    <Document title={`Feuille de route ${model.personName} — ${model.date}`} author={company?.name || ''}>
      <Page size="A4" style={sharedStyles.page}>
        <CompanyHeader company={company} />
        <View style={s.titleRow}>
          <View>
            <Text style={[s.title, { color: accent }]}>Feuille de route de {model.personName}</Text>
            <Text style={s.subtitle}>
              {model.dateLabel} · {n === 0 ? 'aucune intervention' : n === 1 ? '1 intervention' : `${n} interventions`}
            </Text>
          </View>
          {model.totaux ? (
            <Text style={[s.totals, { backgroundColor: accent }]}>
              Route : {formatDureeRoute(model.totaux.minutes)} · {formatKm(model.totaux.km)}
            </Text>
          ) : null}
        </View>

        {carte ? <Image src={carte} style={s.map} /> : null}
        {model.estime ? <Text style={s.warn}>Temps de trajet estimés à vol d&apos;oiseau (calcul routier indisponible).</Text> : null}
        {model.nbNonLocalises > 0 ? (
          <Text style={s.warn}>
            {model.nbNonLocalises === 1 ? '1 adresse non localisée' : `${model.nbNonLocalises} adresses non localisées`} : hors itinéraire et hors totaux.
          </Text>
        ) : null}

        {n === 0 ? <Text style={s.empty}>Aucune intervention ce jour-là.</Text> : (
          <>
            <Text style={s.depot}>Départ : {model.departLabel}</Text>
            {model.items.map((it) => <Stop key={it.id} item={it} accent={accent} estime={model.estime} />)}
            <Leg troncon={model.retour} label="Retour" estime={model.estime} />
            {model.retour ? <Text style={s.depot}>Arrivée : {model.retourLabel}</Text> : null}
          </>
        )}

        <View style={s.footer} fixed>
          <Text style={s.footerTxt}>{model.editedLabel}</Text>
          <Text style={s.footerTxt} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Rendu → Blob (point d'entrée de `feuilleDeRouteExport.js`). */
export async function generateFeuilleDeRoutePdfBlob({ model, company, carte }) {
  return pdf(<FeuilleDeRouteDocument model={model} company={company} carte={carte} />).toBlob();
}
