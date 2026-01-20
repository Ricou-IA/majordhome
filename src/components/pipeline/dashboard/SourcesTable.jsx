import { Button } from '@components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@components/ui/table';
import { Download } from 'lucide-react';
import { toast } from 'sonner';

export const SourcesTable = ({ sourceMetrics, isAdmin }) => {
  const exportToCSV = () => {
    if (sourceMetrics.length === 0) {
      toast.error('Aucune donnée à exporter');
      return;
    }

    const headers = isAdmin
      ? [
          'Source',
          'Leads',
          'Rendez-vous',
          'Ventes',
          'CA HT (€)',
          'Dépenses (€)',
          'CPL (€)',
          'CPRDV (€)',
          'CPVente (€)',
          'ROI (%)',
        ]
      : ['Source', 'Leads', 'Rendez-vous', 'Ventes', 'CA HT (€)'];

    const rows = sourceMetrics.map((metric) =>
      isAdmin
        ? [
            metric.sourceName,
            metric.leads,
            metric.appointments,
            metric.sales,
            metric.revenue.toFixed(2),
            metric.expenses.toFixed(2),
            metric.cpl.toFixed(2),
            metric.cpAppointment.toFixed(2),
            metric.cpSale.toFixed(2),
            metric.roi.toFixed(2),
          ]
        : [metric.sourceName, metric.leads, metric.appointments, metric.sales, metric.revenue.toFixed(2)]
    );

    const csvContent = [headers.join(';'), ...rows.map((row) => row.join(';'))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `sources-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast.success('Export CSV réussi');
  };

  if (sourceMetrics.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Comparatif par source</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            Aucune donnée disponible pour la période sélectionnée
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <CardTitle className="text-base sm:text-lg">Comparatif par source</CardTitle>
        <Button onClick={exportToCSV} size="sm" variant="outline" className="w-full sm:w-auto">
          <Download className="h-4 w-4 mr-2" />
          Exporter CSV
        </Button>
      </CardHeader>
      <CardContent className="p-0 sm:p-6">
        {/* Mobile: Card view */}
        <div className="block sm:hidden space-y-3 p-4">
          {sourceMetrics.map((metric) => (
            <div key={metric.sourceId} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{metric.sourceName}</span>
                {isAdmin && (
                  <span
                    className={`text-sm font-medium ${metric.roi >= 0 ? 'text-success' : 'text-destructive'}`}
                  >
                    ROI: {metric.roi.toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="text-center">
                  <p className="text-muted-foreground text-xs">Leads</p>
                  <p className="font-medium">{metric.leads}</p>
                </div>
                <div className="text-center">
                  <p className="text-muted-foreground text-xs">RDV</p>
                  <p className="font-medium">{metric.appointments}</p>
                </div>
                <div className="text-center">
                  <p className="text-muted-foreground text-xs">Ventes</p>
                  <p className="font-medium">{metric.sales}</p>
                </div>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t">
                <span className="text-muted-foreground">CA HT</span>
                <span className="font-medium">{metric.revenue.toLocaleString('fr-FR')} €</span>
              </div>
              {isAdmin && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Dépenses</span>
                    <span>{metric.expenses.toLocaleString('fr-FR')} €</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">CPL</span>
                    <span>{metric.cpl.toFixed(2)} €</span>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Desktop: Table view */}
        <div className="hidden sm:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">RDV</TableHead>
                <TableHead className="text-right">Ventes</TableHead>
                <TableHead className="text-right">CA HT</TableHead>
                {isAdmin && (
                  <>
                    <TableHead className="text-right">Dépenses</TableHead>
                    <TableHead className="text-right hidden lg:table-cell">CPL</TableHead>
                    <TableHead className="text-right hidden xl:table-cell">CPRDV</TableHead>
                    <TableHead className="text-right hidden xl:table-cell">CPVente</TableHead>
                    <TableHead className="text-right">ROI</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sourceMetrics.map((metric) => (
                <TableRow key={metric.sourceId}>
                  <TableCell className="font-medium whitespace-nowrap">{metric.sourceName}</TableCell>
                  <TableCell className="text-right">{metric.leads}</TableCell>
                  <TableCell className="text-right">{metric.appointments}</TableCell>
                  <TableCell className="text-right">{metric.sales}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {metric.revenue.toLocaleString('fr-FR')} €
                  </TableCell>
                  {isAdmin && (
                    <>
                      <TableCell className="text-right whitespace-nowrap">
                        {metric.expenses.toLocaleString('fr-FR')} €
                      </TableCell>
                      <TableCell className="text-right hidden lg:table-cell">
                        {metric.cpl.toFixed(2)} €
                      </TableCell>
                      <TableCell className="text-right hidden xl:table-cell">
                        {metric.cpAppointment > 0 ? `${metric.cpAppointment.toFixed(2)} €` : '-'}
                      </TableCell>
                      <TableCell className="text-right hidden xl:table-cell">
                        {metric.cpSale > 0 ? `${metric.cpSale.toFixed(2)} €` : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={metric.roi >= 0 ? 'text-success' : 'text-destructive'}>
                          {metric.roi.toFixed(1)}%
                        </span>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
