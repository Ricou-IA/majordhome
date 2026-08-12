/* eslint-disable react-refresh/only-export-components -- module de rendu PDF (blob), jamais monté
   dans l'arbre React : Fast Refresh ne s'applique pas. */
/**
 * DpeSynthesePDF.jsx — Synthèse énergétique remise au client
 * ============================================================================
 * Document COMMERCIAL brandé org, construit à partir des données publiques du
 * DPE. Il n'imite pas la mise en page réglementaire et ne se présente jamais
 * comme un diagnostic : la mention figure en couverture ET en pied de page.
 *
 * Socle graphique mutualisé avec le rapport thermique (`@apps/thermique/.../
 * pdfShared`) : palette deutan, formatters PDF-safe, cartouche société. Le
 * `Footer` de ce socle n'est PAS réutilisé — son texte est propre à l'étude
 * thermique. Si un 3ᵉ document réutilise ce socle, il faudra le promouvoir
 * dans `src/lib/` plutôt que de multiplier les imports inter-apps.
 *
 * ⚠️ Helvetica / WinAnsi : pas de lettres grecques, de flèches, ni de
 * « ≈ ≥ ≤ − ». Autorisés : ° ² · × — – ’ « » € %. Tous les nombres passent par
 * les formatters de `pdfShared` (qui neutralisent l'espace fine U+202F).
 *
 * Le document n'effectue AUCUN calcul : tout vient de `buildDpeReportModel`.
 * ============================================================================
 */
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import {
  C, accentOf, sharedStyles, fmtInt, fmtDec, eur,
  CompanyHeader, SectionTitle, Kpi, Encart,
} from '@apps/thermique/components/etude/pdfShared';
import { buildLegalFooter } from '@lib/orgBranding';

