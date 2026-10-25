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
import { buildDevisConfig, famillesActives, familleDepuisEquipement } from '@/lib/devisConfig.js';
import { useDevisMutations } from '@hooks/useDevis';
import { useFumMetreMutations } from '@hooks/useFumisterie';
import { devisService, buildDefaultSections, computeQuoteTotals, margeFournitures } from '@services/devis.service';
import { logger } from '@lib/logger';
import { formatEuro } from '@/lib/utils';
import DevisEntete from './DevisEntete';
import DevisStepLines from './DevisStepLines';
import DevisConditions from './DevisConditions';
import { X, Loader2 } from 'lucide-react';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { toast } from 'sonner';

/**
 * @param {object} p
 * @param {object} p.lead
 * @param {Array<object>} [p.initialLines] lignes pré-remplies (ex. dimensionnement clim /clim) — sections comprises
 * @param {string} [p.initialFamily] famille d'installation pré-sélectionnée (QUOTE_TEMPLATE_FAMILIES)
 * @param {{ quote: object, lines: object[] }} [p.devisAModifier] devis existant à modifier (mode édition)
 */
export default function CreateDevisModal({ lead, onClose, onCreated, initialLines = null, initialFamily = '', devisAModifier = null }) {
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const { createQuote, isCreating, updateQuote, upsertLines } = useDevisMutations(lead?.id);
  const edition = !!devisAModifier?.quote;
  const [enregistrement, setEnregistrement] = useState(false);
  const { saveMetre } = useFumMetreMutations(orgId);
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

  // Installation présélectionnée depuis l'équipement concerné du lead (une seule fois, réglages de l'org chargés),
  // seulement pour un nouveau devis vide : ni en édition, ni par-dessus des lignes déjà là (clim, devis type).
  const familleAutoFaite = useRef(false);
  useEffect(() => {
    if (familleAutoFaite.current || settingsLoading || edition || initialFamily || lines.length > 0) return;
    familleAutoFaite.current = true;
    const f = familleDepuisEquipement(devisConfig, lead?.equipment_type_label);
    if (f) { setSelectedFamily(f); setLines(buildDefaultSections(f, devisConfig)); }
  }, [settingsLoading, edition, initialFamily, lines.length, devisConfig, lead?.equipment_type_label]);

  useEffect(() => {
    if (!orgId) return;
    devisService.getTemplates(orgId).then(({ data }) => setTemplates(data || []));
  }, [orgId]);

  const nbLignes = useMemo(() => lines.filter((l) => l.line_type !== 'section_title').length, [lines]);
  const totals = useMemo(() => computeQuoteTotals(lines, form.globalDiscountPercent), [lines, form.globalDiscountPercent]);
  const marge = useMemo(() => margeFournitures(lines), [lines]);

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

  // Changer d'installation remplace les sections : on ne jette pas des lignes saisies sans prévenir
  // (modale de l'app, pas le dialogue système).
  const [familleEnAttente, setFamilleEnAttente] = useState(null);
  const appliquerFamille = (f) => {
    const isDeselect = selectedFamily === f;
    setFamilleEnAttente(null);
    setSelectedFamily(isDeselect ? '' : f);
    setSelectedTemplateId(null);
    setMetre(null);
    setForm((prev) => ({ ...prev, globalDiscountPercent: '0' }));
    setLines(isDeselect ? [] : buildDefaultSections(f, devisConfig));
  };
  const handleSelectFamily = (f) => { if (nbLignes > 0) setFamilleEnAttente(f); else appliquerFamille(f); };

  const handleSelectTemplate = (templateId) => {
    const tpl = templates.find((t) => t.id === templateId);
    if (tpl) applyTemplate(tpl);
    else { clearTemplate(); if (selectedFamily) setLines(buildDefaultSections(selectedFamily, devisConfig)); }
  };

  const handleSaveEdition = async () => {
    const q = devisAModifier.quote;
    setEnregistrement(true);
    try {
      await updateQuote(q.id, {
        subject: form.subject || null, validityDays: parseInt(form.validityDays) || 30, conditions: form.conditions || null,
        commentaire: form.commentaire || null, notesInternes: form.notesInternes || null,
        globalDiscountPercent: parseFloat(form.globalDiscountPercent) || 0,
      });
      await upsertLines(q.id, lines, parseFloat(form.globalDiscountPercent) || 0);
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
    if (nbLignes === 0) { toast.error('Ajoutez au moins une ligne de devis'); return; }
    if (edition) { await handleSaveEdition(); return; }
    try {
      const created = await createQuote({
        orgId,
        leadId: lead?.id || null,
        clientId: lead?.client_id || null,
        subject: form.subject || null,
        validityDays: parseInt(form.validityDays) || 30,
        conditions: form.conditions || null,
        commentaire: form.commentaire || null,
        notesInternes: form.notesInternes || null,
        globalDiscountPercent: parseFloat(form.globalDiscountPercent) || 0,
        lines,
        createdBy: user?.id,
      });
      // Le devis existe quoi qu'il arrive : l'échec du métré est signalé, jamais avalé
      if (metre) {
        try { await saveMetre({ ...metre, quoteId: created.id, createdBy: user?.id }); }
        catch (err) { logger.error('[CreateDevisModal] saveMetre', err); toast.warning('Devis créé, mais le relevé de métré n\'a pas pu être enregistré'); }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col m-4">
        <div className="flex items-center justify-between px-6 py-3 border-b">
          <h2 className="text-lg font-semibold text-secondary-900">{edition ? `Modifier le devis ${devisAModifier.quote.quote_number || ''}` : 'Nouveau devis'}</h2>
          <button onClick={onClose} className="p-1 hover:bg-secondary-100 rounded" aria-label="Fermer"><X className="w-5 h-5 text-secondary-500" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <DevisEntete lead={lead} form={form} setField={setField} selectedFamily={selectedFamily} onSelectFamily={handleSelectFamily}
            templates={templates} selectedTemplateId={selectedTemplateId} onSelectTemplate={handleSelectTemplate} familles={famillesActives(devisConfig).map((f) => f.label)} />
          <DevisStepLines orgId={orgId} lines={lines} setLines={setLines} leadId={lead?.id} family={selectedFamily} onMetreValidated={setMetre} devisConfig={devisConfig} />
          {nbLignes > 0 && <DevisConditions form={form} setField={setField} lines={lines} devisConfig={devisConfig} />}
        </div>

        {/* Pied : totaux vivants + action unique */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-t bg-white">
          <div className="text-sm text-secondary-600 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Total HT <b className="text-secondary-900">{formatEuro(totals.total_ht)}</b></span>
            <span>TTC <b className="text-secondary-900 text-base">{formatEuro(totals.total_ttc)}</b></span>
            {marge.nb > 0 && <span className="text-xs">marge fournitures {formatEuro(marge.marge)} HT · {marge.taux.toFixed(0)} %</span>}
            {nbLignes === 0 && <span className="text-xs text-secondary-400">Aucune ligne</span>}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
            <button type="button" onClick={handleCreate} disabled={isCreating || enregistrement || nbLignes === 0} className="btn-primary">
              {(isCreating || enregistrement) && <Loader2 className="w-4 h-4 animate-spin mr-2" />}{edition ? 'Enregistrer les modifications' : 'Créer le devis'}
            </button>
          </div>
        </div>
      </div>
      <ConfirmDialog open={familleEnAttente != null} onOpenChange={(o) => { if (!o) setFamilleEnAttente(null); }} title="Changer d'installation ?"
        description={`Les sections seront remplacées et les ${nbLignes} ligne${nbLignes > 1 ? 's' : ''} déjà saisie${nbLignes > 1 ? 's' : ''} seront supprimées.`}
        confirmLabel="Remplacer" cancelLabel="Garder mes lignes" onConfirm={() => appliquerFamille(familleEnAttente)} />
    </div>
  );
}
