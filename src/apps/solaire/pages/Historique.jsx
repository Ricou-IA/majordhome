// src/apps/solaire/pages/Historique.jsx
// Historique des simulations PV du commercial (org_admin : toutes).
import { useNavigate } from 'react-router-dom';
import { Sun } from 'lucide-react';

export default function Historique() {
  const navigate = useNavigate();
  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Historique des simulations</h1>
          <p className="text-secondary-600 text-sm">Rechargez une simulation à l'identique</p>
        </div>
        <button
          onClick={() => navigate('/solaire')}
          className="btn-primary flex items-center gap-1.5"
        >
          <Sun className="w-4 h-4" /> Nouvelle simulation
        </button>
      </div>
      <div className="card text-sm text-secondary-500">Liste — en construction (Task G5)</div>
    </div>
  );
}
