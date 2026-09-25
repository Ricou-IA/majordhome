/* eslint-disable react-refresh/only-export-components -- module de rendu PDF (blob), jamais monté
   dans l'arbre React : Fast Refresh ne s'applique pas. */
// src/apps/maintenance/components/RegistrePDF.jsx
// Registre de maintenance (PDF) : met en page le modèle de registreModel.js SANS rien
// recalculer. Socle graphique commun src/lib/pdfShared.jsx (Helvetica : pas de glyphe hors
// WinAnsi — les textes saisis par les opérateurs sont normalisés par `texteSur`).
import { Document, Page, Text, View, pdf } from '@react-pdf/renderer';
import { CompanyHeader, SectionTitle, sharedStyles, C, accentOf } from '@lib/pdfShared';

const COLS = [
  { cle: 'date', titre: 'Date', largeur: 52 },
  { cle: 'heure', titre: 'Heure', largeur: 32 },
  { cle: 'tache', titre: 'Tâche', flex: 2 },
  { cle: 'statut', titre: 'Statut', largeur: 58 },
  { cle: 'operateur', titre: 'Opérateur', largeur: 62 },
  { cle: 'commentaire', titre: 'Commentaire', flex: 2 },
];

/** Normalise un texte libre pour Helvetica/WinAnsi : espaces spéciaux, tirets et guillemets typographiques. */
const texteSur = (s) => String(s ?? '')
  .replace(/\s/g, ' ')
  .replace(/[‐-‒−]/g, '-')
  .replace(/[‘’‛]/g, "'")
  .replace(/[^\x20-\x7E\xA0-\xFFŒœŠšŸŽž€–—•…]/g, '?');

const cellule = (col) => (col.flex ? { flex: col.flex, paddingRight: 4 } : { width: col.largeur, paddingRight: 4 });

function RegistreDocument({ registre, company, genereLe }) {
  return (
    <Document title={`Registre de maintenance ${registre.periode}`}>
      <Page size="A4" style={sharedStyles.page}>
        <CompanyHeader company={company} />
        <Text style={{ fontSize: 14, fontFamily: 'Helvetica-Bold', color: accentOf(company) }}>Registre de maintenance</Text>
        <Text style={{ fontSize: 8.5, color: C.grisTxt, marginTop: 2 }}>Période {registre.periode}</Text>

        {registre.sections.length === 0 && (
          <Text style={{ marginTop: 16, fontSize: 9 }}>Aucune réalisation enregistrée sur la période.</Text>
        )}

        {registre.sections.map((s) => (
          <View key={s.unite} wrap>
            <SectionTitle company={company}>{texteSur(s.unite)} ({s.lignes.length})</SectionTitle>
            <View style={[sharedStyles.rowLine, { borderBottom: `0.7px solid ${C.grisBar}` }]}>
              {COLS.map((c) => <Text key={c.cle} style={[sharedStyles.th, cellule(c)]}>{c.titre}</Text>)}
            </View>
            {s.lignes.map((l, i) => (
              <View key={i} style={sharedStyles.rowLine} wrap={false}>
                {COLS.map((c) => (
                  <Text
                    key={c.cle}
                    style={[sharedStyles.td, cellule(c), c.cle === 'statut' && l.statut !== 'Fait' ? { color: C.ambreTxt } : null]}
                  >
                    {texteSur(l[c.cle])}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        ))}

        <View style={sharedStyles.footer} fixed>
          <Text style={sharedStyles.footerText}>
            {registre.total} entrée{registre.total > 1 ? 's' : ''} — journal non modifiable — généré le {genereLe}
          </Text>
          <Text style={sharedStyles.pageNum} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function generateRegistrePdfBlob({ registre, company, genereLe }) {
  return pdf(<RegistreDocument registre={registre} company={company} genereLe={genereLe} />).toBlob();
}
