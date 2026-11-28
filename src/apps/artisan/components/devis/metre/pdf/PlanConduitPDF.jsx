/* eslint-disable react-refresh/only-export-components -- react-pdf : jamais monté dans le DOM, le fast refresh ne s'applique pas */
// src/apps/artisan/components/devis/metre/pdf/PlanConduitPDF.jsx
// « Plan du conduit » annexé au devis (variante offre) et « Fiche chantier » (variante chantier) —
// RENDU PUR du modèle (src/lib/fumisterie/planModel.js) : rien n'est calculé ni formaté ici.
// A4 paysage : coupe cotée à gauche, liste des pièces à droite, cartouche en bas à droite.
import { Document, Page, View, Text, Image, StyleSheet, pdf } from '@react-pdf/renderer';
import { CoupePdf } from './CoupePdf';

const P = { s100: '#F0EDE7', s200: '#E8E4DC', s300: '#DDD7CD', s500: '#736A5F', s700: '#443E36', s900: '#1C1915', p400: '#DE8257', p600: '#C2532B' };
const LARGEUR_PAGE = 842; const HAUTEUR_PAGE = 595; const MARGE = 24;
const LARGEUR_DROITE = 300;
// Pagination à la hauteur estimée d'une ligne (désignation + précision sur au plus deux lignes de ~60 caractères).
const BUDGET_PAGE_1 = 395; const BUDGET_SUITE = 470;
const hauteurLigne = (l) => Math.min(2, Math.ceil(((l.designation || '').length + (l.detail || '').length + 2) / 60)) * 9.4 + 6;
function decouper(lignes) {
  const pages = [[]]; let reste = BUDGET_PAGE_1;
  for (const l of lignes) {
    const h = hauteurLigne(l);
    if (h > reste && pages[pages.length - 1].length) { pages.push([]); reste = BUDGET_SUITE; }
    pages[pages.length - 1].push(l); reste -= h;
  }
  return pages;
}

