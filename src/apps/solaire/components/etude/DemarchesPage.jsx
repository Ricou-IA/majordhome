// src/apps/solaire/components/etude/DemarchesPage.jsx
// Page « Vos démarches » : synoptique du parcours en 3 colonnes (Étape | Ce que vous faites |
// Ce que nous faisons), rendu depuis le résultat FIGÉ du moteur Démarches — aucun calcul ici.
// Couleur + pictogramme texte + libellé (jamais la couleur seule). Glyphes Helvetica uniquement.
import { Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { C, CompanyHeader, Footer, sharedStyles } from './pdfShared';

const JAUNE_FOND = '#FFF6D6';
const BLEU_FOND = '#E3F0FD';

const s = StyleSheet.create({
  intro: { fontSize: 7.5, color: C.grisTxt, lineHeight: 1.4, marginBottom: 6 },
  head: { flexDirection: 'row', marginBottom: 2 },
  headEtape: { width: '24%', fontSize: 6.8, color: C.grisTxt, paddingHorizontal: 4, paddingVertical: 3 },
  headVous: { width: '38%', fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#7C4A03', backgroundColor: JAUNE_FOND, borderBottom: `1.5px solid ${C.jaune}`, paddingHorizontal: 5, paddingVertical: 3 },
  headNous: { width: '38%', fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.bleuF, backgroundColor: BLEU_FOND, borderBottom: `1.5px solid ${C.bleuC}`, paddingHorizontal: 5, paddingVertical: 3 },
  row: { flexDirection: 'row', marginBottom: 2 },
  cellEtape: { width: '24%', paddingHorizontal: 4, paddingVertical: 4, flexDirection: 'row' },
  num: { width: 11, height: 11, borderRadius: 5.5, backgroundColor: C.noir, color: C.blanc, fontSize: 6.5, fontFamily: 'Helvetica-Bold', textAlign: 'center', paddingTop: 1.5, marginRight: 4 },
  etapeTitre: { fontSize: 7.2, fontFamily: 'Helvetica-Bold', color: C.noir },
  etapeSub: { fontSize: 6.2, color: C.grisTxt, marginTop: 1 },
  cellVous: { width: '38%', backgroundColor: JAUNE_FOND, borderLeft: `1.5px solid ${C.jaune}`, paddingHorizontal: 5, paddingVertical: 4, fontSize: 6.8, lineHeight: 1.35, color: C.noir },
  cellNous: { width: '38%', backgroundColor: BLEU_FOND, borderLeft: `1.5px solid ${C.bleuC}`, paddingHorizontal: 5, paddingVertical: 4, fontSize: 6.8, lineHeight: 1.35, color: C.noir },
  vide: { color: C.gris },
  note: { fontSize: 6.5, color: C.grisTxt, marginTop: 8, lineHeight: 1.4 },
});

export function DemarchesPage({ demarches, company }) {
  const etapes = (demarches?.etapes ?? []).filter((e) => e.applicable);
  const mode = demarches?.inputs?.mode_valorisation === 'autoconso_totale'
    ? 'autoconsommation totale, sans injection sur le réseau'
    : 'autoconsommation avec vente du surplus';
  return (
    <Page size="A4" style={sharedStyles.page}>
      <CompanyHeader company={company} />
      <Text style={sharedStyles.sectionTitle}>Vos démarches, étape par étape</Text>
      <Text style={s.intro}>
        Votre projet ({mode}) suit un parcours administratif en {etapes.length} étapes. Pour chacune, ce que vous
        faites et ce que {company.name} fait pour vous, par mandat. Les délais indiqués sont indicatifs.
      </Text>

      <View style={s.head}>
        <Text style={s.headEtape}>Étape</Text>
        <Text style={s.headVous}>[Vous]  Ce que vous faites</Text>
        <Text style={s.headNous}>[Nous]  Ce que nous faisons</Text>
      </View>
      {etapes.map((e, i) => (
        <View key={e.code} style={s.row} wrap={false}>
          <View style={s.cellEtape}>
            <Text style={s.num}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.etapeTitre}>{e.libelle}</Text>
              {e.delai?.libelle ? <Text style={s.etapeSub}>Délai : {e.delai.libelle}</Text> : null}
              {e.tiers ? <Text style={s.etapeSub}>Avec : {e.tiers}</Text> : null}
            </View>
          </View>
          <Text style={s.cellVous}>{e.client ?? <Text style={s.vide}>Rien à faire</Text>}</Text>
          <Text style={s.cellNous}>{e.installateur}</Text>
        </View>
      ))}

      <Text style={s.note}>
        Le déclarant de la déclaration préalable reste le client ; {company.name} établit et dépose le dossier par mandat et
        suit la demande de raccordement auprès d&apos;Enedis. L&apos;arrêté de la mairie et les courriers vous sont adressés directement :
        merci de nous les transmettre dès réception.
      </Text>
      <Footer company={company} />
    </Page>
  );
}
