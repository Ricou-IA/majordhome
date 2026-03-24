/**
 * CreateDevisModal.jsx — Wizard 3 étapes pour créer un devis
 * ============================================================================
 * Étape 1 : Client + objet (pré-rempli depuis le lead)
 * Étape 2 : Lignes (produits + main d'œuvre)
 * Étape 3 : Récapitulatif (remise, conditions, validité)
 * ============================================================================
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@contexts/AuthContext';
import { useDevisMutations } from '@hooks/useDevis';
import { devisService, QUOTE_TEMPLATE_FAMILIES, buildDefaultSections } from '@services/devis.service';
import DevisStepClient from './DevisStepClient';
import DevisStepLines from './DevisStepLines';
import DevisStepSummary from './DevisStepSummary';
import { X, Loader2, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { toast } from 'sonner';

const STEPS = [
  { id: 0, label: 'Client' },
  { id: 1, label: 'Lignes' },
  { id: 2, label: 'Récapitulatif' },
];

export default function CreateDevisModal({ lead, onClose, onCreated }) {
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const { createQuote, isCreating } = useDevisMutations(lead?.id);

  const [step, setStep] = useState(0);
  const [lines, setLines] = useState([]);
  const [form, setForm] = useState({
    subject: '',
    validityDays: '30',
    conditions: '',
    notesInternes: '',
    globalDiscountPercent: '0',
  });

  // Templates
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedFamily, setSelectedFamily] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);

  useEffect(() => {
    if (!orgId) return;
    setLoadingTemplates(true);
    devisService.getTemplates(orgId).then(({ data }) => {
      setTemplates(data || []);
      setLoadingTemplates(false);
    });
  }, [orgId]);

  const applyTemplate = useCallback((template) => {
    if (!template) return;
    const parsedLines = typeof template.lines === 'string' ? JSON.parse(template.lines) : template.lines;
    setLines(parsedLines || []);
    if (template.global_discount_percent) {
      setForm((prev) => ({ ...prev, globalDiscountPercent: String(template.global_discount_percent) }));
    }
    setSelectedTemplateId(template.id);
    toast.success(`Devis type "${template.name}" chargé`);
  }, []);

  const clearTemplate = useCallback(() => {
    setLines([]);
    setSelectedTemplateId(null);
    setForm((prev) => ({ ...prev, globalDiscountPercent: '0' }));
  }, []);

  const setField = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  // Validation par étape
  const canProceed = () => {
    if (step === 1 && lines.filter((l) => l.line_type !== 'section_title').length === 0) {
      toast.error('Ajoutez au moins une ligne de devis');
      return false;
    }
    return true;
  };

  const handleNext = () => {
    if (!canProceed()) return;
    setStep((s) => Math.min(s + 1, 2));
  };

  const handleBack = () => {
    setStep((s) => Math.max(s - 1, 0));
  };

  const handleCreate = async () => {
    try {
      const result = await createQuote({
        orgId,
        leadId: lead?.id || null,
        clientId: lead?.client_id || null,
        subject: form.subject || null,
        validityDays: parseInt(form.validityDays) || 30,
        conditions: form.conditions || null,
        notesInternes: form.notesInternes || null,
        globalDiscountPercent: parseFloat(form.globalDiscountPercent) || 0,
        lines,
        createdBy: user?.id,
      });

      if (result?.error) throw result.error;

      toast.success('Devis créé');
      onCreated?.(result?.data);
      onClose();
    } catch (err) {
      console.error('[CreateDevisModal]', err);
      toast.error(err?.message || 'Erreur lors de la création du devis');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-secondary-900">Nouveau devis</h2>
          <button onClick={onClose} className="p-1 hover:bg-secondary-100 rounded">
            <X className="w-5 h-5 text-secondary-500" />
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-2 px-6 py-3 border-b bg-secondary-50">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              {i > 0 && <div className="w-8 h-px bg-secondary-300" />}
              <div className={`flex items-center gap-1.5 text-sm ${
                step === s.id ? 'text-primary-600 font-medium' :
                step > s.id ? 'text-green-600' : 'text-secondary-400'
              }`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                  step === s.id ? 'bg-primary-100 text-primary-700' :
                  step > s.id ? 'bg-green-100 text-green-700' : 'bg-secondary-200 text-secondary-500'
                }`}>
                  {step > s.id ? <Check className="w-3.5 h-3.5" /> : s.id + 1}
                </div>
                <span className="hidden sm:inline">{s.label}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 0 && (
            <div className="space-y-6">
              {/* Famille de produit */}
              <div>
                <label className="block text-sm font-medium text-secondary-700 mb-1.5">Installation</label>
                <div className="flex flex-wrap gap-2">
                  {QUOTE_TEMPLATE_FAMILIES.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => {
                        const isDeselect = selectedFamily === f;
                        setSelectedFamily(isDeselect ? '' : f);
                        if (selectedTemplateId) clearTemplate();
                        // Auto-créer les sections par défaut si on sélectionne une famille
                        if (!isDeselect) {
                          setLines(buildDefaultSections(f));
                          setSelectedTemplateId(null);
                        } else {
                          setLines([]);
                        }
                      }}
                      className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                        selectedFamily === f
                          ? 'bg-primary-100 border-primary-400 text-primary-800 font-medium'
                          : 'bg-white border-secondary-200 text-secondary-600 hover:border-primary-300 hover:bg-primary-50/50'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Devis type — select filtré par famille */}
              {selectedFamily && (() => {
                const familyTemplates = templates.filter((t) => t.family === selectedFamily);
                return (
                  <div>
                    <label className="block text-sm font-medium text-secondary-700 mb-1.5">Devis type</label>
                    <select
                      value={selectedTemplateId || ''}
                      onChange={(e) => {
                        const tpl = templates.find((t) => t.id === e.target.value);
                        if (tpl) applyTemplate(tpl);
                        else clearTemplate();
                      }}
                      className="w-full px-3 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    >
                      <option value="">— Aucun (devis vierge) —</option>
                      {familyTemplates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}{t.description ? ` — ${t.description}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })()}

              <DevisStepClient lead={lead} form={form} setField={setField} />
            </div>
          )}
          {step === 1 && (
            <DevisStepLines
              orgId={orgId}
              lines={lines}
              setLines={setLines}
              globalDiscountPercent={parseFloat(form.globalDiscountPercent) || 0}
            />
          )}
          {step === 2 && (
            <DevisStepSummary form={form} setField={setField} lines={lines} />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t bg-white">
          <button
            type="button"
            onClick={step === 0 ? onClose : handleBack}
            className="btn-secondary"
          >
            {step === 0 ? 'Annuler' : (
              <><ChevronLeft className="w-4 h-4 mr-1" /> Précédent</>
            )}
          </button>

          {step < 2 ? (
            <button type="button" onClick={handleNext} className="btn-primary">
              Suivant <ChevronRight className="w-4 h-4 ml-1" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCreate}
              disabled={isCreating}
              className="btn-primary"
            >
              {isCreating && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Créer le devis
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
