// src/apps/solaire/components/etude/FluxPage.jsx
// Page « Vos flux d'électricité » (constat) : où part la production solaire
// (autoconsommation vs surplus perdu) et d'où vient la consommation du foyer
// (autonomie vs réseau) — les deux taux complémentaires, calculés heure par heure.
import { Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { C, kwh, pct, CompanyHeader, Footer, sharedStyles } from './pdfShared';
import { FlowDiagram } from './flows';

const s = StyleSheet.create({
  intro: { fontSize: 7.5, color: C.grisTxt, lineHeight: 1.4, marginBottom: 4 },
  noteBox: { backgroundColor: C.grisClair, borderRadius: 4, padding: 8, marginTop: 12 },
  noteText: { fontSize: 7, color: C.grisTxt, lineHeight: 1.4 },
});

export function FluxPage({ model, company }) {
  const totals = model.active.totals;
  const surplus = Math.max(0, totals.prod - totals.autoconso);
  const gridImport = Math.max(0, totals.conso - totals.autoconso);
  const shareAuto = totals.prod > 0 ? totals.autoconso / totals.prod : 0;
  const shareSurplus = totals.prod > 0 ? surplus / totals.prod : 0;
  const shareAutonomie = totals.conso > 0 ? totals.autoconso / totals.conso : 0;
  const shareGrid = totals.conso > 0 ? gridImport / totals.conso : 0;

  return (
    <Page size="A4" style={sharedStyles.page}>
      <CompanyHeader company={company} />

      <Text style={sharedStyles.sectionTitle}>Où va votre électricité solaire ?</Text>
      <Text style={s.intro}>
        Votre production est consommée sur place quand un besoin existe au même instant ; le reste part
        au réseau sans être valorisé (0 € — approche volontairement conservatrice).
      </Text>
      <FlowDiagram
        single={{ title: 'Production solaire', value: kwh(totals.prod), share: 'an 1' }}
        duo={[
          { title: 'Votre foyer', value: kwh(totals.autoconso), share: `${pct(shareAuto)} autoconsommés` },
          { title: 'Réseau (surplus)', value: kwh(surplus), share: `${pct(shareSurplus)} — valorisés 0 €` },
        ]}
        shares={[shareAuto, shareSurplus]}
        colors={[C.jaune, C.grisBar]}
      />

      <Text style={sharedStyles.sectionTitle}>D'où vient l'électricité de votre foyer ?</Text>
      <Text style={s.intro}>
        Même avec une production annuelle élevée, le réseau reste nécessaire la nuit et en hiver : le taux
        d'autonomie mesure la part de votre consommation couverte par le solaire.
      </Text>
      <FlowDiagram
        reverse
        single={{ title: 'Votre consommation', value: kwh(totals.conso), share: 'an 1' }}
        duo={[
          { title: 'Solaire (autoconsommé)', value: kwh(totals.autoconso), share: `${pct(shareAutonomie)} d'autonomie` },
          { title: 'Réseau électrique', value: kwh(gridImport), share: pct(shareGrid) },
        ]}
        shares={[shareAutonomie, shareGrid]}
        colors={[C.jaune, C.bleuC]}
      />

      <View style={s.noteBox}>
        <Text style={s.noteText}>
          Lecture : autoconsommation = part de la PRODUCTION consommée sur place ({pct(shareAuto)}) ;
          autonomie = part de la CONSOMMATION couverte par le solaire ({pct(shareAutonomie)}). Les deux
          taux sont calculés heure par heure sur 8 760 heures (profil Enedis calé sur vos 12 factures),
          jamais sur des totaux annuels.
        </Text>
      </View>

      <Footer company={company} />
    </Page>
  );
}
