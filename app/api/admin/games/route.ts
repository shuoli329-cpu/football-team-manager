import { env } from "cloudflare:workers";
import { authorizeAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

function response(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const denied = await authorizeAdmin(request);
  if (denied) return denied;
  let data: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 20000) return response({ error: "请求过大" }, 413);
    data = JSON.parse(raw);
  } catch {
    return response({ error: "请求格式无效" }, 400);
  }
  if (!data || typeof data !== "object") return response({ error: "请求格式无效" }, 400);
  const id = typeof data.id === "string" ? data.id : crypto.randomUUID();
  if (id.length > 100 || !/^[a-zA-Z0-9-]+$/.test(id)) return response({ error: "球局编号无效" }, 400);
  if (data.action === "delete") {
    const result = await env.DB!.prepare(
      "UPDATE games SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL"
    ).bind(new Date().toISOString(), id).run();
    return result.meta.changes ? response({ deleted: true }) : response({ error: "球局不存在" }, 404);
  }
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const date = typeof data.date === "string" ? data.date : "";
  const start = typeof data.start === "string" ? data.start : "";
  const end = typeof data.end === "string" ? data.end : "";
  const venue = typeof data.venue === "string" ? data.venue : "";
  const field = typeof data.fieldNumber === "string" ? data.fieldNumber.trim() : "";
  const format = Number(data.format);
  const capacity = Number(data.capacity);
  const priceCents = Number(data.priceCents);
  const totalFeeCents = data.totalFeeCents == null ? null : Number(data.totalFeeCents);
  const manualRegistered = Number(data.manualRegistered ?? 0);
  const manualRoster = Array.isArray(data.manualRoster) ? data.manualRoster : [];
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(date + "T00:00:00Z")) &&
    new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date;
  const validTime = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (!title || title.length > 40 || !validDate || !validTime(start) || !validTime(end) || end <= start ||
      !["凯恩", "省体训练中心", "软西"].includes(venue) || field.length > 30 ||
      ![5, 6, 7, 8, 9, 11].includes(format) || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > 500 ||
      !Number.isSafeInteger(priceCents) || priceCents < 0 || priceCents > 10000000 ||
      (totalFeeCents !== null && (!Number.isSafeInteger(totalFeeCents) || totalFeeCents < 0 || totalFeeCents > 10000000)) ||
      !Number.isSafeInteger(manualRegistered) || manualRegistered < 0 ||
      !manualRoster.every(name => typeof name === "string" && name.trim().length > 0 && name.length <= 24) ||
      manualRoster.length > manualRegistered) {
    return response({ error: "球局信息无效，请检查后重试" }, 400);
  }
  const existing = await env.DB!.prepare("SELECT id FROM games WHERE id = ?").bind(id).first();
  if (existing && data.action === "import") return response({ id, skipped: true });
  if (existing) {
    const updated = await env.DB!.prepare(
      `UPDATE games SET title = ?, date = ?, start = ?, end = ?, venue = ?, field_number = ?,
       format = ?, capacity = ?, price_cents = ?, total_fee_cents = ?, manual_registered = ?, manual_roster = ?
       WHERE id = ? AND deleted_at IS NULL
       AND ? >= ? + (SELECT COUNT(*) FROM registrations WHERE game_id = ? AND status = 'confirmed')`
    ).bind(title, date, start, end, venue, field, format, capacity, priceCents, totalFeeCents, manualRegistered,
      JSON.stringify(manualRoster), id, capacity, manualRegistered, id).run();
    if (!updated.meta.changes) return response({ error: "球局已删除或报名人数超过上限" }, 409);
  } else {
    if (manualRegistered > capacity) return response({ error: "报名人数超过上限" }, 400);
    await env.DB!.prepare(
      `INSERT INTO games (id, title, date, start, end, venue, field_number, format, capacity,
       price_cents, total_fee_cents, manual_registered, manual_roster, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)`
    ).bind(id, title, date, start, end, venue, field, format, capacity, priceCents, totalFeeCents,
      manualRegistered, JSON.stringify(manualRoster), new Date().toISOString()).run();
  }
  return response({ id });
}
