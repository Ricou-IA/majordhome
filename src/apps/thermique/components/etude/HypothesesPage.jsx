// src/apps/thermique/components/etude/HypothesesPage.jsx
// Dernière page du rapport : TRANSPARENCE des hypothèses (spec §8). Le module assume des forfaits
// plutôt qu'une suroptimisation — ils doivent donc être lisibles par le client et vérifiables par
// un confrère : U retenus par famille, coefficients réglementaires, T° de base, ventilation.
import { Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import {
  C, sharedStyles, CompanyHeader, Footer, SectionTitle, DefLine, Encart,
  fmtInt, fmtDec, uVal, degC,
} from './pdfShared';

const s = StyleSheet.create({
  uHead: { flexDirection: 'row', borderBottom: `0.8px solid ${C.grisBar}`, paddingBottom: 3, marginTop: 4 },
  uRow: { flexDirection: 'row', paddingVertical: 3, borderBottom: `0.4px solid ${C.grisClair}` },
  uNom: { flex: 1, fontSize: 7.5 },
  uVal: { width: 100, fontSize: 7.5, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  uSrc: { width: 120, fontSize: 7, textAlign: 'right', color: C.grisTxt },
  note: { fontSize: 6.5, color: C.grisTxt, marginTop: 8, lineHeight: 1.4 },
});

export function HypothesesPage({ rapport, company }) {
  const { hypotheses: h, projet, synthese } = rapport;
  const ventilation = h.ventilation.rendement > 0
    ? `${h.ventilation.label} (récupération de chaleur ${fmtInt(h.ventilation.rendement * 100)} %)`
    : h.ventilation.label;

  return (
    <Page size="A4" style={sharedStyles.page}>
      <CompanyHeader company={company} />
      <SectionTitle company={company}>Hypothèses de calcul</SectionTitle>

      <DefLine
        label="Température extérieure de base"
        value={h.thetaE.force
          ? `${degC(h.thetaE.valeur)} — valeur forcée manuellement`
          : `${degC(h.thetaE.valeur)} — table réglementaire du département ${projet.dept ?? '—'}`}
      />
      <DefLine
        label="Degrés-jours de chauffage"
        value={h.dju.valeur != null
          ? `${fmtInt(h.dju.valeur)} DJU${h.dju.fallback ? ' — moyenne départementale (commune non référencée)' : ''}`
          : '—'}
      />
      <DefLine label="Altitude" value={h.altitude != null ? `${fmtInt(h.altitude)} m` : '—'} />
      <DefLine
        label="Période de construction"
        value={projet.annee ? `${projet.annee} — « ${h.periode} »` : `« ${h.periode} »`}
      />
      <DefLine label="Isolation de l’enveloppe" value={h.isolation.label} />
      <DefLine label="Plancher bas" value={h.plancherBas} />
      <DefLine label="Toiture" value={h.toiture} />
      <DefLine label="Ventilation" value={ventilation} />
      <DefLine
        label="Ponts thermiques"
        value={h.deltaUtb != null
          ? `majoration forfaitaire de ${fmtDec(h.deltaUtb, 2)} W/(m²·K) sur les parois déperditives`
          : '—'}
      />
      <DefLine
        label="Relance après réduit"
        value={h.fRH.actif ? `activée — ${fmtInt(h.fRH.valeur)} W/m² de surpuissance` : 'non prise en compte'}
      />
      <DefLine label="Foisonnement émetteur" value={`${fmtDec(h.foisonnement, 2)} ×`} />

      <SectionTitle company={company}>Coefficients de déperdition retenus (U)</SectionTitle>
      <View style={s.uHead}>
        <Text style={[sharedStyles.th, { flex: 1 }]}>Paroi</Text>
        <Text style={[sharedStyles.th, { width: 100, textAlign: 'right' }]}>U retenu</Text>
        <Text style={[sharedStyles.th, { width: 120, textAlign: 'right' }]}>Origine</Text>
      </View>
      {h.u.map((u) => (
        <View key={u.famille} style={s.uRow}>
          <Text style={s.uNom}>{u.label}</Text>
          <Text style={s.uVal}>{uVal(u.valeur)}</Text>
          <Text style={s.uSrc}>{u.source}</Text>
        </View>
      ))}
      {h.nbExceptions > 0 ? (
        <Text style={{ fontSize: 6.5, color: C.grisTxt, marginTop: 4 }}>
          {h.nbExceptions} valeur(s) ajustée(s) au cas par cas sur certaines pièces ou menuiseries :
          les puissances détaillées en tiennent compte.
        </Text>
      ) : null}

      <Encart>
        Vérification de vraisemblance : {fmtInt(synthese.ratioWm2)} W/m²
        {h.plage ? ` pour un repère de ${h.plage.min} à ${h.plage.max} W/m² sur ce type de construction` : ''}
        {synthese.alerteVraisemblance ? ' — valeur hors repère, saisie à revérifier.' : ' — valeur cohérente.'}
      </Encart>

      <Text style={s.note}>
        Méthode : EN 12831 simplifiée, calcul pièce par pièce. Déperditions par transmission
        (surface × U × écart de température, corrigé du coefficient de réduction des locaux non
        chauffés), par renouvellement d’air, majorées des ponts thermiques forfaitaires et, le cas
        échéant, de la surpuissance de relance. La fourchette affichée en synthèse
        {synthese.fourchette ? ` (${fmtInt(synthese.fourchette.min)} à ${fmtInt(synthese.fourchette.max)} W)` : ''}
        {' '}traduit l’incertitude assumée de ces forfaits. Les consommations annuelles sont estimées par
        la méthode des degrés-jours et ne constituent pas un engagement de résultat.
        {projet.engineVersion ? ` Moteur de calcul v${projet.engineVersion}.` : ''}
      </Text>

      <Footer company={company} />
    </Page>
  );
}
