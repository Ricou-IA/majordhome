// Placeholder - To be implemented with full Leads functionality
// This is a simplified version that will be completed
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { Button } from '@components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { Plus } from 'lucide-react';

// Helper to get role from membership
const getRole = (membership) => {
  if (!membership) return null;
  return membership.role === 'org_admin' ? 'Admin' : 'Commercial';
};

// Helper to get profile for dashboard
const getProfileForDashboard = (profile, membership) => {
  if (!profile) return null;
  const role = getRole(membership);
  return {
    id: profile.id || profile.user_id,
    role: role || 'Commercial',
  };
};

export default function PipelineLeads() {
  const navigate = useNavigate();
  const { profile, membership, loading: authLoading } = useAuth();
  const dashboardProfile = getProfileForDashboard(profile, membership);

  if (authLoading || !dashboardProfile) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/4"></div>
          <div className="h-96 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">Leads</h1>
          <p className="text-muted-foreground">
            Gérez et suivez vos opportunités commerciales
          </p>
        </div>
        <Button onClick={() => navigate('/pipeline/leads/new')}>
          <Plus className="mr-2 h-4 w-4" />
          Nouveau Lead
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Liste des leads</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            Cette page sera complétée avec la liste complète des leads, les filtres et la recherche.
            <br />
            <Button
              variant="link"
              onClick={() => navigate('/pipeline/leads/new')}
              className="mt-4"
            >
              Créer votre premier lead
            </Button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
