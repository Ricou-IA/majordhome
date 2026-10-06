// src/apps/artisan/pages/settings/DevisSettings.jsx
// Settings → Socle → Devis (/settings/devis) : familles et chapitres, contenu, paiement, affichage, avec
// l'aperçu du document à droite (même modèle que le PDF : src/lib/devisDocumentModel.js). ⚠ merge JSONB
// niveau 1 → on sauve l'objet `devis` COMPLET. Spec 2026-10-06-parametrage-devis-modele-document-design.md.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Download, Loader2 } from 'lucide-react';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { computeQuoteTotals } from '@services/devis.service';
import { buildCompanyInfo } from '@lib/orgBranding';
import { downloadBlob } from '@/lib/utils';
import { buildDevisConfig, validerDevisConfig } from '@/lib/devisConfig.js';
import { buildDevisDocumentModel, exempleDevis, ZONES } from '@/lib/devisDocumentModel.js';
import { invoicingSettings } from '@/lib/invoiceDocumentModel.js';
import SettingsPage from './SettingsPage';
import ReglagesDevisPanel from './devis/ReglagesDevisPanel';
import ApercuDevis from './devis/ApercuDevis';

/** Config → état du formulaire (les nombres deviennent des chaînes pour la saisie). */
const depuisConfig = (c) => ({
  familles: c.familles.map((f) => ({ ...f, sections: [...f.sections] })),
  document: { ...c.document, validite_jours: String(c.document.validite_jours) },
  paiement: { ...c.paiement },
  affichage: { ...c.affichage },
});

/** Formulaire → objet `devis` à sauver (complet). */
const versSettings = (form) => ({
  familles: form.familles.map((f) => ({ ...f, label: f.label.trim(), sections: f.sections.map((s) => s.trim()).filter(Boolean) })),
  document: { ...form.document, validite_jours: Number(form.document.validite_jours) },
  paiement: { ...form.paiement },
  affichage: { ...form.affichage },
});

const OUVERTS_INITIAUX = { familles: true, emetteur: false, contenu: false, paiement: false, affichage: false };

export default function DevisSettings() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const [form, setForm] = useState(() => depuisConfig(buildDevisConfig(null)));
  const [initial, setInitial] = useState(() => depuisConfig(buildDevisConfig(null)));
  useEffect(() => { const f = depuisConfig(buildDevisConfig(settings)); setForm(f); setInitial(f); }, [settings]);

  const [ouverts, setOuverts] = useState(OUVERTS_INITIAUX);
  const [zoneActive, setZoneActive] = useState(null);
  const [pdfEnCours, setPdfEnCours] = useState(false);

  const company = useMemo(() => buildCompanyInfo(settings), [settings]);
  const invoicing = useMemo(() => invoicingSettings(settings), [settings]);
  // Config « telle que saisie » : l'aperçu suit chaque frappe, avant même la sauvegarde
  const configSaisie = useMemo(() => buildDevisConfig({ devis: versSettings(form) }), [form]);
  const validation = useMemo(() => validerDevisConfig(versSettings(form)), [form]);
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);

  const exemple = useMemo(() => exempleDevis(configSaisie), [configSaisie]);
  const model = useMemo(() => buildDevisDocumentModel({
    quote: exemple.quote, lines: exemple.lines, totals: computeQuoteTotals(exemple.lines, 0), company, config: configSaisie, invoicing,
  }), [exemple, company, configSaisie, invoicing]);

  const onChange = useCallback((groupe, cle, valeur) => setForm((f) => ({ ...f, [groupe]: { ...f[groupe], [cle]: valeur } })), []);
  const onFamilles = useCallback((familles) => setForm((f) => ({ ...f, familles })), []);
  const onToggle = (k) => setOuverts((o) => ({ ...o, [k]: !o[k] }));

  // Clic sur une zone de l'aperçu : ouvrir l'accordéon et surligner le champ (le focus est pris par le champ)
  const onZoneClick = useCallback((id) => {
    const z = ZONES.find((x) => x.id === id);
    if (!z?.accordeon) return;
    setOuverts((o) => ({ ...o, [z.accordeon]: true }));
    setZoneActive(id);
  }, []);

  const handleSave = async () => {
    if (!validation.ok) { toast.error(validation.erreurs[0]); return; }
    try {
      await save({ devis: versSettings(form) });
      toast.success('Modèle de devis enregistré');
      setInitial(form);
    } catch (err) { toast.error(err.message || "Erreur lors de l'enregistrement"); }
  };

  const handlePdf = async () => {
    try {
      setPdfEnCours(true);
      const { generateDevisPdfBlob } = await import('@apps/artisan/components/devis/DevisPDF');
      const blob = await generateDevisPdfBlob(model);
      downloadBlob(blob, 'devis-exemple.pdf');
    } catch (err) { toast.error(err?.message || 'PDF impossible'); } finally { setPdfEnCours(false); }
  };

  return (
    <SettingsPage title="Devis" description="Familles d’installation, chapitres, mentions et affichage de vos devis. Cliquez une zone du document pour trouver son réglage.">
      {isLoading ? <div className="card text-sm text-secondary-500">Chargement…</div> : (
        <div className="grid gap-6 xl:grid-cols-[440px_minmax(0,1fr)] items-start">
          <div className="space-y-3">
            <ReglagesDevisPanel form={form} onChange={onChange} onFamilles={onFamilles} ouverts={ouverts} onToggle={onToggle}
              zoneActive={zoneActive} onFocusZone={setZoneActive} company={company} invoicing={invoicing} />
            {!validation.ok && (
              <ul className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2 list-disc pl-6">{validation.erreurs.map((e) => <li key={e}>{e}</li>)}</ul>
            )}
            <div className="flex items-center justify-between gap-3 sticky bottom-0 bg-secondary-50/95 backdrop-blur py-2">
              <button type="button" onClick={handlePdf} disabled={pdfEnCours} className="btn-secondary text-sm flex items-center gap-2">
                {pdfEnCours ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} PDF d’exemple
              </button>
              <button type="button" onClick={handleSave} disabled={!isDirty || !validation.ok || isSaving} className="btn-primary">{isSaving ? 'Enregistrement…' : 'Enregistrer le modèle'}</button>
            </div>
          </div>
          <div className="bg-secondary-100 rounded-xl p-4 xl:p-8 overflow-auto" onClick={(e) => { if (e.target === e.currentTarget) setZoneActive(null); }}>
            <ApercuDevis model={model} zoneActive={zoneActive} onZoneClick={onZoneClick} />
          </div>
        </div>
      )}
    </SettingsPage>
  );
}
