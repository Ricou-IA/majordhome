/**
 * AspirateurFournisseur.jsx — bloc « Site et catalogue » de la fiche fournisseur : aspirer le site (un agent apprend le
 * site la première fois, un programme rejoue ensuite la recette), confirmer la recette apprise, valider les propositions.
 * Administrateur seulement (l'aspiration utilise les accès du compte en ligne). Réglages propres au bloc (nature des prix
 * lus, marques), enregistrés à part et FUSIONNÉS dans connector_config. Règles : src/lib/aspirateur/ecran.js.
 * Spec docs/superpowers/specs/2026-11-28-aspirateur-sites-fournisseurs-recettes-communes-design.md § 2.
 */
import { useMemo, useState } from 'react';
import { Globe, Loader2, ListChecks, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@components/ui/status-pill';
import { useAspirateur } from '@hooks/useAspirateur';
import { canonicalFieldsForCategory } from '@/shared/specs';
import { champsDuSchema } from '@/lib/catalogue/enrichissement.js';
import { NATURES_PRIX, reglagesAspirateur, etatDuBloc } from '@/lib/aspirateur/ecran';
import { normaliserDomaine } from '@/lib/aspirateur/domaine';
import { formatDateShortFR } from '@/lib/utils';
import { FormField, SelectInput, TextInput } from '../../../components/FormFields';
import ConfirmerRecette from './aspirateur/ConfirmerRecette';
import PropositionsAspirateur from './aspirateur/PropositionsAspirateur';

export default function AspirateurFournisseur({ supplier, orgId }) {
  const { isOrgAdmin } = useAuth();
  const a = useAspirateur(isOrgAdmin ? orgId : null, supplier);
  const enregistres = useMemo(() => reglagesAspirateur(supplier?.connector_config), [supplier?.connector_config]);
  const [naturePrix, setNaturePrix] = useState(enregistres.naturePrix || '');
  const [marques, setMarques] = useState(enregistres.marques.join(', '));
  const [panneau, setPanneau] = useState(false);
  // Champs lus sur les fiches : schéma poêle (valeurs CEE, sortie des fumées…), réduits à ce que l'IA doit chercher.
  const champs = useMemo(() => champsDuSchema(canonicalFieldsForCategory('poele')), []);

  if (!isOrgAdmin || !supplier) return null;

  const reglagesSaisis = { naturePrix: naturePrix || null, marques: marques.split(',').map((m) => m.trim()).filter(Boolean) };
  const modifie = reglagesSaisis.naturePrix !== enregistres.naturePrix || reglagesSaisis.marques.join('|') !== enregistres.marques.join('|');
  const bloc = etatDuBloc({ etat: a.etat, travail: a.travail, reglages: enregistres, siteUrl: supplier.site_url });
  const nbPropositions = a.propositions?.length ?? null;
  const travail = a.travail;

  const enregistrer = async () => {
    try { await a.enregistrerReglages.mutateAsync(reglagesSaisis); toast.success('Réglages de l’aspirateur enregistrés'); }
    catch (e) { toast.error(e?.message || 'Enregistrement impossible'); }
  };
  const lancer = async () => {
    if (bloc.bouton.raison) { toast.info(bloc.bouton.raison); return; }
    if (modifie) { toast.info('Enregistrez d’abord les réglages de l’aspirateur'); return; }
    try {
      const r = await a.lancer.mutateAsync(champs);
      toast.success(r?.genre === 'apprentissage' ? 'Apprentissage du site lancé : comptez quelques minutes' : 'Aspiration lancée');
    } catch (e) { toast.error(e?.message || 'Lancement impossible'); }
  };
  const confirmer = async () => {
    try { await a.confirmerRecette.mutateAsync({ aspirationId: travail.id, champs }); toast.success('Recette confirmée : aspiration du site lancée'); }
    catch (e) { toast.error(e?.message || 'Confirmation impossible'); }
  };
  const rejeter = async () => {
    try { await a.rejeterRecette.mutateAsync(travail.id); toast.info('Recette écartée : rien n’a été aspiré'); }
    catch (e) { toast.error(e?.message || 'Impossible d’écarter la recette'); }
  };
  const appliquer = async (ids) => {
    try {
      const r = await a.appliquer.mutateAsync(ids);
      if (r.echecs.length) toast.warning(`${r.appliquees} proposition${r.appliquees > 1 ? 's' : ''} appliquée${r.appliquees > 1 ? 's' : ''}, ${r.echecs.length} en échec (restées à valider)`);
      else toast.success(`${r.appliquees} proposition${r.appliquees > 1 ? 's' : ''} appliquée${r.appliquees > 1 ? 's' : ''}`);
    } catch (e) { toast.error(e?.message || 'Application impossible'); }
  };
  const ecarter = async (ids) => {
    try { await a.ecarter.mutateAsync(ids); toast.info('Propositions écartées'); }
    catch (e) { toast.error(e?.message || 'Impossible d’écarter'); }
  };

  return (
    <div className="rounded-lg border border-secondary-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-secondary-900 flex items-center gap-1.5"><Globe className="w-4 h-4" /> Site et catalogue</h3>
        <StatusPill tone={bloc.ton}>{bloc.libelle}</StatusPill>
      </div>
      <p className="text-xs text-secondary-600">
        {normaliserDomaine(supplier.site_url) || 'Adresse du site à renseigner sur la fiche'}
        {enregistres.marques.length ? ` · marques : ${enregistres.marques.join(', ')}` : ''}
      </p>
      {travail && travail.statut !== 'en_cours' && travail.statut !== 'attente_confirmation' && (
        <p className="text-xs text-secondary-600">
          Dernier passage : {formatDateShortFR(travail.lance_le)}
          {travail.compteurs?.lus != null ? ` · ${travail.compteurs.lus} lus sur ${travail.compteurs.trouves ?? '?'} · ${travail.compteurs.echecs ?? 0} en échec` : ''}
        </p>
      )}
      {bloc.erreur && <p className="text-xs text-st-alerte" role="alert">{bloc.erreur}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Prix lus sur le site">
          <SelectInput value={naturePrix} onChange={(v) => setNaturePrix(v)} options={NATURES_PRIX} placeholder="À indiquer" />
        </FormField>
        <FormField label="Marques à aspirer (vide = toutes)">
          <TextInput value={marques} onChange={(v) => setMarques(v)} placeholder="Ex. Deville" />
        </FormField>
      </div>

      {bloc.confirmer && travail && (
        <ConfirmerRecette travail={travail} champs={champs} onConfirmer={confirmer} onRejeter={rejeter}
          enCours={a.confirmerRecette.isPending || a.rejeterRecette.isPending} />
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {modifie && (
          <Button type="button" variant="secondary" size="sm" onClick={enregistrer} disabled={a.enregistrerReglages.isPending}>
            <Save className="w-4 h-4 mr-1" /> Enregistrer les réglages
          </Button>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={() => setPanneau(true)} disabled={!nbPropositions}>
          <ListChecks className="w-4 h-4 mr-1" /> Propositions{nbPropositions != null ? ` (${nbPropositions})` : ''}
        </Button>
        <Button type="button" size="sm" onClick={lancer} disabled={!bloc.bouton.actif || a.lancer.isPending}>
          {a.lancer.isPending || travail?.statut === 'en_cours' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Globe className="w-4 h-4 mr-1" />}
          {bloc.bouton.libelle}
        </Button>
      </div>

      <PropositionsAspirateur ouvert={panneau} onFermer={() => setPanneau(false)} propositions={a.propositions || []} champs={champs}
        onAppliquer={appliquer} onEcarter={ecarter} enCours={a.appliquer.isPending || a.ecarter.isPending} />
    </div>
  );
}
