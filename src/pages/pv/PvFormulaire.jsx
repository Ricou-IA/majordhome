/**
 * PvFormulaire — le procès-verbal à lire et à signer, en étapes numérotées : ce que déclare
 * l'installateur, la décision, ce que le client confirme, la signature. Les travaux et le
 * devis ouvrent la page, les garanties précèdent la signature.
 */
import { CalendarDays, Check, FileText, MapPin, PenLine, ShieldCheck } from 'lucide-react';
import { periodeDePose, dateLongue, ligneDevis } from '@/lib/pvReception';
import { prenomLisible } from '@/lib/pagePublique';
import PvDeclaration from './PvDeclaration';
import PvPointsClient from './PvPointsClient';
import PvSignature from './PvSignature';
import { PageAlerte, PageBouton, PageEtape, PageFiche, PageTitre } from '../public/pageUi';

const CHOIX = [
  { valeur: 'sans_reserves', titre: 'Je réceptionne les travaux sans réserve', aide: 'Les travaux sont terminés et conformes.' },
  { valeur: 'avec_reserves', titre: 'Je réceptionne les travaux avec des réserves', aide: 'Des points restent à corriger : je les décris ci-dessous.' },
];

const ZONE = 'w-full rounded-xl border border-secondary-300 bg-white px-4 py-3 text-base text-secondary-900 placeholder:text-secondary-400 focus:border-secondary-900 focus:outline-none focus:ring-1 focus:ring-secondary-900';

function Choix({ choix, actif, onChoisir }) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-4 rounded-2xl border-2 p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-secondary-900 has-[:focus-visible]:ring-offset-2 ${
        actif ? 'border-[color:var(--marque)] bg-[color:var(--marque-doux)]' : 'border-secondary-200 bg-white hover:border-secondary-300'
      }`}
    >
      <input type="radio" name="reception_type" className="sr-only" checked={actif} onChange={onChoisir} />
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
          actif ? 'border-[color:var(--marque)] bg-[color:var(--marque)] text-[color:var(--marque-texte)]' : 'border-secondary-300 bg-white'
        }`}
      >
        {actif && <Check className="h-4 w-4" strokeWidth={3} />}
      </span>
      <span>
        <span className="block text-base font-semibold leading-snug">{choix.titre}</span>
        <span className="mt-1 block text-sm text-secondary-700">{choix.aide}</span>
      </span>
    </label>
  );
}

export default function PvFormulaire({ pv, reponse, maj, envoi, refus, onSigner }) {
  const c = pv.client || {};
  const prenom = prenomLisible(c.prenom);
  const adresse = [c.adresse, [c.code_postal, c.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const pose = periodeDePose(pv.poses);
  const avecReserves = reponse.reception_type === 'avec_reserves';
  const devis = (pv.devis || []).map((d) => ligneDevis(d.libelle, dateLongue(d.date))).filter(Boolean);

  // Les étapes absentes (pas de déclaration, pas de point à confirmer) ne prennent pas de numéro.
  let n = 0;
  const numeroDeclaration = pv.declaration?.length ? (n += 1) : null;
  const numeroDecision = (n += 1);
  const numeroPoints = pv.points_client?.length ? (n += 1) : null;
  const numeroSignature = (n += 1);

  return (
    <div className="space-y-10">
      <div className="space-y-6">
        <PageTitre surtitre="Réception des travaux" titre="Votre installation est terminée">
          {prenom ? `Bonjour ${prenom}, merci` : 'Merci'} de confirmer la réception des travaux : votre signature fait
          courir les garanties.
        </PageTitre>
        <PageFiche
          titre={pv.objet}
          lignes={[
            { icone: CalendarDays, libelle: 'Travaux réalisés', valeur: pose },
            { icone: MapPin, libelle: 'Adresse', valeur: adresse },
            ...devis.map((texte) => ({ icone: FileText, valeur: texte })),
          ]}
        />
      </div>

      <PvDeclaration numero={numeroDeclaration} declaration={pv.declaration} />

      <PageEtape numero={numeroDecision} titre="Votre décision">
        <fieldset disabled={envoi} className="space-y-3 disabled:opacity-60">
          <legend className="sr-only">Votre décision</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {CHOIX.map((choix) => (
              <Choix
                key={choix.valeur} choix={choix}
                actif={reponse.reception_type === choix.valeur}
                onChoisir={() => maj({ reception_type: choix.valeur })}
              />
            ))}
          </div>

          {avecReserves && (
            <div className="max-w-3xl space-y-4 pt-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-secondary-700">
                  Vos réserves <span className="font-normal text-secondary-600">(à décrire)</span>
                </span>
                <textarea
                  rows={4} maxLength={2000} value={reponse.reserves_nature}
                  onChange={(e) => maj({ reserves_nature: e.target.value })}
                  placeholder="Décrivez ce qui ne va pas" className={ZONE}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-secondary-700">
                  Ce que vous attendez <span className="font-normal text-secondary-600">(facultatif)</span>
                </span>
                <textarea
                  rows={3} maxLength={2000} value={reponse.reserves_travaux}
                  onChange={(e) => maj({ reserves_travaux: e.target.value })}
                  placeholder="Travaux à reprendre ou à terminer" className={ZONE}
                />
              </label>
            </div>
          )}
        </fieldset>
      </PageEtape>

      <PvPointsClient
        numero={numeroPoints}
        points={pv.points_client} confirmes={reponse.points_confirmes} disabled={envoi}
        onChange={(points_confirmes) => maj({ points_confirmes })}
      />

      {pv.garanties?.length > 0 && (
        <section className="rounded-2xl bg-secondary-100 p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <ShieldCheck className="h-5 w-5 text-secondary-600" aria-hidden="true" />
            Vos garanties
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-secondary-700 marker:text-secondary-400 lg:grid lg:grid-cols-3 lg:gap-x-10 lg:space-y-0">
            {pv.garanties.map((g) => <li key={g}>{g}</li>)}
          </ul>
        </section>
      )}

      <PageEtape numero={numeroSignature} titre="Votre signature">
        <PvSignature
          nom={reponse.signataire_nom} onNom={(nom) => maj({ signataire_nom: nom })}
          onSignature={(image) => maj({ signature_png: image })}
          disabled={envoi}
        />
      </PageEtape>

      <div className="space-y-4">
        <p className="max-w-prose text-sm leading-relaxed text-secondary-600">
          En signant, vous reconnaissez avoir réceptionné les travaux dans les conditions décrites ci-dessus.
        </p>
        {refus && <PageAlerte>{refus}</PageAlerte>}
        <PageBouton onClick={onSigner} attente={envoi} icone={PenLine}>Signer le procès-verbal</PageBouton>
      </div>
    </div>
  );
}
