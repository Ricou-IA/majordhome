// src/apps/solaire/components/etude/DemarchesVigilancePage.jsx
// Page « Points de vigilance, calendrier, pièces et frais » : rendu du résultat FIGÉ du
// moteur Démarches (dates, montants et alertes calculés en amont — aucun calcul ici).
import { Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { C, numStr, CompanyHeader, Footer, sharedStyles } from './pdfShared';

const NIVEAU = {
  info: { libelle: 'Information', fond: '#E3F0FD', bord: C.bleuC, txt: C.bleuF },
  avertissement: { libelle: 'À vérifier', fond: '#FFF6D6', bord: C.jaune, txt: '#7C4A03' },
  bloquant: { libelle: 'Bloquant', fond: C.bleuF, bord: C.bleuF, txt: C.blanc },
};

const JALONS = [
  ['depot_dp', 'Dépôt de la déclaration préalable'],
  ['accord_dp', 'Accord prévu de la mairie'],
  ['depot_enedis', 'Demande Enedis déposée'],
  ['fin_recours', 'Fin du recours des tiers'],
  ['reponse_enedis', 'Réponse Enedis'],
  ['pose_au_plus_tot', 'Pose au plus tôt'],
  ['attestation_consuel', 'Attestation Consuel'],
  ['mise_en_service_au_plus_tard', 'Mise en service au plus tard'],
];

const PEC = { inclus: 'Inclus dans l’offre', refacture: 'Avancés par nous, refacturés' };

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** ISO → « 15 février 2027 » sans Intl (espace simple, PDF-safe). */
function dateFr(iso) {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MOIS[m - 1]} ${y}`;
}
/** 50.1 → « 50,10 € » (2 décimales, espace simple pour les milliers, PDF-safe). */
const eurPdf = (n) => {
  const [ent, dec] = n.toFixed(2).split('.');
  return `${ent.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${dec} €`;
};

const s = StyleSheet.create({
  alerte: { flexDirection: 'row', borderRadius: 3, paddingVertical: 3, paddingHorizontal: 5, marginBottom: 2.5, borderLeftWidth: 2 },
  alerteNiv: { fontFamily: 'Helvetica-Bold', fontSize: 6.8, width: 52 },
  alerteTxt: { flex: 1, fontSize: 6.8, lineHeight: 1.35 },
  two: { flexDirection: 'row', gap: 12 },
  col: { flex: 1 },
  jalon: { flexDirection: 'row', paddingVertical: 1.8, borderBottom: `0.5px solid ${C.grisClair}` },
  jalonLbl: { flex: 1, fontSize: 6.8, color: C.grisTxt },
  jalonVal: { width: 92, fontSize: 6.8, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  duree: { fontSize: 7, marginTop: 4 },
  piece: { flexDirection: 'row', paddingVertical: 1.6 },
  pieceBox: { width: 8, fontSize: 7, color: C.bleuM },
  pieceTxt: { flex: 1, fontSize: 6.8 },
  fraisRow: { flexDirection: 'row', paddingVertical: 2, borderBottom: `0.5px solid ${C.grisClair}` },
  fraisLbl: { flex: 1, fontSize: 6.8 },
  fraisMontant: { width: 50, fontSize: 6.8, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  fraisPec: { width: 84, fontSize: 6, color: C.grisTxt, textAlign: 'right' },
  bon: { fontSize: 6.8, lineHeight: 1.4, marginBottom: 2 },
  bonStrong: { fontFamily: 'Helvetica-Bold' },
  small: { fontSize: 6.3, color: C.grisTxt, marginTop: 3 },
});

export function DemarchesVigilancePage({ demarches, company }) {
  const planning = demarches.planning;
  const pieces = (demarches.pieces ?? []).filter((p) => p.applicable);
  const frais = demarches.frais;
  const surplus = demarches.inputs?.mode_valorisation === 'autoconso_surplus';
  const alertes = demarches.alertes ?? [];
  return (
    <Page size="A4" style={sharedStyles.page}>
      <CompanyHeader company={company} />

      <Text style={sharedStyles.sectionTitle}>Points de vigilance</Text>
      {alertes.length === 0 ? (
        <Text style={s.bon}>Aucun point particulier relevé pour ce projet.</Text>
      ) : alertes.map((a, i) => {
        const n = NIVEAU[a.niveau] ?? NIVEAU.info;
        return (
          <View key={`${a.code}-${i}`} style={[s.alerte, { backgroundColor: n.fond, borderLeftColor: n.bord }]}>
            <Text style={[s.alerteNiv, { color: n.txt }]}>{n.libelle}</Text>
            <Text style={[s.alerteTxt, { color: n.txt }]}>{a.message}</Text>
          </View>
        );
      })}

      <View style={s.two}>
        <View style={s.col}>
          <Text style={sharedStyles.sectionTitle}>Calendrier prévisionnel</Text>
          {JALONS.map(([cle, lbl]) => (
            <View key={cle} style={s.jalon}>
              <Text style={s.jalonLbl}>{lbl}</Text>
              <Text style={s.jalonVal}>{dateFr(planning?.[cle])}</Text>
            </View>
          ))}
          <Text style={s.duree}>
            Durée totale estimée : <Text style={s.bonStrong}>{numStr(planning?.duree_totale_mois ?? 0)} mois</Text> (délais indicatifs)
          </Text>
          <Text style={s.small}>
            La demande Enedis part dès l&apos;accord de la mairie, en parallèle du délai de recours des tiers. La pose est
            programmée après ces deux échéances.
          </Text>
        </View>
        <View style={s.col}>
          <Text style={sharedStyles.sectionTitle}>Pièces à nous transmettre</Text>
          {pieces.map((p) => (
            <View key={p.code} style={s.piece}>
              <Text style={s.pieceBox}>[ ]</Text>
              <Text style={s.pieceTxt}>{p.libelle}</Text>
            </View>
          ))}

          <Text style={sharedStyles.sectionTitle}>Frais administratifs</Text>
          {(frais?.lignes ?? []).map((l) => (
            <View key={l.code} style={s.fraisRow}>
              <Text style={s.fraisLbl}>{l.libelle}</Text>
              <Text style={s.fraisMontant}>{l.montant_connu ? (l.montant_ttc === 0 ? 'Gratuit' : eurPdf(l.montant_ttc)) : 'À confirmer'}</Text>
              <Text style={s.fraisPec}>{l.montant_connu && l.montant_ttc === 0 ? '' : (PEC[l.prise_en_charge] ?? '')}</Text>
            </View>
          ))}
          <View style={s.fraisRow}>
            <Text style={[s.fraisLbl, s.bonStrong]}>Total</Text>
            <Text style={s.fraisMontant}>{frais?.total_connu ? eurPdf(frais.total_ttc) : 'Incomplet'}</Text>
            <Text style={s.fraisPec} />
          </View>
          {demarches.rachat?.applicable && demarches.rachat.tarif ? (
            <Text style={s.small}>
              Rachat du surplus : {numStr(demarches.rachat.tarif.valeur)} {demarches.rachat.tarif.unite} (tarif en vigueur au {dateFr(demarches.rachat.tarif.date_effet)}).
            </Text>
          ) : null}
        </View>
      </View>

      <Text style={sharedStyles.sectionTitle}>Bon à savoir</Text>
      <Text style={s.bon}>
        <Text style={s.bonStrong}>Affichage de l&apos;accord.</Text> Dès réception, l&apos;accord de la mairie doit être affiché sur le terrain,
        visible depuis la rue, pendant toute la durée du chantier : c&apos;est ce qui fait courir le délai de recours des tiers.
      </Text>
      <Text style={s.bon}>
        <Text style={s.bonStrong}>Fin des travaux.</Text> La déclaration d&apos;achèvement (DAACT, Cerfa 13408) est à envoyer à la mairie
        une fois l&apos;installation en service ; nous vous la préparons.
      </Text>
      <Text style={s.bon}>
        <Text style={s.bonStrong}>Contrôle Consuel.</Text> L&apos;attestation de conformité électrique (visa {demarches.consuel === 'violet' ? 'violet, avec batterie' : 'bleu'}) est
        obligatoire avant la mise en service par Enedis.
      </Text>
      {surplus ? (
        <Text style={s.bon}>
          <Text style={s.bonStrong}>Vente du surplus.</Text> Le contrat de rachat (EDF Obligation d&apos;Achat) est signé par vous après la mise en
          service ; le tarif est celui en vigueur à la date de la demande complète de raccordement, garanti 20 ans.
        </Text>
      ) : (
        <Text style={s.bon}>
          <Text style={s.bonStrong}>Sans injection.</Text> La convention d&apos;autoconsommation sans injection (CACSI) est gratuite et signée
          par mandat ; aucun contrat de vente n&apos;est à prévoir.
        </Text>
      )}
      <Footer company={company} />
    </Page>
  );
}
