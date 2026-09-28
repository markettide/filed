// Explicit allowlist: never return chat IDs, linking tokens or alert history.
export function watchlistRows(users) {
  const companies = (value) => (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === "object")
    .map(({ name, ticker, isin, addedAt }) => ({
      name: String(name || ticker || isin || "Unknown company"),
      ticker: String(ticker || ""),
      isin: String(isin || ""),
      addedAt: addedAt && !Number.isNaN(new Date(addedAt).getTime())
        ? new Date(addedAt).toISOString() : null,
    }));
  return users.map((user) => ({
    email: String(user.email || "").trim().toLowerCase(),
    stocks: companies(user.portfolio),
    parked: companies(user.portfolioOverflow),
    telegramConnected: Boolean(user.telegram?.chatId),
    telegramUsername: String(user.telegram?.username || "").replace(/^@+/, ""),
    alertsEnabled: user.alertsEnabled !== false,
  })).filter((user) => user.email && (user.stocks.length || user.parked.length || user.telegramConnected))
    .sort((a, b) => b.stocks.length - a.stocks.length || a.email.localeCompare(b.email));
}

export function filterWatchlists(rows, query) {
  const needle = String(query || "").trim().toLowerCase();
  return rows.filter((row) => !needle || [row.email, row.telegramUsername,
    ...[...row.stocks, ...row.parked].flatMap((stock) => [stock.name, stock.ticker, stock.isin]),
  ].join(" ").toLowerCase().includes(needle));
}