const s = StyleSheet.create({
  page: { padding: MARGE, fontFamily: 'Helvetica', color: P.s900 },
  ligne: { flexDirection: 'row' },
  gauche: { width: LARGEUR_PAGE - 2 * MARGE - LARGEUR_DROITE - 14, marginRight: 14 },
  droite: { width: LARGEUR_DROITE },
  titre: { fontSize: 15, lineHeight: 1.2, fontFamily: 'Helvetica-Bold' },
  sousTitre: { fontSize: 8.5, lineHeight: 1.3, color: P.s500, marginBottom: 6 },
  cadreCoupe: { borderWidth: 0.6, borderColor: P.s300, borderRadius: 4, padding: 6, alignItems: 'center', justifyContent: 'center' },
  tableTitre: { fontSize: 9, lineHeight: 1.2, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  th: { fontSize: 7.5, lineHeight: 1.2, color: P.s500, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase' },
  td: { fontSize: 7.5, lineHeight: 1.25 },
  tdDetail: { fontSize: 7, lineHeight: 1.2, color: P.s500 },
  rangee: { flexDirection: 'row', paddingVertical: 2.5, borderBottomWidth: 0.4, borderBottomColor: P.s200 },
  colRep: { width: 22 }, colQte: { width: 40, textAlign: 'right' }, colRef: { width: 92, fontSize: 6.5, lineHeight: 1.25 },
  pastille: { width: 13, height: 13, borderRadius: 6.5, backgroundColor: P.p400, borderWidth: 0.6, borderColor: P.s900, alignItems: 'center', justifyContent: 'center' },
  pastilleTxt: { fontSize: 7, lineHeight: 1, fontFamily: 'Helvetica-Bold' },
  cartouche: { position: 'absolute', right: MARGE, bottom: MARGE, width: LARGEUR_DROITE, borderWidth: 0.8, borderColor: P.s700 },
  cartCase: { padding: 4, borderBottomWidth: 0.5, borderBottomColor: P.s300 },
  cartLabel: { fontSize: 6.5, lineHeight: 1.2, color: P.s500, textTransform: 'uppercase' },
  cartTxt: { fontSize: 7.5, lineHeight: 1.25 },
  cartGras: { fontSize: 8, lineHeight: 1.25, fontFamily: 'Helvetica-Bold' },
  logo: { maxHeight: 26, maxWidth: 90, objectFit: 'contain', marginRight: 6 },
  mentions: { fontSize: 7, lineHeight: 1.2, color: P.s500, padding: 4 },
  section: { marginBottom: 10 },
  sectionTitre: { fontSize: 10, lineHeight: 1.2, fontFamily: 'Helvetica-Bold', color: P.p600, marginBottom: 4 },
  puce: { fontSize: 8.5, lineHeight: 1.35, marginBottom: 1.5 },
  paire: { flexDirection: 'row', fontSize: 8.5, lineHeight: 1.35 },
});

const HAUTEUR_CARTOUCHE = 150; // mesurée sur le rendu (entreprise sur deux lignes, installation sur deux)

function Cartouche({ c }) {
  return (
    <View style={s.cartouche} fixed>
      <View style={[s.cartCase, s.ligne, { alignItems: 'center' }]}>
        {c.entreprise.logoDataUrl ? <Image src={c.entreprise.logoDataUrl} style={s.logo} /> : null}
        <View style={{ flex: 1 }}>
          <Text style={s.cartGras}>{c.entreprise.nom}</Text>
          <Text style={s.cartTxt}>{c.entreprise.lignes.join(' · ')}</Text>
          {c.entreprise.rge ? <Text style={s.cartTxt}>{c.entreprise.rge}</Text> : null}
        </View>
      </View>
      <View style={[s.ligne, { borderBottomWidth: 0.5, borderBottomColor: P.s300 }]}>
        <View style={{ flex: 1, padding: 4, borderRightWidth: 0.5, borderRightColor: P.s300 }}>
          <Text style={s.cartLabel}>Client · chantier</Text>
          <Text style={s.cartGras}>{c.client.nom}</Text>
          {c.client.lignes.map((l, i) => <Text key={i} style={s.cartTxt}>{l}</Text>)}
        </View>
        <View style={{ width: 120, padding: 4 }}>
          <Text style={s.cartLabel}>Document</Text>
          <Text style={s.cartGras}>{c.devis.mention}</Text>
          <Text style={s.cartTxt}>Relevé du {c.releve.date}</Text>
          <Text style={s.cartTxt}>Par : {c.releve.auteur}</Text>
        </View>
      </View>
      <View style={s.cartCase}>
        <Text style={s.cartLabel}>Installation</Text>
        <Text style={s.cartTxt}>{c.installation.titre}</Text>
        <Text style={s.cartTxt}>{`Gabarit ${c.installation.gabarit} · ${c.installation.diametre} · Finition ${c.installation.finition} · ${c.installation.fabricant}`}</Text>
      </View>
      <Text style={s.mentions}>{c.mentions.join(' · ')}</Text>
    </View>
  );
}

function TablePieces({ titre, lignes, avecRef }) {
  return (
    <View>
      <Text style={s.tableTitre}>{titre}</Text>
      <View style={[s.rangee, { borderBottomColor: P.s900, borderBottomWidth: 0.8 }]}>
        <Text style={[s.th, s.colRep]}>Rep.</Text>
        <Text style={[s.th, { flex: 1 }]}>Désignation</Text>
        {avecRef ? <Text style={[s.th, s.colRef]}>Référence</Text> : null}
        <Text style={[s.th, s.colQte]}>Qté</Text>
      </View>
      {lignes.map((l, i) => (
        <View key={i} style={s.rangee} wrap={false}>
          <View style={s.colRep}>{l.repere != null ? <View style={s.pastille}><Text style={s.pastilleTxt}>{l.repere}</Text></View> : null}</View>
          <Text style={[s.td, { flex: 1, paddingRight: 6 }]} maxLines={2}>{l.designation}{l.detail ? <Text style={s.tdDetail}>{`  ${l.detail}`}</Text> : null}</Text>
          {avecRef ? <Text style={[s.td, s.colRef]}>{l.reference}</Text> : null}
          <Text style={[s.td, s.colQte]}>{`${l.quantite}${l.unite && l.unite !== 'pièce' ? ` ${l.unite}` : ''}`}</Text>
        </View>
      ))}
    </View>
  );
}

function Section({ titre, children }) {
  return <View style={s.section} wrap={false}><Text style={s.sectionTitre}>{titre}</Text>{children}</View>;
}

/** Document du plan (exporté pour le harnais de rendu). */
export function PlanConduitDocument({ model: m }) {
  const avecRef = m.variante === 'chantier';
  const [premieres, ...suites] = decouper(m.pieces.lignes);
  const hauteurCoupe = HAUTEUR_PAGE - 2 * MARGE - 40;
  const largeurCoupe = LARGEUR_PAGE - 2 * MARGE - LARGEUR_DROITE - 14 - 14;
  const ch = m.chantier;
  return (
    <Document title={m.titre} author={m.cartouche.entreprise.nom}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.ligne}>
          <View style={s.gauche}>
            <Text style={s.titre}>{m.titre}</Text>
            <Text style={s.sousTitre}>{m.cartouche.installation.titre}</Text>
            <View style={[s.cadreCoupe, { height: hauteurCoupe }]}>
              <CoupePdf gabaritCode={m.gabaritCode} geometrie={m.geometrie} releve={m.releve} largeur={largeurCoupe} hauteur={hauteurCoupe - 12} />
            </View>
          </View>
          <View style={[s.droite, { height: HAUTEUR_PAGE - 2 * MARGE - HAUTEUR_CARTOUCHE - 8 }]}>
            <TablePieces titre={m.pieces.titre} lignes={premieres} avecRef={avecRef} />
            {suites.length ? <Text style={s.tdDetail}>Suite de la liste page suivante.</Text> : null}
          </View>
        </View>
        <Cartouche c={m.cartouche} />
      </Page>
      {suites.map((lignes, i) => (
        <Page key={`p${i}`} size="A4" orientation="landscape" style={s.page}>
          <View style={{ width: LARGEUR_PAGE - 2 * MARGE - LARGEUR_DROITE - 14 }}>
            <TablePieces titre={`${m.pieces.titre} (suite)`} lignes={lignes} avecRef={avecRef} />
          </View>
          <Cartouche c={m.cartouche} />
        </Page>
      ))}
      {ch ? (
        <Page size="A4" orientation="landscape" style={s.page}>
          <Text style={[s.titre, { marginBottom: 8 }]}>{`${m.titre} — préparation`}</Text>
          <View style={[s.ligne, { width: LARGEUR_PAGE - 2 * MARGE - LARGEUR_DROITE - 14 }]}>
            <View style={{ flex: 1, marginRight: 14 }}>
              <Section titre="Relevé saisi">
                {ch.releveSaisi.map((l, i) => <View key={i} style={s.paire}><Text style={{ flex: 1 }}>{l.libelle}</Text><Text style={{ fontFamily: 'Helvetica-Bold' }}>{l.valeur}</Text></View>)}
              </Section>
              {ch.justification ? <Section titre="Justification du dimensionnement"><Text style={s.puce}>{ch.justification}</Text></Section> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Section titre="Alertes acceptées à l'injection">
                {ch.alertes.length ? ch.alertes.map((a, i) => <Text key={i} style={s.puce}>{`- ${a}`}</Text>) : <Text style={s.puce}>Aucune.</Text>}
              </Section>
              {ch.aVerifier.length ? <Section titre="À vérifier sur place">{ch.aVerifier.map((a, i) => <Text key={i} style={s.puce}>{`- ${a}`}</Text>)}</Section> : null}
              {ch.bilan ? (
                <Section titre="Bilan du conduit existant">
                  {ch.bilan.constats.map((t, i) => <Text key={`c${i}`} style={s.puce}>{`- ${t}`}</Text>)}
                  {ch.bilan.nonConformites.map((n, i) => <Text key={`n${i}`} style={[s.puce, { fontFamily: 'Helvetica-Bold' }]}>{`- ${n.texte} (${n.source})`}</Text>)}
                  {ch.bilan.aVerifier.map((t, i) => <Text key={`v${i}`} style={s.puce}>{`- À vérifier : ${t}`}</Text>)}
                </Section>
              ) : null}
            </View>
          </View>
          <Cartouche c={m.cartouche} />
        </Page>
      ) : null}
    </Document>
  );
}

/**
 * @param {ReturnType<typeof import('@/lib/fumisterie/planModel.js').buildPlanModel>} model
 * @returns {Promise<Blob>}
 */
export async function generatePlanConduitPdfBlob(model) {
  return pdf(<PlanConduitDocument model={model} />).toBlob();
}
