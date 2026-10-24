// src/apps/artisan/pages/settings/organization/components/CompanyDocumentDropZone.jsx
// Documents de l'entreprise (certifications, attestation fluides, attestation d'assurance) :
// zones de dépôt org-scopées dans le bucket product-documents. Chaque dépôt est lu par l'IA
// (edge company-document-extract) : intitulé / numéro / organisme / fin de validité pré-remplis,
// modifiables. La liste est portée par le formulaire parent (settings.company_documents) — le
// Storage n'est purgé qu'à l'Enregistrement (ou à l'Annulation pour un fichier abandonné),
// cf. IdentityTab. `onChange` reçoit une fonction (docs précédents → docs suivants) : la lecture
// IA revient après coup et ne doit pas écraser ce qui a été saisi entre-temps.
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Upload, Trash2, Loader2, FileText, ExternalLink, Sparkles, RotateCw } from 'lucide-react';
import { storageService } from '@services/storage.service';
import { companyDocumentsService } from '@services/companyDocuments.service';
import {
  COMPANY_DOCUMENT_MIME_TYPES, COMPANY_DOCUMENT_MAX_BYTES,
  buildCompanyDocumentPath, expiryStatus, applyExtraction,
} from '@/lib/companyDocuments';

export const COMPANY_DOCUMENTS_BUCKET = 'product-documents';

const FIELD_CLASS = 'w-full px-2 py-1 border border-secondary-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary-500';

const BADGES = {
  soon: { label: 'Expire bientôt', className: 'bg-amber-100 text-amber-800' },
  expired: { label: 'Expiré', className: 'bg-secondary-800 text-white' },
};

function ReadStatus({ status, reading, onRetry }) {
  if (reading) {
    return <span className="text-xs text-secondary-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Lecture du document…</span>;
  }
  if (status === 'ok') {
    return <span className="text-xs text-secondary-500 flex items-center gap-1"><Sparkles className="w-3 h-3" /> Lu automatiquement — à vérifier</span>;
  }
  const label = status === 'illisible' ? 'Document non reconnu — à compléter' : status === 'echec' ? 'Lecture en échec — à compléter' : 'Jamais lu';
  return (
    <span className="text-xs text-amber-800 flex items-center gap-2">
      {label}
      <button type="button" onClick={onRetry} className="flex items-center gap-1 text-primary-700 hover:underline">
        <RotateCw className="w-3 h-3" /> Relire
      </button>
    </span>
  );
}

function DocumentRow({ kind, doc, reading, onOpen, onRemove, onPatch, onRetry }) {
  const badge = BADGES[expiryStatus(doc.valid_until)];
  return (
    <li className="py-3 space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" onClick={() => onOpen(doc.path)} className="flex items-center gap-2 text-sm text-primary-700 hover:underline min-w-0">
          <FileText className="w-4 h-4 shrink-0" />
          <span className="truncate max-w-[16rem]">{doc.name}</span>
          <ExternalLink className="w-3 h-3 shrink-0" />
        </button>
        <ReadStatus status={doc.read_status} reading={reading} onRetry={onRetry} />
        {badge && <span className={`text-xs px-2 py-0.5 rounded-full ${badge.className}`}>{badge.label}</span>}
        <button type="button" onClick={onRemove} title="Retirer" className="ml-auto text-secondary-400 hover:text-secondary-800">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {['intitule', 'numero', 'organisme'].map((field) => (
          <label key={field} className="text-xs text-secondary-500">
            {kind.fields[field]}
            <input
              type="text"
              value={doc[field]}
              maxLength={120}
              disabled={reading}
              onChange={(e) => onPatch({ [field]: e.target.value })}
              className={FIELD_CLASS}
            />
          </label>
        ))}
        <label className="text-xs text-secondary-500">
          Valide jusqu’au
          <input
            type="date"
            value={doc.valid_until || ''}
            disabled={reading}
            onChange={(e) => onPatch({ valid_until: e.target.value || null })}
            className={FIELD_CLASS}
          />
        </label>
      </div>
    </li>
  );
}

