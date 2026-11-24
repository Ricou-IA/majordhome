/**
 * CreateDevisModal.jsx — création d'un devis sur UN SEUL écran (décision Eric 2026-09-29, ex-wizard
 * 3 étapes) : en-tête compact (client, installation, devis type, objet), sections et lignes, bloc
 * repliable « Remise, validité, conditions », pied avec totaux + marge et « Créer le devis ».
 * Mode ÉDITION (`devisAModifier = { quote, lines }`, depuis la fiche du devis — demande d'Eric 2026-10-25) : même
 * écran pré-rempli ; « Enregistrer » met à jour le devis et remplace ses lignes. Un devis déjà dans Pennylane se
 * renvoie ensuite depuis la fiche (« Renvoyer dans Pennylane »).
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { buildDevisConfig, famillesActives, familleDuLead, familleDe, typeChapitre } from '@/lib/devisConfig.js';
import { useLeadMutations } from '@hooks/useLeads';
import { reclasserDansSections } from '@/lib/devisOrdre.js';
import { useDevisMutations } from '@hooks/useDevis';
import { useFumMetreMutations } from '@hooks/useFumisterie';
import { useCatalogItemsSpecs } from '@hooks/useCatalogItems';
import { figerCaracteristiques, lignesNonResolues } from '@/lib/devisCaracteristiques.js';
import { canonicalFieldsForCategory } from '@/shared/specs';
import { devisService, buildDefaultSections, computeQuoteTotals, margeFournitures } from '@services/devis.service';
import { logger } from '@lib/logger';
import { formatEuro } from '@/lib/utils';
import DevisEntete from './DevisEntete';
import DevisStepLines from './DevisStepLines';
import DevisConditions from './DevisConditions';
import { X, Loader2, Eye } from 'lucide-react';
import ApercuDevis from '@/apps/artisan/pages/settings/devis/ApercuDevis';
import { buildDevisDocumentModel } from '@/lib/devisDocumentModel.js';
import { quoteApercu } from '@/lib/devisApercu.js';
import { buildCompanyInfo } from '@/lib/orgBranding';
import { invoicingSettings } from '@/lib/invoiceDocumentModel.js';
import { CalqueModal } from '@/components/ui/calque-modal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { saisieDevisAPerdre } from '@/lib/devisFermeture.js';
import { manquesDevis, RAISONS_DEVIS } from '@/lib/devisValidation.js';
import { useAfficherMarges } from '@hooks/useAfficherMarges';
import { toast } from 'sonner';

/**
 * @param {object} p
 * @param {object} p.lead
 * @param {Array<object>} [p.initialLines] lignes pré-remplies (ex. dimensionnement clim /clim) — sections comprises
 * @param {string} [p.initialFamily] famille d'installation pré-sélectionnée (QUOTE_TEMPLATE_FAMILIES)
 * @param {{ quote: object, lines: object[] }} [p.devisAModifier] devis existant à modifier (mode édition)
 * @param {string|null} [p.interventionId] carte SAV vers laquelle flécher le devis créé (fiche SAV) : pas de lead, le
 *   devis part sur le client et n'entre jamais dans le pipeline (src/lib/savDevis.js)
 */
