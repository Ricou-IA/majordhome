// src/apps/solaire/components/dossier/PlanSituationPDF.jsx
// DPC1 — Plan de situation du terrain (pièce jointe de la déclaration préalable).
// Fond Mapbox Static (streets, échelle quartier/commune) + contour parcelle(s) superposé
// via geoProject (alignement Web Mercator exact), repère Nord, échelle, cartouche société.
// Fail-loud : échec du fond de carte → throw (le caller signale la pièce manquante).
import { Document, Page, Text, View, Image, Svg, Path, Polygon, Circle, Rect, StyleSheet, pdf } from '@react-pdf/renderer';
import { formatFullAddress, buildLegalFooter } from '@lib/orgBranding';
import {
  computeBbox, mapboxStaticBbox, makeProjector, metricScale, polygonToRings, ringsToSvgPath,
} from '../../lib/geoProject';
import { fetchStaticMapDataUrl, MAPBOX_STYLE_STREETS } from '../../lib/mapboxStatic';

// Palette deutan stricte (identique NoticePDF) — le fond de carte est une image, hors palette.
const C = { jaune: '#F5C542', bleuF: '#0D47A1', grisTxt: '#6B7280', grisClair: '#F3F4F6', noir: '#1F2937' };

// Image de fond (px logiques Static API) et zone d'affichage (pt PDF) — même ratio.
const IMG_W = 1000;
const IMG_H = 560;
const MAP_W = 750;
const MAP_H = 420;
const SITUATION_ZOOM = 15; // échelle quartier/commune : localise le terrain

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

/** Repère Nord (haut-droite de la carte). */
function NorthMark() {
  return (
    <>
      <Rect x={MAP_W - 34} y={10} width={24} height={32} rx={3} fill="#FFFFFF" fillOpacity={0.85} />
      <Polygon points={`${MAP_W - 22},14 ${MAP_W - 28},30 ${MAP_W - 16},30`} fill={C.noir} />
      <Text x={MAP_W - 22} y={40} style={{ fontSize: 8, fontFamily: 'Helvetica-Bold' }} textAnchor="middle" fill={C.noir}>N</Text>
    </>
  );
}

/** Barre d'échelle métrique (bas-gauche de la carte). */
function ScaleBar({ scale }) {
  if (!scale) return null;
  const x = 12;
  const y = MAP_H - 16;
  return (
    <>
      <Rect x={x - 4} y={y - 12} width={scale.lengthPt + 8 + 30} height={20} rx={3} fill="#FFFFFF" fillOpacity={0.85} />
      <Path d={`M ${x} ${y - 4} L ${x} ${y} L ${x + scale.lengthPt} ${y} L ${x + scale.lengthPt} ${y - 4}`} stroke={C.noir} strokeWidth={1} fill="none" />
      <Text x={x + scale.lengthPt + 5} y={y + 1} style={{ fontSize: 7.5 }} fill={C.noir}>{scale.label}</Text>
    </>
  );
}

function PlanSituationDocument({ mapDataUrl, parcelPaths, marker, scale, company, model }) {
  const address = formatFullAddress(company);
  return (
    <Document title={`Plan de situation (DPC1) — ${model.clientName}`} author={company.name}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={[s.companyName, { color: company.accentColor || C.bleuF }]}>{company.name}</Text>
            <Text style={s.companyLine}>{[address, company.phone].filter(Boolean).join('  ·  ')}</Text>
          </View>
          {company.logoUrl ? <Image src={company.logoUrl} style={s.logo} /> : null}
        </View>

        <Text style={s.title}>Plan de situation du terrain (DPC1)</Text>
        <Text style={s.subtitle}>
          {[model.adresse, model.communeLabel, model.parcellesLabel, model.dateLabel].filter(Boolean).join('  ·  ')}
        </Text>

        <View style={s.mapFrame}>
          <Image src={mapDataUrl} style={{ position: 'absolute', top: 0, left: 0, width: MAP_W, height: MAP_H }} />
          <Svg width={MAP_W} height={MAP_H} viewBox={`0 0 ${MAP_W} ${MAP_H}`} style={{ position: 'absolute', top: 0, left: 0 }}>
            {/* Halo de repérage : à l'échelle commune la parcelle est petite → cercle porteur */}
            {marker ? <Circle cx={marker.x} cy={marker.y} r={16} fill="none" stroke={C.jaune} strokeWidth={2.5} /> : null}
            {parcelPaths.map((d, i) => (
              <Path key={i} d={d} fill={C.jaune} fillOpacity={0.4} stroke={C.bleuF} strokeWidth={1.2} />
            ))}
            <NorthMark />
            <ScaleBar scale={scale} />
          </Svg>
        </View>

        <View style={s.legend}>
          <Text style={s.legendTxt}>Terrain repéré : parcelle(s) en jaune, cercle de localisation</Text>
          <Text style={s.legendTxt}>Fond de carte © Mapbox © OpenStreetMap</Text>
        </View>

        <Text style={s.footer} fixed>{buildLegalFooter(company)}</Text>
      </Page>
    </Document>
  );
}

/**
 * Génère le plan de situation. `location` = { lat, lon } (fallback : centre des parcelles).
 * Throw si ni coordonnées ni parcelles, ou si le fond Mapbox est indisponible.
 */
export async function generatePlanSituationBlob({ location, cadastre, company, clientName, dateLabel }) {
  const features = cadastre?.geojson?.features ?? [];
  const parcelBbox = computeBbox(features, 0);
  const center = parcelBbox
    ? { lon: (parcelBbox.minLon + parcelBbox.maxLon) / 2, lat: (parcelBbox.minLat + parcelBbox.maxLat) / 2 }
    : location?.lat != null && location?.lon != null
      ? { lon: location.lon, lat: location.lat }
      : null;
  if (!center) throw new Error('Plan de situation : aucune coordonnée (parcelle ou localisation)');

  const mapDataUrl = await fetchStaticMapDataUrl({
    style: MAPBOX_STYLE_STREETS, lon: center.lon, lat: center.lat, zoom: SITUATION_ZOOM, wPx: IMG_W, hPx: IMG_H,
  });
  const imgBbox = mapboxStaticBbox(center.lon, center.lat, SITUATION_ZOOM, IMG_W, IMG_H);
  const project = makeProjector(imgBbox, MAP_W, MAP_H);
  const parcelPaths = features
    .map((f) => ringsToSvgPath(polygonToRings(f.geometry, project)))
    .filter(Boolean);
  const markerPos = project(center.lon, center.lat);

  const model = {
    clientName: clientName || 'Client',
    adresse: location?.address || null,
    communeLabel: cadastre?.nom_com ? `Commune : ${cadastre.nom_com} (${cadastre.commune_insee ?? ''})` : null,
    parcellesLabel: cadastre?.parcelles?.length
      ? `Parcelle(s) : ${cadastre.parcelles.map((p) => `${p.section} ${p.numero}`).join(' · ')}`
      : null,
    dateLabel: dateLabel || null,
  };

  return pdf(
    <PlanSituationDocument
      mapDataUrl={mapDataUrl}
      parcelPaths={parcelPaths}
      marker={markerPos}
      scale={metricScale(imgBbox, MAP_W)}
      company={company}
      model={model}
    />,
  ).toBlob();
}