export function CompanyDocumentDropZone({ kind, orgId, docs, onChange }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState(() => new Set());

  const patchDoc = (path, fn) => onChange((prev) => prev.map((d) => (d.path === path ? fn(d) : d)));

  const read = async (path) => {
    setReading((s) => new Set(s).add(path));
    const { data, error } = await companyDocumentsService.extract(orgId, kind.key, path);
    setReading((s) => { const n = new Set(s); n.delete(path); return n; });
    if (error) toast.error(`Lecture automatique impossible : ${error.message}`);
    patchDoc(path, (d) => applyExtraction(d, error ? null : data));
  };

  const upload = async (files) => {
    const list = Array.from(files || []);
    if (!list.length || !orgId) return;
    const accepted = kind.multiple ? list : list.slice(0, 1);
    const added = [];
    setBusy(true);
    for (const file of accepted) {
      if (!COMPANY_DOCUMENT_MIME_TYPES.includes(file.type)) { toast.error(`${file.name} : format non accepté (PDF, JPG ou PNG)`); continue; }
      if (file.size > COMPANY_DOCUMENT_MAX_BYTES) { toast.error(`${file.name} : fichier trop lourd (5 Mo maximum)`); continue; }
      const target = buildCompanyDocumentPath(orgId, kind.key, file.name);
      const { path, error } = await storageService.uploadFile(COMPANY_DOCUMENTS_BUCKET, target, file, { contentType: file.type });
      if (error || !path) { toast.error(`${file.name} : échec de l'upload (${error?.message ?? 'erreur inconnue'})`); continue; }
      added.push({ path, name: file.name, valid_until: null, intitule: '', numero: '', organisme: '', read_status: null });
    }
    setBusy(false);
    if (!added.length) return;
    onChange((prev) => (kind.multiple ? [...prev, ...added] : added));
    toast.success(`${added.length > 1 ? `${added.length} documents déposés` : 'Document déposé'} — ne pas oublier d’Enregistrer`);
    added.forEach((d) => read(d.path));
  };

  const open = async (path) => {
    const win = window.open('', '_blank');
    const { url, error } = await storageService.getSignedUrl(COMPANY_DOCUMENTS_BUCKET, path);
    if (error || !url) { win?.close(); toast.error('Document introuvable'); return; }
    if (win) win.location.href = url; else window.location.href = url;
  };

  const showZone = kind.multiple || docs.length === 0;

  return (
    <div>
      {docs.length > 0 && (
        <ul className="divide-y divide-secondary-100 mb-3 rounded-lg border border-secondary-200 px-3">
          {docs.map((doc) => (
            <DocumentRow
              key={doc.path}
              kind={kind}
              doc={doc}
              reading={reading.has(doc.path)}
              onOpen={open}
              onRemove={() => onChange((prev) => prev.filter((d) => d.path !== doc.path))}
              onPatch={(patch) => patchDoc(doc.path, (d) => ({ ...d, ...patch }))}
              onRetry={() => read(doc.path)}
            />
          ))}
        </ul>
      )}
      <input
        ref={fileRef}
        type="file"
        accept={COMPANY_DOCUMENT_MIME_TYPES.join(',')}
        multiple={kind.multiple}
        className="hidden"
        onChange={(e) => { upload(e.target.files); e.target.value = ''; }}
      />
      {showZone ? (
        <button
          type="button"
          disabled={busy || !orgId}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}
          className={`w-full border-2 border-dashed rounded-md px-4 py-5 flex items-center justify-center gap-2 text-sm transition-colors disabled:opacity-50 ${over ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-secondary-300 text-secondary-500 hover:border-secondary-400'}`}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          Déposer {kind.multiple ? 'des fichiers' : 'le fichier'} ici ou cliquer — PDF, JPG ou PNG, 5 Mo maximum
        </button>
      ) : (
        <button type="button" disabled={busy || !orgId} onClick={() => fileRef.current?.click()} className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Remplacer
        </button>
      )}
    </div>
  );
}
