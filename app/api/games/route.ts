import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!env.DB) {
    return Response.json({ error: "数据库暂不可用" }, { status: 503 });
  }

  const result = await env.DB.prepare(
    `SELECT games.id, title, date, start, end, venue,
            field_number AS fieldNumber, format, capacity,
            price_cents AS priceCents, total_fee_cents AS totalFeeCents, note, manual_roster AS manualRoster,
            manual_registered + (SELECT COUNT(*) FROM registrations
             WHERE registrations.game_id = games.id AND status = 'confirmed') AS registered
     FROM games WHERE deleted_at IS NULL ORDER BY date, start`
  ).all();

  const registrations = await env.DB.prepare(
    `SELECT registrations.game_id AS gameId, nickname
     FROM registrations JOIN games ON games.id = registrations.game_id
     WHERE games.deleted_at IS NULL AND registrations.status = 'confirmed'
     ORDER BY registrations.created_at`
  ).all<{ gameId: string; nickname: string }>();
  const names = new Map<string, string[]>();
  for (const row of registrations.results) {
    const list = names.get(row.gameId) ?? [];
    list.push(row.nickname);
    names.set(row.gameId, list);
  }
  const games = result.results.map(row => {
    let manual: string[] = [];
    try {
      const parsed = JSON.parse(String(row.manualRoster || "[]"));
      if (Array.isArray(parsed)) manual = parsed.filter(value => typeof value === "string");
    } catch { /* Keep the rest of the game visible if old manual data is invalid. */ }
    const { manualRoster: _roster, ...rest } = row;
    return { ...rest, roster: [...manual, ...(names.get(String(row.id)) ?? [])] };
  });
  return Response.json({ games }, {
    headers: { "Cache-Control": "no-store" },
  });
}
