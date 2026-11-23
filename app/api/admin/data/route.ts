import { env } from "cloudflare:workers";
import { authorizeAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = await authorizeAdmin(request);
  if (denied) return denied;
  const [games, registrations, members, attendance] = await env.DB!.batch([
    env.DB!.prepare(`SELECT id, title, date, start, end, venue, field_number AS fieldNumber,
      format, capacity, price_cents AS priceCents, total_fee_cents AS totalFeeCents, manual_registered AS manualRegistered,
      manual_roster AS manualRoster, note
      FROM games WHERE deleted_at IS NULL ORDER BY date, start`),
    env.DB!.prepare(`SELECT registrations.id, game_id AS gameId, nickname, phone, status, is_proxy AS isProxy
      FROM registrations JOIN games ON games.id = registrations.game_id
      WHERE games.deleted_at IS NULL ORDER BY registrations.created_at`),
    env.DB!.prepare("SELECT id, name FROM members ORDER BY name_key"),
    env.DB!.prepare(`SELECT attendance.game_id AS gameId, attendance.member_id AS memberId
      FROM attendance JOIN games ON games.id = attendance.game_id WHERE games.deleted_at IS NULL`),
  ]);
  return Response.json({
    games: games.results,
    registrations: registrations.results,
    members: members.results,
    attendance: attendance.results,
  }, { headers: { "Cache-Control": "no-store" } });
}
