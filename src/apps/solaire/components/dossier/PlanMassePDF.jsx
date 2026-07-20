// src/apps/solaire/components/dossier/PlanMassePDF.jsx
// DPC2 — Plan de masse « niveau offre » : fond satellite Mapbox Static à l'échelle du
// bâti, parcelle(s) en trait plein, emprise des pans de toiture (zone PV) en jaune,
// annotation N modules, barre d'échelle métrique + repère Nord, cartouche société.
// La composition satellite+vecteurs vit dans lib/roofMapModel (partagée avec l'étude).
// Limite documentée : pas de cotation orthogonale réglementaire (distances aux limites
// séparatives) — tranche ultérieure, même géométrie cadastre en dessous.
// Fail-loud : échec du fond de carte → throw (le caller signale la pièce manquante).
import { Document, Page, Text, View, Image, Svg, Path, Polygon, Rect, StyleSheet, pdf } from '@react-pdf/renderer';
import { formatFullAddress, buildLegalFooter } from '@lib/orgBranding';
import { buildSatelliteRoofModel } from '../../lib/roofMapModel';

const C = { jaune: '#F5C542', bleuF: '#0D47A1', grisTxt: '#6B7280', grisClair: '#F3F4F6', noir: '#1F2937' };

const MAP_W = 750;
const MAP_H = 420;

const s = StyleSheet.create({
  page: { padding: 32, paddingBottom: 46, fontSize: 9, fontFamily: 'Helvetica', color: C.noir },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10, paddingBottom: 8, borderBottom: `1.5px solid ${C.bleuF}` },
  companyName: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  companyLine: { fontSize: 7, color: C.grisTxt, marginTop: 1.5 },
  logo: { width: 60, height: 30, objectFit: 'contain' },
  title: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  subtitle: { fontSize: 8.5, color: C.grisTxt, marginTop: 1, marginBottom: 8 },
  mapFrame: { width: MAP_W, height: MAP_H, alignSelf: 'center', border: `1px solid ${C.grisTxt}` },
  legend: { flexDirection: 'row', justifyContent: 'space-between', width: MAP_W, alignSelf: 'center', marginTop: 5 },
  legendTxt: { fontSize: 7.5, color: C.grisTxt },
  footer: { position: 'absolute', bottom: 16, left: 32, right: 32, fontSize: 6.5, color: C.grisTxt, textAlign: 'center', borderTop: `0.5px solid ${C.grisClair}`, paddingTop: 4 },
});

/** Superposition satellite + vecteurs (réutilisable à d'autres tailles via roofMap.wPt/hPt). */
export function RoofMapOverlay({ roofMap }) {
  const { wPt, hPt } = roofMap;
  return (
    <>
      <Image src={roofMap.mapDataUrl} style={{ position: 'absolute', top: 0, left: 0, width: wPt, height: hPt }} />
      <Svg width={wPt} height={hPt} viewBox={`0 0 ${wPt} ${hPt}`} style={{ position: 'absolute', top: 0, left: 0 }}>
        {roofMap.parcelPaths.map((d, i) => (
          <Path key={`p-${i}`} d={d} fill="none" stroke="#FFFFFF" strokeWidth={1.6} />
        ))}
        {roofMap.panPaths.map((d, i) => (
          <Path key={`pv-${i}`} d={d} fill={C.jaune} fillOpacity={0.55} stroke={C.noir} strokeWidth={0.8} />
        ))}
        {roofMap.pvLabel ? (
          <>
            <Rect x={roofMap.pvLabel.x - 44} y={roofMap.pvLabel.y - 22} width={88} height={13} rx={3} fill="#FFFFFF" fillOpacity={0.85} />
            <Text x={roofMap.pvLabel.x} y={roofMap.pvLabel.y - 12} style={{ fontSize: 8, fontFamily: 'Helvetica-Bold' }} textAnchor="middle" fill={C.noir}>
              {roofMap.pvLabel.text}
            </Text>
          </>
        ) : null}
        {/* Repère Nord */}
        <Rect x={wPt - 34} y={10} width={24} height={32} rx={3} fill="#FFFFFF" fillOpacity={0.85} />
        <Polygon points={`${wPt - 22},14 ${wPt - 28},30 ${wPt - 16},30`} fill={C.noir} />
        <Text x={wPt - 22} y={40} style={{ fontSize: 8, fontFamily: 'Helvetica-Bold' }} textAnchor="middle" fill={C.noir}>N</Text>
        {/* Barre d'échelle métrique */}
        {roofMap.scale ? (
          <>
            <Rect x={8} y={hPt - 28} width={roofMap.scale.lengthPt + 8 + 30} height={20} rx={3} fill="#FFFFFF" fillOpacity={0.85} />
            <Path
              d={`M 12 ${hPt - 20} L 12 ${hPt - 16} L ${12 + roofMap.scale.lengthPt} ${hPt - 16} L ${12 + roofMap.scale.lengthPt} ${hPt - 20}`}
              stroke={C.noir}
              strokeWidth={1}
              fill="none"
            />
            <Text x={12 + roofMap.scale.lengthPt + 5} y={hPt - 15} style={{ fontSize: 7.5 }} fill={C.noir}>{roofMap.scale.label}</Text>
          </>
        ) : null}
      </Svg>
    </>
  );
}