export default function CreateDevisModal({ lead, onClose, onCreated, initialLines = null, initialFamily = '', devisAModifier = null, interventionId = null }) {
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const { createQuote, isCreating, updateQuote, upsertLines } = useDevisMutations(lead?.id);
  const edition = !!devisAModifier?.quote;
  const [enregistrement, setEnregistrement] = useState(false);
  const [importOffre, setImportOffre] = useState(false); // fenêtre « Importer une offre fournisseur » (bouton de l'en-tête)
  const { saveMetre } = useFumMetreMutations(orgId);
  const { updateLead } = useLeadMutations();
  // Familles, chapitres, conditions et validité par défaut : Settings → Socle → Devis
  const { settings, isLoading: settingsLoading } = useOrgSettings();
  const devisConfig = useMemo(() => buildDevisConfig(settings), [settings]);

  // en édition : lignes enregistrées ; une ligne produit sans article ni ligne fournisseur redevient « libre » (éditable)
  const [lines, setLines] = useState(() => (edition
    ? devisAModifier.lines.map((l) => ({ ...l, is_freeform: l.is_freeform ?? (l.line_type === 'product' && !l.catalog_item_id && !l.supplier_product_id) }))
    : (Array.isArray(initialLines) ? initialLines : [])));
  // Métré fumisterie validé (relevé + résultat figé), enregistré APRÈS création du devis
  const [metre, setMetre] = useState(null);
  const [form, setForm] = useState(() => (edition ? {
    subject: devisAModifier.quote.subject || '', validityDays: String(devisAModifier.quote.validity_days || 30),
    conditions: devisAModifier.quote.conditions || '', commentaire: devisAModifier.quote.commentaire || '',
    notesInternes: devisAModifier.quote.notes_internes || '', globalDiscountPercent: String(devisAModifier.quote.global_discount_percent || 0),
  } : { subject: '', validityDays: '30', conditions: '', commentaire: '', notesInternes: '', globalDiscountPercent: '0' }));
  // validité par défaut de l'org pour un NOUVEAU devis seulement (un devis modifié garde la sienne)
  useEffect(() => { if (!edition) setForm((prev) => ({ ...prev, validityDays: String(devisConfig.document.validite_jours) })); }, [devisConfig.document.validite_jours, edition]);

  // Templates
  const [templates, setTemplates] = useState([]);
  const [selectedFamily, setSelectedFamily] = useState(initialFamily || '');
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);

  // Installation présélectionnée depuis le « Projet » du lead, repli sur le libellé de son équipement (une seule fois, réglages chargés),
  // seulement pour un nouveau devis vide : ni en édition, ni par-dessus des lignes déjà là (clim, devis type).
  const familleAutoFaite = useRef(false);
  useEffect(() => {
    if (familleAutoFaite.current || settingsLoading || edition || initialFamily || lines.length > 0) return;
    familleAutoFaite.current = true;
    const f = familleDuLead(devisConfig, lead);
    if (f) { setSelectedFamily(f); setLines(buildDefaultSections(f, devisConfig)); }
  }, [settingsLoading, edition, initialFamily, lines.length, devisConfig, lead]);

  useEffect(() => {
    if (!orgId) return;
    devisService.getTemplates(orgId).then(({ data }) => setTemplates(data || []));
  }, [orgId]);

  const nbLignes = useMemo(() => lines.filter((l) => l.line_type !== 'section_title').length, [lines]);
  const totals = useMemo(() => computeQuoteTotals(lines, form.globalDiscountPercent), [lines, form.globalDiscountPercent]);
  const marge = useMemo(() => margeFournitures(lines), [lines]);
  const marges = useAfficherMarges();
  // Aperçu pendant la saisie : même modèle de document que le PDF (buildDevisDocumentModel), rien de recalculé ici.
  const [apercuOuvert, setApercuOuvert] = useState(false);
  const modeleApercu = useMemo(() => buildDevisDocumentModel({
    quote: quoteApercu({ lead, form, quote: edition ? devisAModifier.quote : null }),
    lines, totals, company: buildCompanyInfo(settings), config: devisConfig, invoicing: invoicingSettings(settings),
  }), [lead, form, edition, devisAModifier, lines, totals, settings, devisConfig]); // prix d'achat et marge masqués par défaut, affichables par l'administrateur

  // Caractéristiques des articles posés : lues à l'enregistrement pour être FIGÉES sur les lignes cochées
  const idsArticles = useMemo(() => lines.map((l) => l.catalog_item_id).filter(Boolean), [lines]);
  const { articles } = useCatalogItemsSpecs(orgId, idsArticles);

  const applyTemplate = useCallback((template) => {
    if (!template) return;
    const parsedLines = typeof template.lines === 'string' ? JSON.parse(template.lines) : template.lines;
    setLines(parsedLines || []);
    setMetre(null); // lignes remplacées → le métré injecté n'a plus de lignes
    if (template.global_discount_percent) setForm((prev) => ({ ...prev, globalDiscountPercent: String(template.global_discount_percent) }));
    setSelectedTemplateId(template.id);
    toast.success(`Devis type "${template.name}" chargé`);
  }, []);

  const clearTemplate = useCallback(() => {
    setLines([]);
    setMetre(null);
    setSelectedTemplateId(null);
    setForm((prev) => ({ ...prev, globalDiscountPercent: '0' }));
  }, []);

  const setField = useCallback((field, value) => setForm((prev) => ({ ...prev, [field]: value })), []);

  // Fermer sans perdre une saisie : Échap, fond, croix et « Annuler » passent par demanderFermeture.
  // `touche` = l'utilisateur a modifié quelque chose (des lignes reçues d'un dimensionnement comptent).
  const [touche, setTouche] = useState(() => !edition && Array.isArray(initialLines) && initialLines.length > 0);
  const [confirmerAbandon, setConfirmerAbandon] = useState(false);
  const setLinesSaisie = useCallback((maj) => { setTouche(true); setLines(maj); }, []);
  const setFieldSaisie = useCallback((field, value) => { setTouche(true); setField(field, value); }, [setField]);
  const aPerdre = saisieDevisAPerdre({ touche, lines, subject: form.subject });
  const demanderFermeture = () => { if (aPerdre) setConfirmerAbandon(true); else onClose(); };

  // Créer n'est ouvert qu'avec un objet et une ligne chiffrée (règle pure devisValidation.js).
  // L'erreur sous l'objet n'apparaît qu'une fois le champ quitté, ou quand c'est le seul manque.
  const manques = manquesDevis({ subject: form.subject, lines });
  const [objetQuitte, setObjetQuitte] = useState(false);
  const erreurObjet = manques.objet && (objetQuitte || !manques.ligne) ? RAISONS_DEVIS.objet : null;

  // Changer d'installation ne jette plus aucune ligne (retour d'Eric 2026-10-25 : après un import d'offre, on ne pouvait
  // plus changer d'installation sans tout perdre) : les chapitres de la nouvelle installation remplacent les anciens et
  // les lignes y sont reclassées (reclasserDansSections). Sans ligne : chapitres par défaut, comme avant.
  const handleSelectFamily = (f) => {
    const isDeselect = selectedFamily === f;
    const ancienne = selectedFamily;
    setSelectedFamily(isDeselect ? '' : f);
    setSelectedTemplateId(null);
    if (nbLignes === 0) {
      setMetre(null);
      setForm((prev) => ({ ...prev, globalDiscountPercent: '0' }));
      setLines(isDeselect ? [] : buildDefaultSections(f, devisConfig));
      return;
    }
    if (isDeselect) return; // les lignes restent, sous leurs chapitres actuels
    setLines((prev) => reclasserDansSections(prev, buildDefaultSections(f, devisConfig), {
      typeAvant: (titre) => typeChapitre(devisConfig, ancienne, titre),
      typeApres: (titre) => typeChapitre(devisConfig, f, titre),
    }));
  };

  const handleSelectTemplate = (templateId) => {
    const tpl = templates.find((t) => t.id === templateId);
    if (tpl) applyTemplate(tpl);
    else { clearTemplate(); if (selectedFamily) setLines(buildDefaultSections(selectedFamily, devisConfig)); }
  };

  const handleSaveEdition = async (lignes) => {
    const q = devisAModifier.quote;
    setEnregistrement(true);
    try {
      await updateQuote(q.id, {
        subject: form.subject || null, validityDays: parseInt(form.validityDays) || 30, conditions: form.conditions || null,
        commentaire: form.commentaire || null, notesInternes: form.notesInternes || null,
        globalDiscountPercent: parseFloat(form.globalDiscountPercent) || 0,
      });
      await upsertLines(q.id, lignes, parseFloat(form.globalDiscountPercent) || 0);
      if (metre) {
        try { await saveMetre({ ...metre, quoteId: q.id, createdBy: user?.id }); }
        catch (err) { logger.error('[CreateDevisModal] saveMetre', err); toast.warning('Devis enregistré, mais le relevé de métré n\x27a pas pu être enregistré'); }
      }
      toast.success('Devis modifié');
      if (q.pennylane_quote_id) toast.info('Le devis Pennylane n\x27est pas encore à jour : cliquez « Renvoyer dans Pennylane » sur la fiche du devis');
      onCreated?.(q);
      onClose();
    } catch (err) {
      logger.error('[CreateDevisModal] édition', err);
      toast.error(err?.message || 'Erreur lors de l\x27enregistrement du devis');
    } finally { setEnregistrement(false); }
  };

  const handleCreate = async () => {
    if (manques.raison) { toast.error(manques.raison); return; }
    // Article non chargé / supprimé : la ligne garde ses caractéristiques déjà figées, on prévient sans bloquer le devis
    const nonResolues = lignesNonResolues(lines, articles);
    if (nonResolues > 0) toast.warning(`Caractéristiques non actualisées pour ${nonResolues} ligne${nonResolues > 1 ? 's' : ''}`);
    const figees = figerCaracteristiques(lines, articles, canonicalFieldsForCategory);
    if (edition) { await handleSaveEdition(figees); return; }
    try {
      const created = await createQuote({
        orgId,
        leadId: lead?.id || null,
        clientId: lead?.client_id || null,
        interventionId,
        subject: form.subject || null,
        validityDays: parseInt(form.validityDays) || 30,
        conditions: form.conditions || null,
        commentaire: form.commentaire || null,
        notesInternes: form.notesInternes || null,
        globalDiscountPercent: parseFloat(form.globalDiscountPercent) || 0,
        lines: figees,
        createdBy: user?.id,
      });
      // Le devis existe quoi qu'il arrive : l'échec du métré est signalé, jamais avalé
      if (metre) {
        try { await saveMetre({ ...metre, quoteId: created.id, createdBy: user?.id }); }
        catch (err) { logger.error('[CreateDevisModal] saveMetre', err); toast.warning('Devis créé, mais le relevé de métré n\'a pas pu être enregistré'); }
      }
      // Lead sans « Projet » : la famille du devis le renseigne (les anciens leads se remplissent au fil des devis)
      const cleProjet = familleDe(devisConfig, selectedFamily)?.key;
      if (lead?.id && !lead.project_family_key && cleProjet) {
        try { await updateLead(lead.id, { project_family_key: cleProjet }); }
        catch (err) { logger.error('[CreateDevisModal] projet du lead', err); toast.warning('Devis créé, mais le projet du lead n\'a pas pu être renseigné'); }
      }
      toast.success('Devis créé');
      onCreated?.(created);
      onClose();
    } catch (err) {
      logger.error('[CreateDevisModal]', err);
      toast.error(err?.message || 'Erreur lors de la création du devis');
    }
  };

  return (
    <CalqueModal onClose={demanderFermeture} titreId="devis-titre" className="flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl xl:max-w-[min(96vw,100rem)] max-h-[92vh] flex flex-col m-4">
        <div className="flex items-center justify-between px-6 py-3 border-b">
          <h2 id="devis-titre" className="text-lg font-semibold text-secondary-900">{edition ? `Modifier le devis ${devisAModifier.quote.quote_number || ''}` : 'Nouveau devis'}</h2>
          <button type="button" onClick={demanderFermeture} className="p-1 hover:bg-secondary-100 rounded" aria-label="Fermer"><X className="w-5 h-5 text-secondary-500" /></button>
        </div>

        <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 overflow-y-auto px-6 py-5 space-y-5">
          <DevisEntete lead={lead} form={form} setField={setFieldSaisie} selectedFamily={selectedFamily} onSelectFamily={(f) => { setTouche(true); handleSelectFamily(f); }}
            templates={templates} selectedTemplateId={selectedTemplateId} onSelectTemplate={(t) => { setTouche(true); handleSelectTemplate(t); }}
            erreurObjet={erreurObjet} onObjetQuitte={() => setObjetQuitte(true)} familles={famillesActives(devisConfig).map((f) => f.label)} onImportOffre={() => setImportOffre(true)} />
          <DevisStepLines orgId={orgId} lines={lines} setLines={setLinesSaisie} leadId={lead?.id} family={selectedFamily} onMetreValidated={setMetre} devisConfig={devisConfig} importOffreOuvert={importOffre} onFermerImportOffre={() => setImportOffre(false)} articles={articles} />
          {nbLignes > 0 && <DevisConditions form={form} setField={setFieldSaisie} lines={lines} devisConfig={devisConfig} />}
        </div>
        {/* Aperçu du devis tel que le client le recevra (même modèle que le PDF) : à droite sur grand écran */}
        <aside aria-label="Aperçu du devis" className="hidden xl:block w-[32rem] shrink-0 overflow-y-auto border-l border-secondary-200 bg-secondary-100 p-4">
          <p className="mb-2 text-xs font-medium text-secondary-600">Aperçu</p>
          <div style={{ zoom: 0.66 }}><ApercuDevis model={modeleApercu} lecture /></div>
        </aside>
        </div>

        {/* Pied : totaux vivants + action unique */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-t bg-white">
          <div className="text-sm text-secondary-600 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Total HT <b className="text-secondary-900">{formatEuro(totals.total_ht)}</b></span>
            <span>TTC <b className="text-secondary-900 text-base">{formatEuro(totals.total_ttc)}</b></span>
            {marges.visibles && marge.nb > 0 && <span className="text-xs">marge fournitures {formatEuro(marge.marge)} HT · {marge.taux.toFixed(0)} %</span>}
            {marges.peut && (
              <label className="inline-flex items-center gap-1.5 text-xs text-secondary-600">
                <input type="checkbox" checked={marges.visibles} onChange={marges.basculer} className="rounded border-secondary-300" />
                Afficher les marges
              </label>
            )}
            {nbLignes === 0 && <span className="text-xs text-secondary-400">Aucune ligne</span>}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {manques.raison && <span className="text-xs text-st-attente" role="status">{manques.raison}</span>}
            <button type="button" onClick={() => setApercuOuvert(true)} className="btn-secondary xl:hidden inline-flex items-center gap-1.5"><Eye className="w-4 h-4" aria-hidden="true" />Aperçu</button>
            <button type="button" onClick={demanderFermeture} className="btn-secondary">Annuler</button>
            <button type="button" onClick={handleCreate} disabled={isCreating || enregistrement || !!manques.raison} className="btn-primary">
              {(isCreating || enregistrement) && <Loader2 className="w-4 h-4 animate-spin mr-2" />}{edition ? 'Enregistrer les modifications' : 'Créer le devis'}
            </button>
          </div>
        </div>
      </div>

      {apercuOuvert && (
        <CalqueModal onClose={() => setApercuOuvert(false)} z="z-[60]" titreId="apercu-devis-titre">
          <div className="bg-secondary-100 rounded-xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b bg-white rounded-t-xl">
              <h3 id="apercu-devis-titre" className="text-base font-semibold text-secondary-900">Aperçu du devis</h3>
              <button type="button" onClick={() => setApercuOuvert(false)} className="btn-secondary btn-sm">Retour au devis</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4"><ApercuDevis model={modeleApercu} lecture /></div>
          </div>
        </CalqueModal>
      )}

      <ConfirmDialog
        open={confirmerAbandon}
        onOpenChange={setConfirmerAbandon}
        title={edition ? 'Abandonner les modifications ?' : 'Abandonner le devis ?'}
        description={edition ? 'Les modifications non enregistrées seront perdues.' : 'Les lignes saisies seront perdues : le devis n’est pas encore créé.'}
        confirmLabel="Abandonner"
        cancelLabel="Continuer la saisie"
        onConfirm={() => { setConfirmerAbandon(false); onClose(); }}
      />
    </CalqueModal>
  );
}
