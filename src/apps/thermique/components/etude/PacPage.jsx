// src/apps/thermique/components/etude/PacPage.jsx
// Page 3 du rapport : dimensionnement de la pompe à chaleur — bivalence, appoint, couverture,
// consommation annuelle estimée, et le graphe « besoin vs puissance PAC » REDESSINÉ en primitives
// SVG react-pdf (jamais une capture du graphe Recharts de l'écran, spec §8).
// La courbe est optionnelle : si la machine n'est pas résolvable (catalogue non chargé sur une
// étude rouverte), la page affiche les indicateurs seuls plutôt que de ne rien produire.
import { Page, Text, View, StyleSheet, Svg, Line, Polyline, Rect } from '@react-pdf/renderer';
import {
  C, sharedStyles, CompanyHeader, Footer, SectionTitle, Kpi, Encart,
  fmtInt, fmtDec, watt, kwh, eur, pct, degC,
} from './pdfShared';

const s = StyleSheet.create({
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 },
  chip: { backgroundColor: C.grisClair, borderRadius: 3, paddingVertical: 3, paddingHorizontal: 6, fontSize: 7 },
  legende: { flexDirection: 'row', gap: 12, marginTop: 4, marginLeft: 2 },
  legendeItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  legendeTrait: { width: 12, height: 2, borderRadius: 1 },
  legendeTxt: { fontSize: 6.5, color: C.grisTxt },
});

const CHART = { width: 500, height: 190, padL: 40, padR: 10, padT: 10, padB: 20 };

