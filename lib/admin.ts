import { env } from "cloudflare:workers";

export async function authorizeAdmin(request: Request): Promise<Response | null> {
  const fail = (message: string, status: number) => Response.json(
    { error: message }, { status, headers: { "Cache-Control": "no-store" } }
  );
  if (!env.DB) return fail("数据库暂不可用", 503);
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("请求来源无效", 403);

  const expected = env.ADMIN_PASSWORD_HASH;
  if (!expected || !/^[0-9a-f]{64}$/.test(expected)) return fail("管理密码尚未设置", 503);
  const password = request.headers.get("x-organizer-password") || "";
  if (password.length > 128) return fail("管理密码无效", 401);

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const ipHash = await sha256(ip);
  const now = Math.floor(Date.now() / 1000);
  const attempt = await env.DB.prepare(
    "SELECT window_start, attempts FROM admin_attempts WHERE id = ?"
  ).bind(ipHash).first<{ window_start: number; attempts: number }>();
  if (attempt && now - attempt.window_start < 900 && attempt.attempts >= 10) {
    return fail("尝试次数过多，请稍后重试", 429);
  }

  const actual = await sha256(password);
  let difference = 0;
  for (let index = 0; index < expected.length; index++) {
    difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  if (difference !== 0) {
    await env.DB.prepare(
      `INSERT INTO admin_attempts (id, window_start, attempts) VALUES (?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET
       attempts = CASE WHEN ? - window_start >= 900 THEN 1 ELSE attempts + 1 END,
       window_start = CASE WHEN ? - window_start >= 900 THEN ? ELSE window_start END`
    ).bind(ipHash, now, now, now, now).run();
    return fail("管理密码不正确", 401);
  }
  return null;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
