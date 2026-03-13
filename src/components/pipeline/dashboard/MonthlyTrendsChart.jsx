import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export const MonthlyTrendsChart = ({ data }) => {
  if (data.monthlyTrends.length === 0) {
    return (
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Évolution mensuelle (6 derniers mois)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">Aucune donnée disponible</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Évolution mensuelle (6 derniers mois)</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data.monthlyTrends}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="month" className="text-xs" />
            <YAxis className="text-xs" />
            <Tooltip
              contentStyle={{
                backgroundColor: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="leads"
              stroke="#3b82f6"
              name="Leads"
              strokeWidth={2}
              dot={{ r: 4, fill: '#3b82f6' }}
            />
            <Line
              type="monotone"
              dataKey="appointments"
              stroke="#f59e0b"
              name="RDV"
              strokeWidth={2}
              dot={{ r: 4, fill: '#f59e0b' }}
            />
            <Line
              type="monotone"
              dataKey="sales"
              stroke="#10b981"
              name="Ventes"
              strokeWidth={2}
              dot={{ r: 4, fill: '#10b981' }}
            />
            <Line
              type="monotone"
              dataKey="revenue"
              stroke="#6366f1"
              name="CA HT (€)"
              strokeWidth={2}
              dot={{ r: 4, fill: '#6366f1' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};
