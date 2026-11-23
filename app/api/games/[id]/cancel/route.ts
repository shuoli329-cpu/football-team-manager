import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const fail = (message: string, status: number) => Response.json(
    { error: message }, { status, headers: { "Cache-Control": "no-store" } }
  );
  if (!env.DB) return fail("数据库暂不可用", 503);
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("请求来源无效", 403);
  if (Number(request.headers.get("content-length") || 0) > 1024) return fail("请求过大", 413);

  let token: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 1024) return fail("请求过大", 413);
    token = JSON.parse(raw)?.token;
  } catch {
    return fail("请求格式无效", 400);
  }
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return fail("报名凭证无效", 400);
  const hashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = Array.from(new Uint8Array(hashBytes), byte => byte.toString(16).padStart(2, "0")).join("");
  const { id } = await params;
  const result = await env.DB.prepare(
    "DELETE FROM registrations WHERE game_id = ? AND token_hash = ?"
  ).bind(id, hash).run();
  if (!result.meta.changes) return fail("没有找到该设备的报名记录", 404);
  return Response.json({ cancelled: true }, { headers: { "Cache-Control": "no-store" } });
}