const s = StyleSheet.create({
  coverTitle: { fontSize: 22, fontFamily: 'Helvetica-Bold', marginTop: 28 },
  coverSub: { fontSize: 10, color: C.grisTxt, marginTop: 4 },
  clientBox: { marginTop: 22, padding: 12, borderRadius: 5, backgroundColor: C.grisClair },
  clientName: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  clientAddr: { fontSize: 9, color: C.slate, marginTop: 3 },

  gradeRow: { flexDirection: 'row', gap: 10, marginTop: 18, alignItems: 'stretch' },
  grade: { width: 58, borderRadius: 5, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  gradeLetter: { fontSize: 26, fontFamily: 'Helvetica-Bold', color: C.blanc },
  gradeCaption: { fontSize: 6, color: C.blanc, marginTop: 1 },

  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  barLabel: { width: 92, fontSize: 7.5, color: C.slate },
  barTrack: { flex: 1, height: 7, backgroundColor: C.grisClair, borderRadius: 3 },
  barFill: { height: 7, backgroundColor: C.ambre, borderRadius: 3 },
  barPct: { width: 30, fontSize: 7.5, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  barWatt: { width: 52, fontSize: 6.5, color: C.grisTxt, textAlign: 'right' },

  costRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3.5, borderBottom: `0.4px solid ${C.grisClair}` },
  costLabel: { fontSize: 8, color: C.slate },
  costValue: { fontSize: 8, fontFamily: 'Helvetica-Bold' },

  reco: { borderLeft: `2.5px solid ${C.ambre}`, paddingLeft: 9, paddingVertical: 5, marginBottom: 11 },
  recoTitle: { fontSize: 9.5, fontFamily: 'Helvetica-Bold' },
  recoWhy: { fontSize: 7.8, color: C.slate, marginTop: 3, lineHeight: 1.45 },
  recoWhat: { fontSize: 7.8, marginTop: 4, fontFamily: 'Helvetica-Bold', color: C.bleuF },

  isoRow: { flexDirection: 'row', paddingVertical: 3, borderBottom: `0.4px solid ${C.grisClair}` },
  footNote: { fontSize: 7, color: C.grisTxt, lineHeight: 1.5, marginTop: 10 },
});

/**
 * Teinte de l'étiquette : dégradé bleu → ambre (palette deutan, jamais le
 * vert/rouge de la réglette officielle — on ne l'imite pas, et cette échelle
 * reste lisible en vision deutéranope). La lettre porte l'information.
 */
const GRADE_TONE = {
  A: C.bleuF, B: C.bleuF, C: C.bleu, D: C.slate, E: C.ambre, F: C.ambreTxt, G: C.ambreTxt,
};
const toneOf = (letter) => GRADE_TONE[String(letter || '').toUpperCase()] || C.grisTxt;

function Grade({ letter, caption }) {
  if (!letter) return null;
  return (
    <View style={[s.grade, { backgroundColor: toneOf(letter) }]}>
      <Text style={s.gradeLetter}>{String(letter).toUpperCase()}</Text>
      <Text style={s.gradeCaption}>{caption}</Text>
    </View>
  );
}

function ReportFooter({ company, mention }) {
  const legal = buildLegalFooter(company);
  return (
    <View style={sharedStyles.footer} fixed>
      {legal ? <Text style={sharedStyles.footerText}>{legal}</Text> : null}
      <Text style={sharedStyles.footerText}>{mention}</Text>
      <Text
        style={sharedStyles.pageNum}
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </View>
  );
}

// --- Page 1 : couverture ----------------------------------------------------

function CoverPage({ model, company }) {
  const { client, logement, source, dateLabel } = model;

  return (
    <Page size="A4" style={sharedStyles.page}>
      <CompanyHeader company={company} />

      <Text style={[s.coverTitle, { color: accentOf(company) }]}>
        Bilan énergétique de votre logement
      </Text>
      <Text style={s.coverSub}>
        Ce que révèlent les données de votre logement, et ce qu’on peut y faire ensemble
        {dateLabel ? ` — ${dateLabel}` : ''}
      </Text>

      <View style={s.clientBox}>
        <Text style={s.clientName}>{client.nom || 'Votre logement'}</Text>
        {client.adresse ? <Text style={s.clientAddr}>{client.adresse}</Text> : null}
        <Text style={s.clientAddr}>
          {[
            logement.type,
            logement.surface ? `${fmtInt(logement.surface)} m² habitables` : null,
            logement.annee ? `construit en ${logement.annee}` : null,
          ].filter(Boolean).join('  ·  ')}
        </Text>
      </View>

      <View style={s.gradeRow}>
        <Grade letter={logement.etiquette} caption="ÉNERGIE" />
        <Grade letter={logement.ges} caption="CLIMAT" />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <View style={sharedStyles.kpiRow}>
            <Kpi
              label="Coût annuel d’énergie"
              value={eur(model.argent.total)}
              hint="chauffage, eau chaude, éclairage et auxiliaires"
            />
            <Kpi
              label="Consommation"
              value={logement.consoPerM2 ? `${fmtInt(logement.consoPerM2)}` : '—'}
              hint="kWh par m² et par an"
            />
          </View>
        </View>
      </View>

      {model.chaleur.phrase ? (
        <Encart ton="alerte">{model.chaleur.phrase}</Encart>
      ) : null}

      <Text style={s.footNote}>
        {source.mention}
        {source.numeroDpe
          ? ` Référence du diagnostic exploité : ${source.numeroDpe}${source.dateDpeLabel ? `, établi le ${source.dateDpeLabel}` : ''}`
          : ''}
        {source.adresseDiagnostic ? `, à l’adresse « ${source.adresseDiagnostic} »` : ''}
        {source.numeroDpe ? '.' : ''}
      </Text>
      <Text style={s.footNote}>
        Les données décrivent le logement à la date du diagnostic. Si vous avez depuis remplacé un
        équipement ou réalisé des travaux, signalez-le nous : nous mettrons ce bilan à jour avec vous.
      </Text>

      <ReportFooter company={company} mention={source.mention} />
    </Page>
  );
}

// --- Page 2 : état des lieux ------------------------------------------------

function StatePage({ model, company }) {
  const { chaleur, argent, installation, logement } = model;

  return (
    <Page size="A4" style={sharedStyles.page}>
      <CompanyHeader company={company} />

      <SectionTitle company={company}>Où part la chaleur</SectionTitle>
      <Text style={{ fontSize: 8, color: C.slate, marginBottom: 7, lineHeight: 1.45 }}>
        Chaque poste ci-dessous laisse échapper une part de la chaleur que vous produisez. Plus la
        barre est longue, plus ce poste vous coûte cher chaque hiver.
        {logement.ubat
          ? ` Votre enveloppe perd ${fmtDec(logement.ubat, 2)} W par m² et par degré d’écart avec l’extérieur.`
          : ''}
      </Text>

      {chaleur.posts.map((p) => (
        <View key={p.key} style={s.barRow}>
          <Text style={s.barLabel}>{p.label}</Text>
          <View style={s.barTrack}>
            <View style={[s.barFill, { width: `${Math.max(p.share, 1)}%` }]} />
          </View>
          <Text style={s.barPct}>{Math.round(p.share)} %</Text>
          <Text style={s.barWatt}>{fmtDec(p.watts, 1)} W/K</Text>
        </View>
      ))}

      <SectionTitle company={company}>Où part votre argent</SectionTitle>
      {argent.postes.map((c) => (
        <View key={c.key} style={s.costRow}>
          <Text style={s.costLabel}>{c.label}</Text>
          <Text style={s.costValue}>{eur(c.euros)}</Text>
        </View>
      ))}
      {argent.total ? (
        <View style={[s.costRow, { borderBottom: 'none', marginTop: 2 }]}>
          <Text style={[s.costLabel, { fontFamily: 'Helvetica-Bold' }]}>Total par an</Text>
          <Text style={[s.costValue, { fontSize: 10, color: accentOf(company) }]}>
            {eur(argent.total)}
          </Text>
        </View>
      ) : null}

      <SectionTitle company={company}>Votre installation</SectionTitle>
      {[
        ['Chauffage', installation.chauffage],
        ['Eau chaude', installation.ecs],
        ['Ventilation', installation.ventilation],
        ['Refroidissement', installation.froid || 'Aucun équipement recensé'],
      ].map(([label, value]) => (
        <View key={label} style={s.isoRow}>
          <Text style={[sharedStyles.td, { width: 110, color: C.grisTxt }]}>{label}</Text>
          <Text style={[sharedStyles.td, { flex: 1 }]}>{value || '—'}</Text>
        </View>
      ))}

      {installation.isolation.length > 0 && (
        <>
          <SectionTitle company={company}>Ce que laissent passer les parois</SectionTitle>
          {installation.isolation.map((i) => (
            <View key={i.label} style={s.isoRow}>
              <Text style={[sharedStyles.td, { width: 110, color: C.grisTxt }]}>{i.label}</Text>
              <Text style={[sharedStyles.td, { width: 78, fontFamily: 'Helvetica-Bold' }]}>{i.value}</Text>
              <Text style={[sharedStyles.td, { flex: 1, color: C.slate }]}>
                {i.plain ? `— ${i.plain}` : ''}
              </Text>
            </View>
          ))}
        </>
      )}

      <ReportFooter company={company} mention={model.source.mention} />
    </Page>
  );
}

// --- Page 3 : recommandations -----------------------------------------------

function ActionPage({ model, company }) {
  const { recommandations, horsPerimetre } = model;

  return (
    <Page size="A4" style={sharedStyles.page}>
      <CompanyHeader company={company} />

      <SectionTitle company={company}>Ce que nous pouvons faire</SectionTitle>

      {recommandations.length === 0 ? (
        <Text style={{ fontSize: 8.5, color: C.slate, lineHeight: 1.5 }}>
          Votre installation ne fait apparaître aucun point d’intervention prioritaire au vu des
          données disponibles. Une visite sur place reste le seul moyen d’en avoir le coeur net.
        </Text>
      ) : (
        recommandations.map((r) => (
          <View key={r.key} style={s.reco} wrap={false}>
            <Text style={s.recoTitle}>{r.titre}</Text>
            <Text style={s.recoWhy}>{r.pourquoi}</Text>
            <Text style={s.recoWhat}>{r.prestation}</Text>
          </View>
        ))
      )}

      {horsPerimetre && (
        <>
          <SectionTitle company={company}>En toute transparence</SectionTitle>
          <Text style={{ fontSize: 8, color: C.slate, lineHeight: 1.5 }}>
            {`Le premier poste de pertes de votre logement, ce sont ${horsPerimetre.libelles.join(' et ')} : ${horsPerimetre.sharePct} % de la chaleur produite s’y échappe. `}
            Ce n’est pas notre métier et nous ne vous le vendrons pas. Nous le signalons parce que
            c’est le levier le plus lourd, et qu’il vaut mieux le savoir avant d’investir.
          </Text>
          <Encart>
            Agir sur le chauffage reste rentable sans y toucher : un générateur plus performant
            produit la même chaleur en consommant nettement moins, quelle que soit la qualité des
            parois.
          </Encart>
        </>
      )}

      <SectionTitle company={company}>La suite</SectionTitle>
      <Text style={{ fontSize: 8, color: C.slate, lineHeight: 1.5 }}>
        Aucun montant ne figure dans ce document : un chiffrage sérieux demande une visite et des
        relevés sur place. Les pistes ci-dessus sont là pour décider ensemble de ce qui mérite
        d’être étudié en premier.
      </Text>

      <ReportFooter company={company} mention={model.source.mention} />
    </Page>
  );
}

// --- Document ---------------------------------------------------------------

export function DpeSyntheseDocument({ model, company }) {
  return (
    <Document
      title={`Bilan énergétique — ${model.client.nom || 'logement'}`}
      author={company?.name || ''}
    >
      <CoverPage model={model} company={company} />
      <StatePage model={model} company={company} />
      <ActionPage model={model} company={company} />
    </Document>
  );
}

export async function generateDpeSynthesePdfBlob({ model, company }) {
  return pdf(<DpeSyntheseDocument model={model} company={company} />).toBlob();
}
