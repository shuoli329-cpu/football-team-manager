import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

function error(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function tokenHash(token: string) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!env.DB) return error("数据库暂不可用", 503);
  if (request.headers.get("origin") !== new URL(request.url).origin) return error("请求来源无效", 403);
  if (Number(request.headers.get("content-length") || 0) > 2048) return error("请求过大", 413);

  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return error("请求过大", 413);
    body = JSON.parse(raw);
  } catch {
    return error("请求格式无效", 400);
  }
  if (!body || typeof body !== "object") return error("请求格式无效", 400);
  const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const token = typeof body.token === "string" ? body.token : "";
  const desired = body.status === "waiting" ? "waiting" : "confirmed";
  const isProxy = body.isProxy === true ? 1 : 0;
  if (!nickname || nickname.length > 24 || !/^1\d{10}$/.test(phone) || !/^[0-9a-f]{64}$/.test(token)) {
    return error("请填写昵称和有效手机号", 400);
  }

  const { id } = await params;
  const hash = await tokenHash(token);
  const previous = await env.DB.prepare(
    "SELECT status FROM registrations WHERE game_id = ? AND token_hash = ?"
  ).bind(id, hash).first<{ status: string }>();
  const now = new Date();
  const chinaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
  if (previous) {
    if (previous.status !== "waiting" || desired === "waiting") {
      return Response.json({ status: previous.status }, { headers: { "Cache-Control": "no-store" } });
    }
    const updated = await env.DB.prepare(
      `UPDATE registrations SET status = 'confirmed'
       WHERE game_id = ? AND token_hash = ? AND status = 'waiting'
       AND EXISTS (SELECT 1 FROM games WHERE id = ? AND deleted_at IS NULL AND date || 'T' || start > ?
       AND manual_registered + (SELECT COUNT(*) FROM registrations WHERE game_id = games.id AND status = 'confirmed') < capacity)`
    ).bind(id, hash, id, chinaNow).run();
    if (!updated.meta.changes) return error("暂时没有空位或球局已结束", 409);
    return Response.json({ status: "confirmed" }, { headers: { "Cache-Control": "no-store" } });
  }
  const inserted = await env.DB.prepare(
    `INSERT INTO registrations (id, game_id, nickname, phone, token_hash, status, created_at, is_proxy)
     SELECT ?, games.id, ?, ?, ?, ?, ?, ? FROM games
     WHERE games.id = ? AND deleted_at IS NULL AND date || 'T' || start > ?
       AND (? = 'waiting' OR manual_registered + (SELECT COUNT(*) FROM registrations WHERE game_id = games.id AND status = 'confirmed') < capacity)
     ON CONFLICT(game_id, token_hash) DO NOTHING`
  ).bind(crypto.randomUUID(), nickname, phone, hash, desired, now.toISOString(), isProxy, id, chinaNow, desired).run();
  if (!inserted.meta.changes) {
    const existing = await env.DB.prepare(
      "SELECT status FROM registrations WHERE game_id = ? AND token_hash = ?"
    ).bind(id, hash).first<{ status: string }>();
    if (existing) return Response.json({ status: existing.status }, { headers: { "Cache-Control": "no-store" } });
    return error("球局已满、已结束或不存在", 409);
  }
  return Response.json({ status: desired }, { headers: { "Cache-Control": "no-store" } });
}