/** Plafond « rond » de l'axe des puissances. */
function niceMax(v) {
  if (!(v > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** Graphe besoin (charge du bâtiment) vs puissance disponible de la PAC selon la T° extérieure. */
function BivalenceChart({ courbe, thetaBivalence }) {
  const { width, height, padL, padR, padT, padB } = CHART;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const thetas = courbe.map((p) => p.theta);
  const tMin = Math.min(...thetas);
  const tMax = Math.max(...thetas);
  const yMax = niceMax(Math.max(...courbe.map((p) => Math.max(p.besoin, p.pac)), 1));
  const x = (t) => padL + ((t - tMin) / Math.max(1e-9, tMax - tMin)) * plotW;
  const y = (v) => padT + plotH - (Math.min(v, yMax) / yMax) * plotH;
  const pts = (cle) => courbe.map((p) => `${x(p.theta).toFixed(1)},${y(p[cle]).toFixed(1)}`).join(' ');

  const ticksY = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  // Graduations X tous les 2 °C, alignées sur une valeur paire pour rester lisibles.
  const ticksX = [];
  for (let t = Math.ceil(tMin / 2) * 2; t <= tMax; t += 2) ticksX.push(t);

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {ticksY.map((v, i) => (
        <Line
          key={`gy${i}`}
          x1={padL} y1={y(v)} x2={width - padR} y2={y(v)}
          stroke={i === 0 ? C.grisBar : C.grisClair} strokeWidth={i === 0 ? 0.8 : 0.5}
        />
      ))}
      {ticksY.map((v, i) => (
        <Text key={`ty${i}`} x={padL - 4} y={y(v) + 2} textAnchor="end" style={{ fontSize: 5.5 }} fill={C.grisTxt}>
          {fmtInt(v)}
        </Text>
      ))}
      {ticksX.map((t) => (
        <Text key={`tx${t}`} x={x(t)} y={padT + plotH + 9} textAnchor="middle" style={{ fontSize: 5.5 }} fill={C.grisTxt}>
          {`${t}°`}
        </Text>
      ))}

      {/* Point de bivalence : trait vertical ambre (en dessous, l'appoint prend le relais).
          L'étiquette est ancrée à gauche/droite quand le trait est près d'un bord, sinon elle
          sortirait du viewBox et serait tronquée (bivalence = θnc quand la PAC est très juste). */}
      {Number.isFinite(thetaBivalence) && thetaBivalence >= tMin && thetaBivalence <= tMax ? (
        <>
          <Line
            x1={x(thetaBivalence)} y1={padT} x2={x(thetaBivalence)} y2={padT + plotH}
            stroke={C.ambre} strokeWidth={1} strokeDasharray="3 3"
          />
          <Text
            x={x(thetaBivalence)}
            y={padT - 2}
            textAnchor={x(thetaBivalence) > width - padR - 45 ? 'end'
              : x(thetaBivalence) < padL + 45 ? 'start' : 'middle'}
            style={{ fontSize: 5.5 }}
            fill={C.ambreTxt}
          >
            {`bivalence ${fmtDec(thetaBivalence, 1)} °C`}
          </Text>
        </>
      ) : null}

      <Polyline points={pts('besoin')} fill="none" stroke={C.slate} strokeWidth={1.4} />
      <Polyline points={pts('pac')} fill="none" stroke={C.bleu} strokeWidth={1.4} />
      <Rect x={padL} y={padT} width={plotW} height={plotH} fill="none" stroke={C.grisClair} strokeWidth={0.5} />
    </Svg>
  );
}

export function PacPage({ rapport, company }) {
  const { pac, synthese } = rapport;
  const { bivalence, conso, consoErreur, courbe, machineLabel, regime, prixKwh } = pac;

  return (
    <Page size="A4" style={sharedStyles.page}>
      <CompanyHeader company={company} />
      <SectionTitle company={company}>Dimensionnement de la pompe à chaleur</SectionTitle>

      <View style={s.meta}>
        {machineLabel ? <Text style={s.chip}>Machine : {machineLabel}</Text> : null}
        {regime ? <Text style={s.chip}>Régime d’eau : {regime} °C</Text> : null}
        {Number.isFinite(prixKwh) ? <Text style={s.chip}>Prix du kWh : {fmtDec(prixKwh, 4)} €</Text> : null}
      </View>

      <View style={sharedStyles.kpiRow}>
        <Kpi
          label="Point de bivalence"
          value={degC(bivalence.thetaBivalence)}
          hint="en dessous, l’appoint complète la PAC"
        />
        <Kpi
          label={`Appoint nécessaire à ${fmtDec(synthese.thetaE, 0)} °C`}
          value={watt(bivalence.appointNecessaire)}
        />
        <Kpi
          label="Taux de couverture"
          value={pct(bivalence.tauxCouverture)}
          hint="part du besoin de chauffage couverte par la PAC"
        />
      </View>

      {bivalence.avertissementChargePartielle ? (
        <Encart>
          Les puissances du catalogue sont des points normalisés EN 14825 relevés à charge
          partielle, et non la capacité maximale de la machine : le dimensionnement obtenu est
          prudent.
        </Encart>
      ) : null}

      {courbe?.length ? (
        <>
          <SectionTitle company={company}>Besoin du logement et puissance disponible</SectionTitle>
          <BivalenceChart courbe={courbe} thetaBivalence={bivalence.thetaBivalence} />
          <View style={s.legende}>
            <View style={s.legendeItem}>
              <View style={[s.legendeTrait, { backgroundColor: C.slate }]} />
              <Text style={s.legendeTxt}>Besoin du logement (W)</Text>
            </View>
            <View style={s.legendeItem}>
              <View style={[s.legendeTrait, { backgroundColor: C.bleu }]} />
              <Text style={s.legendeTxt}>Puissance disponible de la PAC (W)</Text>
            </View>
            <Text style={s.legendeTxt}>Axe horizontal : température extérieure</Text>
          </View>
        </>
      ) : null}

      <SectionTitle company={company}>Consommation annuelle estimée</SectionTitle>
      {consoErreur ? (
        <Encart ton="alerte">Consommation non calculée : {consoErreur}</Encart>
      ) : conso ? (
        <>
          <View style={sharedStyles.kpiRow}>
            <Kpi label="Besoin de chauffage" value={kwh(conso.besoinKwh)} hint="par an, hors eau chaude sanitaire" />
            <Kpi label="Électricité consommée par la PAC" value={kwh(conso.consoElecKwh)} hint="par an" />
            <Kpi
              label="Coût estimé"
              value={`${eur(conso.coutEuros)} / an`}
              hint={`fourchette ${fmtInt(conso.fourchette.min)} - ${fmtInt(conso.fourchette.max)} €`}
            />
          </View>
          <Text style={{ fontSize: 6.5, color: C.grisTxt, marginTop: 6 }}>
            Méthode des degrés-jours sur la station météo de référence, à température extérieure
            moyenne de saison de chauffe {degC(conso.thetaExtMoyenne)}. Hors eau chaude sanitaire,
            hors appoint électrique sous le point de bivalence, au prix du kWh indiqué ci-dessus.
          </Text>
        </>
      ) : (
        <Encart ton="alerte">Consommation annuelle non disponible pour cette configuration.</Encart>
      )}

      <Footer company={company} />
    </Page>
  );
}
