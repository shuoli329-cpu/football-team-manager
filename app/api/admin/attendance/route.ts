import { env } from "cloudflare:workers";
import { authorizeAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const response = (data: unknown, status = 200) => Response.json(
    data, { status, headers: { "Cache-Control": "no-store" } }
  );
  const denied = await authorizeAdmin(request);
  if (denied) return denied;
  let data: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 60000) return response({ error: "请求过大" }, 413);
    data = JSON.parse(raw);
  } catch {
    return response({ error: "请求格式无效" }, 400);
  }
  if (!data || typeof data !== "object") return response({ error: "请求格式无效" }, 400);

  if (data.action === "import") {
    if (!Array.isArray(data.names) || data.names.length > 500 ||
      !data.names.every(name => typeof name === "string" && name.trim().length > 0 && name.length <= 24)) {
      return response({ error: "名单格式无效，每次最多导入 500 人" }, 400);
    }
    if (!data.names.length) return response({ imported: 0 });
    const statements = data.names.map(name => {
      const clean = name.trim();
      const key = clean.normalize("NFKC").toLocaleLowerCase("zh-CN");
      return env.DB!.prepare("INSERT INTO members (id, name, name_key) VALUES (?, ?, ?) ON CONFLICT(name_key) DO NOTHING")
        .bind(crypto.randomUUID(), clean, key);
    });
    const result = await env.DB!.batch(statements);
    return response({ imported: result.reduce((sum, item) => sum + item.meta.changes, 0) });
  }

  if ((data.action === "save" || data.action === "merge") && typeof data.gameId === "string" && Array.isArray(data.memberIds)) {
    const ids = data.memberIds;
    if (ids.length > 500 || !ids.every(id => typeof id === "string" && id.length <= 100) || new Set(ids).size !== ids.length) {
      return response({ error: "出勤名单无效" }, 400);
    }
    const game = await env.DB!.prepare("SELECT id FROM games WHERE id = ? AND deleted_at IS NULL").bind(data.gameId).first();
    if (!game) return response({ error: "球局不存在" }, 404);
    const statements = ids.map(id => env.DB!.prepare(
      "INSERT INTO attendance (game_id, member_id) SELECT ?, id FROM members WHERE id = ? ON CONFLICT(game_id, member_id) DO NOTHING"
    ).bind(data.gameId, id));
    if (data.action === "save") statements.unshift(
      env.DB!.prepare("DELETE FROM attendance WHERE game_id = ?").bind(data.gameId)
    );
    if (statements.length) await env.DB!.batch(statements);
    return response({ saved: true });
  }
  return response({ error: "请求格式无效" }, 400);
}
