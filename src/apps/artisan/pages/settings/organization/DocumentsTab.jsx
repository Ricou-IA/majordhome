// Settings → Organisation → Documents : qualifications RGE et documents de l'entreprise
// (certifications, attestation de capacité fluides, attestation d'assurance), lus par l'IA au dépôt.
// Qualifications : lues sur les certificats déposés dès qu'il y en a un (resolveRgeCertifications),
// sinon saisie manuelle historique `rge_certifications` (repli pour une org sans dépôt).
import { useMemo } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { storageService } from '@services/storage.service';
import {
  COMPANY_DOCUMENT_KINDS, normalizeCompanyDocuments, removedDocumentPaths, qualificationsFromDocuments,
} from '@/lib/companyDocuments';
import RgeCertificationsInput from './components/RgeCertificationsInput';
import { CompanyDocumentDropZone, COMPANY_DOCUMENTS_BUCKET } from './components/CompanyDocumentDropZone';
import { useSettingsForm } from './components/useSettingsForm';
import { SaveBar, SettingsLoading, SettingsSection, SettingsSurface } from './components/layout';

function pickDocumentFields(settings) {
  return {
    rge_certifications: Array.isArray(settings.rge_certifications) ? settings.rge_certifications : [],
    company_documents: normalizeCompanyDocuments(settings.company_documents),
  };
}

export default function DocumentsTab() {
  const { organization } = useAuth();
  const { form, setForm, initial, setInitial, isDirty, save, isSaving, isLoading } = useSettingsForm(pickDocumentFields);
  const qualifications = useMemo(() => qualificationsFromDocuments(form.company_documents), [form.company_documents]);
  const hasCertificates = form.company_documents.certifications.length > 0;

  const handleSave = async () => {
    try {
      await save(form);
      toast.success('Documents enregistrés');
      // Documents retirés ou remplacés : purge du Storage une fois l'enregistrement acquis.
      const removed = removedDocumentPaths(initial.company_documents, form.company_documents);
      if (removed.length) {
        const { error } = await storageService.deleteFiles(COMPANY_DOCUMENTS_BUCKET, removed);
        if (error) toast.warning(`Ancien(s) fichier(s) non supprimé(s) du stockage : ${error.message}`);
      }
      setInitial(form);
    } catch (err) {
      toast.error(err.message || 'Erreur lors de l’enregistrement');
    }
  };

  const handleReset = () => {
    // Fichiers déposés puis abandonnés : jamais référencés, on les retire du Storage.
    const abandoned = removedDocumentPaths(form.company_documents, initial.company_documents);
    if (abandoned.length) storageService.deleteFiles(COMPANY_DOCUMENTS_BUCKET, abandoned);
    setForm(initial);
  };

  const setKind = (key) => (fn) => setForm((f) => ({
    ...f,
    company_documents: { ...f.company_documents, [key]: fn(f.company_documents[key] || []) },
  }));

  if (isLoading) return <SettingsLoading />;

  return (
    <>
      <SettingsSurface>
        <SettingsSection
          title="Qualifications RGE"
          description={hasCertificates
            ? 'Lues sur vos certificats (expirés exclus). Elles figurent sur vos certificats, factures et études.'
            : 'Figurent sur vos certificats, factures et études. Déposez vos certificats ci-dessous pour qu’elles soient lues automatiquement, numéro compris.'}
        >
          {hasCertificates ? (
            qualifications.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {qualifications.map((q) => (
                  <li key={q} className="px-2.5 py-1 rounded-md bg-secondary-100 text-secondary-800 text-sm">{q}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-amber-800">Aucune qualification valide : complétez l’intitulé des certificats ou vérifiez leur date de validité.</p>
            )
          ) : (
            <RgeCertificationsInput
              value={form.rge_certifications}
              onChange={(list) => setForm((f) => ({ ...f, rge_certifications: list }))}
            />
          )}
        </SettingsSection>

        {COMPANY_DOCUMENT_KINDS.map((kind) => (
          <SettingsSection key={kind.key} title={kind.label} description={kind.hint} optional={kind.key !== 'certifications'}>
            <CompanyDocumentDropZone
              kind={kind}
              orgId={organization?.id}
              docs={form.company_documents[kind.key] || []}
              onChange={setKind(kind.key)}
            />
          </SettingsSection>
        ))}
      </SettingsSurface>

      <SaveBar isDirty={isDirty} isValid isSaving={isSaving} onSave={handleSave} onReset={handleReset} />
    </>
  );
}
