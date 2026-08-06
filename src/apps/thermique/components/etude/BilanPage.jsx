// src/apps/thermique/components/etude/BilanPage.jsx
// Page 1 du rapport thermique : cartouche société, identification du projet, indicateurs de
// synthèse (déperditions totales / ratio surfacique / T° extérieure de base), décomposition par
// poste en barres redessinées (pas de capture d'écran), puis le détail pièce par pièce
// (PiecesSection) dans le même flux — le tableau déborde de lui-même sur une page suivante quand
// la maison a beaucoup de pièces. Chiffres repris tels quels du modèle de rapport, aucun calcul ici.
import { Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import {
  C, sharedStyles, CompanyHeader, Footer, SectionTitle, Kpi, Encart, accentOf,
  fmtInt, fmtDec, watt, kw, m2,
} from './pdfShared';
import { PiecesSection } from './PiecesSection';

const s = StyleSheet.create({
  title: { fontSize: 17, fontFamily: 'Helvetica-Bold' },
  subtitle: { fontSize: 8.5, color: C.grisTxt, marginTop: 2 },
  reference: { fontSize: 8, color: C.slate, marginTop: 4, fontFamily: 'Helvetica-Oblique' },
  projet: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 10, marginBottom: 12 },
  chip: { backgroundColor: C.grisClair, borderRadius: 3, paddingVertical: 3, paddingHorizontal: 6 },
  chipLabel: { fontSize: 6, color: C.grisTxt },
  chipValue: { fontSize: 8, fontFamily: 'Helvetica-Bold', marginTop: 1 },
  posteRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  posteLabel: { width: 92, fontSize: 7.5 },
  posteTrack: { flex: 1, height: 7, backgroundColor: C.grisClair, borderRadius: 3.5 },
  posteFill: { height: 7, backgroundColor: C.bleu, borderRadius: 3.5 },
  posteValue: { width: 62, fontSize: 7.5, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  postePart: { width: 32, fontSize: 6.5, textAlign: 'right', color: C.grisTxt },
});

function Chip({ label, value }) {
  return (
    <View style={s.chip}>
      <Text style={s.chipLabel}>{label}</Text>
      <Text style={s.chipValue}>{value}</Text>
    </View>
  );
}

export function BilanPage({ rapport, company, echelle }) {
  const { projet, synthese, pieces } = rapport;
  const accent = accentOf(company);
  const fourchette = synthese.fourchette
    ? `fourchette ${fmtInt(synthese.fourchette.min)} - ${fmtInt(synthese.fourchette.max)} W`
    : null;
  const lieu = [projet.commune, projet.codePostal].filter(Boolean).join(' ')
    || (projet.dept ? `Département ${projet.dept}` : null);

  return (
    <Page size="A4" style={sharedStyles.page}>
      <CompanyHeader company={company} />

      <Text style={[s.title, { color: accent }]}>Étude thermique</Text>
      <Text style={s.subtitle}>
        Déperditions pièce par pièce, dimensionnement de la pompe à chaleur et consommation estimée
      </Text>
      {projet.titre && projet.titre !== 'Étude thermique'
        ? <Text style={s.reference}>{projet.titre}</Text>
        : null}

      <View style={s.projet}>
        {projet.clientName ? <Chip label="CLIENT" value={projet.clientName} /> : null}
        {lieu ? <Chip label="COMMUNE" value={lieu} /> : null}
        {projet.altitude != null ? <Chip label="ALTITUDE" value={`${fmtInt(projet.altitude)} m`} /> : null}
        <Chip label="CONSTRUCTION" value={projet.annee ? String(projet.annee) : projet.periode} />
        <Chip label="SURFACE CHAUFFÉE" value={m2(pieces.totaux.surface)} />
        {projet.dateLabel ? <Chip label="DATE" value={projet.dateLabel} /> : null}
      </View>

      <View style={sharedStyles.kpiRow}>
        <Kpi
          label="Déperditions totales"
          value={kw(synthese.totalW)}
          hint={fourchette}
          color={accent}
        />
        <Kpi
          label="Ratio surfacique"
          value={`${fmtInt(synthese.ratioWm2)} W/m²`}
          hint={synthese.plage ? `repère ${synthese.plage.min} - ${synthese.plage.max} W/m² (${projet.periode})` : null}
        />
        <Kpi
          label="T° extérieure de base"
          value={`${fmtDec(synthese.thetaE, 0)} °C`}
          hint={projet.dept ? `département ${projet.dept}` : null}
        />
      </View>

      {synthese.alerteVraisemblance && synthese.plage ? (
        <Encart ton="alerte">
          Ratio hors du repère {synthese.plage.min} - {synthese.plage.max} W/m² attendu pour une
          construction « {projet.periode} ». La saisie (surfaces, isolation, menuiseries) mérite
          d’être revérifiée avant de dimensionner l’équipement.
        </Encart>
      ) : null}

      <SectionTitle company={company}>Décomposition des déperditions par poste</SectionTitle>
      {synthese.postes.map((p) => (
        <View key={p.cle} style={s.posteRow}>
          <Text style={s.posteLabel}>{p.label}</Text>
          <View style={s.posteTrack}>
            <View style={[s.posteFill, { width: `${Math.max(2, p.largeur * 100)}%` }]} />
          </View>
          <Text style={s.posteValue}>{watt(p.valeur)}</Text>
          <Text style={s.postePart}>{fmtDec(p.part * 100, 0)} %</Text>
        </View>
      ))}

      <Encart>
        Le total {kw(synthese.totalW)} est la puissance à couvrir par temps froid de base
        {' '}({fmtDec(synthese.thetaE, 0)} °C) : c’est elle qui dimensionne la génération. Le détail
        ci-dessous dimensionne les émetteurs, pièce par pièce.
      </Encart>

      <PiecesSection rapport={rapport} company={company} echelle={echelle} />

      <Footer company={company} />
    </Page>
  );
}
