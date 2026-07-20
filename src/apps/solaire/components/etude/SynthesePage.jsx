// src/apps/solaire/components/etude/SynthesePage.jsx
// Page d'ouverture de l'étude « Votre projet en un coup d'œil » : chiffres clés,
// vue satellite du toit avec l'implantation PV (modèle partagé roofMapModel),
// matériel proposé et prestations incluses. Inspirée du rendu concurrent (Sorel/Reonic).
import { Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { C, fmtInt, numStr, eur, pct, accentOf, CompanyHeader, Footer, sharedStyles } from './pdfShared';
import { RoofMapOverlay } from '../dossier/PlanMassePDF';

// Taille recommandée de la vue satellite (largeur utile A4 portrait = 595 − 2×32) —
// à passer à buildSatelliteRoofModel par les callers ; le cadre suit roofMap.wPt/hPt.
export const SYNTHESE_MAP_SIZE = { wPt: 531, hPt: 300 };

const s = StyleSheet.create({
  titleBand: { backgroundColor: C.bleuF, borderRadius: 4, paddingVertical: 10, paddingHorizontal: 10, marginBottom: 10 },
  title: { color: C.blanc, fontSize: 14, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  subtitle: { color: C.bleuPale, fontSize: 8, textAlign: 'center', marginTop: 2 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  statBox: { width: '32.4%', border: `1px solid ${C.grisBar}`, borderRadius: 4, padding: 8, backgroundColor: C.blanc },
  statBoxHero: { backgroundColor: C.bleuPale, border: `1.5px solid ${C.bleuM}` },
  statLabel: { fontSize: 6.5, color: C.grisTxt },
  statValue: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginTop: 2, color: C.noir },
  statHint: { fontSize: 6, color: C.grisTxt, marginTop: 1 },
  mapFrame: { marginTop: 6, border: `1px solid ${C.grisTxt}` },
  mapCaption: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 },
  captionTxt: { fontSize: 6.5, color: C.grisTxt },
  matRow: { flexDirection: 'row', gap: 12, marginTop: 2 },
  matCol: { flex: 1 },
  matItem: { flexDirection: 'row', marginBottom: 2.5 },
  matBullet: { width: 10, color: C.bleuM, fontFamily: 'Helvetica-Bold' },
  matText: { flex: 1, lineHeight: 1.35 },
});

function Stat({ label, value, hint, hero }) {
  return (
    <View style={[s.statBox, hero ? s.statBoxHero : {}]}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, hero ? { color: C.bleuF } : {}]}>{value}</Text>
      {hint ? <Text style={s.statHint}>{hint}</Text> : null}
    </View>
  );
}

function Li({ children }) {
  return (
    <View style={s.matItem}>
      <Text style={s.matBullet}>•</Text>
      <Text style={s.matText}>{children}</Text>
    </View>
  );
}

// Prestations standard du parcours d'offre (génériques et vraies pour le flux app :
// l'étude, la pose en surimposition et la DP sont produites/portées par l'installateur).
const PRESTATIONS = [
  'Étude de dimensionnement personnalisée (ensoleillement PVGIS + profil horaire Enedis)',
  'Pose en surimposition sur la toiture existante, sans modification de structure',
  'Démarches administratives : déclaration préalable de travaux (dossier complet)',
  'Mise en service et vérification de conformité de l\'installation',
];

export function SynthesePage({ model, config, company, meta, roofMap, material, ev }) {
  const totals = model.active.totals;
  const ind = model.table?.indicators ?? null;
  const moduleLabel = [material?.module_marque, material?.module_modele].filter(Boolean).join(' ');
  const aspectLabel = material?.module_aspect === 'full_black' ? 'aspect noir uniforme (full black)' : null;

  return (
    <Page size="A4" style={sharedStyles.page}>
      <CompanyHeader company={company} />

      <View style={[s.titleBand, { backgroundColor: accentOf(company) }]}>
        <Text style={s.title}>VOTRE PROJET PHOTOVOLTAÏQUE EN UN COUP D'ŒIL</Text>
        <Text style={s.subtitle}>
          {meta.clientName}{meta.clientAddress ? ` — ${meta.clientAddress}` : ''} · {meta.dateLabel}
        </Text>
      </View>

      <View style={s.statsGrid}>
        <Stat
          hero
          label="Installation proposée"
          value={`${numStr(model.activeKwc)} kWc`}
          hint={`${model.activePanels} panneaux de ${config.panel_power_wc} Wc`}
        />
        <Stat
          label="Investissement TTC"
          value={model.totalCost !== null ? eur(model.totalCost) : 'À définir'}
          hint={model.mensualite !== null ? `financé : ${eur(model.mensualite)}/mois sur ${model.years} ans` : null}
        />
        <Stat
          label="Économie année 1"
          value={eur(model.economyYear1)}
          hint={`${eur(model.economyYear1 / 12)}/mois en moyenne`}
        />
        <Stat
          label="Production annuelle"
          value={`${fmtInt(totals.prod)} kWh`}
          hint="an 1, estimation PVGIS"
        />
        <Stat
          label="Autoconsommation"
          value={pct(totals.tauxAutoconso)}
          hint={`facture couverte : ${pct(totals.tauxAutoproduction)}`}
        />
        <Stat
          label="Neutralité financière"
          value={ind?.neutralityYear ? `Année ${ind.neutralityYear}` : '—'}
          hint={ind ? `gain total ${eur(ind.totalGainAtHorizon)} sur ${config.horizon_years} ans` : null}
        />
      </View>

      {roofMap ? (
        <>
          <Text style={sharedStyles.sectionTitle}>Le plan de votre toit</Text>
          <View style={[s.mapFrame, { width: roofMap.wPt, height: roofMap.hPt }]}>
            <RoofMapOverlay roofMap={roofMap} />
          </View>
          <View style={s.mapCaption}>
            <Text style={s.captionTxt}>
              Implantation préliminaire sur vue satellite — confirmée lors de la visite technique.
            </Text>
            <Text style={s.captionTxt}>Fond © Mapbox © Maxar</Text>
          </View>
        </>
      ) : null}

      <Text style={sharedStyles.sectionTitle}>Matériel & prestations</Text>
      <View style={s.matRow}>
        <View style={s.matCol}>
          <Li>
            {model.activePanels} modules photovoltaïques{moduleLabel ? ` ${moduleLabel}` : ''} de {config.panel_power_wc} Wc
            {aspectLabel ? `, ${aspectLabel}` : ''}
          </Li>
          {ev?.enabled && ev?.addCharger ? (
            <Li>Borne de recharge pour véhicule électrique{model.chargerPrice > 0 ? ` (${eur(model.chargerPrice)} TTC)` : ''}</Li>
          ) : null}
          <Li>Onduleur, structure de fixation, câblage et protections électriques</Li>
        </View>
        <View style={s.matCol}>
          {PRESTATIONS.map((p) => <Li key={p}>{p}</Li>)}
        </View>
      </View>

      <Footer company={company} />
    </Page>
  );
}
