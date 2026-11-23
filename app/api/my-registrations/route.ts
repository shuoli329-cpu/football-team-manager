import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const fail = (message: string, status: number) => Response.json(
    { error: message }, { status, headers: { "Cache-Control": "no-store" } }
  );
  if (!env.DB) return fail("数据库暂不可用", 503);
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("请求来源无效", 403);
  if (Number(request.headers.get("content-length") || 0) > 16384) return fail("请求过大", 413);

  let entries: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 16384) return fail("请求过大", 413);
    entries = JSON.parse(raw)?.entries;
  } catch {
    return fail("请求格式无效", 400);
  }
  if (!Array.isArray(entries) || entries.length > 100) return fail("请求格式无效", 400);

  const valid = entries.every(item =>
    item && typeof item === "object" && typeof item.gameId === "string" &&
    item.gameId.length <= 100 && typeof item.token === "string" && /^[0-9a-f]{64}$/.test(item.token)
  );
  if (!valid) return fail("报名凭证无效", 400);

  const matches = await Promise.all(entries.map(async entry => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(entry.token));
    const hash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
    return env.DB!.prepare(
      `SELECT registrations.game_id AS gameId, registrations.status
       FROM registrations JOIN games ON games.id = registrations.game_id
       WHERE game_id = ? AND token_hash = ? AND games.deleted_at IS NULL`
    ).bind(entry.gameId, hash).first();
  }));
  return Response.json(
    { registrations: matches.filter(Boolean) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
