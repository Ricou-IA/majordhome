// Placeholder - To be implemented with full LeadDetail functionality
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { Button } from '@components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { ArrowLeft } from 'lucide-react';

export default function PipelineLeadDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { loading: authLoading } = useAuth();

  if (authLoading) {
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
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" onClick={() => navigate('/pipeline/leads')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Détail du Lead</h1>
          <p className="text-muted-foreground">ID: {id}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Informations du lead</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            Cette page sera complétée avec les détails complets du lead, les actions, les notes, etc.
            <br />
            <Button variant="outline" onClick={() => navigate('/pipeline/leads')} className="mt-4">
              Retour à la liste
            </Button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
