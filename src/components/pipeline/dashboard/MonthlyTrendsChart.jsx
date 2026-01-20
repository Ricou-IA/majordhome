import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export const MonthlyTrendsChart = ({ data, isAdmin }) => {
  if (data.monthlyTrends.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Évolution mensuelle (6 derniers mois)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">Aucune donnée disponible</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Évolution mensuelle (6 derniers mois)</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data.monthlyTrends}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="month" className="text-xs" />
            <YAxis className="text-xs" />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 'var(--radius)',
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="leads"
              stroke="hsl(var(--primary))"
              name="Leads"
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="appointments"
              stroke="hsl(var(--accent))"
              name="RDV"
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="sales"
              stroke="hsl(var(--success))"
              name="Ventes"
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="revenue"
              stroke="hsl(var(--warning))"
              name="CA HT (€)"
              strokeWidth={2}
            />
            {isAdmin && (
              <Line
                type="monotone"
                dataKey="expenses"
                stroke="hsl(var(--destructive))"
                name="Dépenses (€)"
                strokeWidth={2}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};
