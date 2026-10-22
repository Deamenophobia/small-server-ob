export function monthInfo(date = new Date()) {
  const year = date.getUTCFullYear(),
    month = date.getUTCMonth();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return { month: `${year}-${String(month + 1).padStart(2, '0')}`, days, hours: days * 24 };
}
export function estimate(cost, date = new Date()) {
  if (!cost) return null;
  return {
    amount: Math.round(cost.amount * (cost.period === 'hourly' ? monthInfo(date).hours : 1) * 100) / 100,
    currency: cost.currency,
  };
}
export function summarizeCosts(servers, date = new Date()) {
  const groups = new Map();
  let configured = 0;
  for (const server of servers) {
    if (!server.cost) continue;
    configured++;
    const { currency } = server.cost;
    if (!groups.has(currency)) groups.set(currency, { currency, amount: 0, providers: Object.create(null) });
    const group = groups.get(currency);
    // Sum each displayed card's rounded cents so the total reconciles with its rows.
    const monthly = Math.round(estimate(server.cost, date).amount * 100);
    group.amount += monthly;
    group.providers[server.provider] = (group.providers[server.provider] || 0) + monthly;
  }
  return {
    ...monthInfo(date),
    configured,
    total: servers.length,
    groups: [...groups.values()].map((g) => ({
      ...g,
      amount: g.amount / 100,
      providers: Object.entries(g.providers).map(([provider, amount]) => ({
        provider,
        amount: amount / 100,
      })),
    })),
  };
}