function PlanMasseDocument({ roofMap, company, model }) {
  const address = formatFullAddress(company);
  return (
    <Document title={`Plan de masse (DPC2) — ${model.clientName}`} author={company.name}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={[s.companyName, { color: company.accentColor || C.bleuF }]}>{company.name}</Text>
            <Text style={s.companyLine}>{[address, company.phone].filter(Boolean).join('  ·  ')}</Text>
          </View>
          {company.logoUrl ? <Image src={company.logoUrl} style={s.logo} /> : null}
        </View>

        <Text style={s.title}>Plan de masse (DPC2) — implantation des modules photovoltaïques</Text>
        <Text style={s.subtitle}>
          {[model.adresse, model.parcellesLabel, model.installLabel, model.dateLabel].filter(Boolean).join('  ·  ')}
        </Text>

        <View style={s.mapFrame}>
          <RoofMapOverlay roofMap={roofMap} />
        </View>

        <View style={s.legend}>
          <Text style={s.legendTxt}>
            Parcelle(s) en trait blanc · zone d'implantation PV en jaune{model.hasPans ? '' : ' (emprise toiture à préciser)'} · plan d'offre sans cotation réglementaire
          </Text>
          <Text style={s.legendTxt}>Fond © Mapbox © Maxar</Text>
        </View>

        <Text style={s.footer} fixed>{buildLegalFooter(company)}</Text>
      </Page>
    </Document>
  );
}

/**
 * Génère le plan de masse. `roofGeometry` = bloc dossier (pans[].polygon si cartographiés).
 * Throw si aucune géométrie exploitable ou fond Mapbox indisponible.
 */
export async function generatePlanMasseBlob({ location, cadastre, roofGeometry, panelsCount, company, clientName, dateLabel }) {
  const roofMap = await buildSatelliteRoofModel({
    location, cadastre, roofGeometry, panelsCount, wPt: MAP_W, hPt: MAP_H,
  });

  const model = {
    clientName: clientName || 'Client',
    adresse: location?.address || null,
    parcellesLabel: cadastre?.parcelles?.length
      ? `Parcelle(s) : ${cadastre.parcelles.map((p) => `${p.section} ${p.numero}`).join(' · ')}`
      : null,
    installLabel: panelsCount ? `${panelsCount} modules en surimposition` : null,
    dateLabel: dateLabel || null,
    hasPans: roofMap.hasPans,
  };

  return pdf(<PlanMasseDocument roofMap={roofMap} company={company} model={model} />).toBlob();
}
