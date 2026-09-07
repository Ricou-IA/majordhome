/* eslint-disable react-refresh/only-export-components -- module de rendu PDF : rien n'est monté
   dans l'arbre React de l'app, Fast Refresh ne s'applique pas. */
// src/apps/thermique/components/etude/pdfShared.jsx
// Le socle générique (palette, formatters, cartouche, encarts) vit dans `@lib/pdfShared`
// (partagé avec la synthèse DPE et le planning hebdo). Ce fichier ne garde que le footer
// propre au rapport thermique et ré-exporte le reste pour les pages du module.
import { Text, View } from '@react-pdf/renderer';
import { buildLegalFooter } from '@lib/orgBranding';
import { sharedStyles } from '@lib/pdfShared';

export * from '@lib/pdfShared';
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
