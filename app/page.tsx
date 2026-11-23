"use client";

import { useCallback, useEffect, useState } from "react";
import Organizer from "./organizer";

export type Game = {
  id: string; title: string; date: string; start: string; end: string; venue: string;
  fieldNumber: string; format: number; capacity: number; priceCents: number; totalFeeCents: number | null;
  registered: number; note: string; roster: string[];
};
function feeLabel(game: Game): string {
  if (game.totalFeeCents == null) return game.priceCents ? `¥${(game.priceCents / 100).toFixed(2)} / 人` : "免费";
  if (!game.registered) return "人均待计算";
  return `¥${(game.totalFeeCents / game.registered / 100).toFixed(2)} / 人`;
}
type Tokens = Record<string, string>;

function loadTokens(): Tokens {
  try { return JSON.parse(localStorage.getItem("club-registration-tokens-v1") || "{}"); }
  catch { return {}; }
}

export default function Home() {
  const [games, setGames] = useState<Game[]>([]);
  const [tokens, setTokens] = useState<Tokens>({});
  const [mine, setMine] = useState<Map<string, string>>(new Map());
  const [tab, setTab] = useState<"games" | "mine" | "organizer">("games");
  const [selected, setSelected] = useState<Game | null>(null);
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [isProxy, setIsProxy] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [venue, setVenue] = useState("all");
  const [format, setFormat] = useState("all");
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [day, setDay] = useState("all");

  const refresh = useCallback(async (current: Tokens) => {
    try {
      const gameResponse = await fetch("/api/games", { cache: "no-store" });
      if (!gameResponse.ok) throw new Error("球局加载失败，请稍后重试。");
      const gameData = await gameResponse.json() as { games: Game[] };
      const entries = Object.entries(current).slice(0, 100).map(([gameId, token]) => ({ gameId, token }));
      const mineResponse = await fetch("/api/my-registrations", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entries }),
      });
      if (!mineResponse.ok) throw new Error("报名状态加载失败，请稍后重试。");
      const mineData = await mineResponse.json() as { registrations: { gameId: string; status: string }[] };
      setGames(gameData.games);
      setMine(new Map(mineData.registrations.map((entry: { gameId: string; status: string }) => [entry.gameId, entry.status])));
      setLoaded(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "网络连接失败。");
    }
  }, []);

  useEffect(() => {
    const current = loadTokens();
    setTokens(current);
    void refresh(current);
    const timer = window.setInterval(() => { void refresh(loadTokens()); }, 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function submit(action: "register" | "cancel", status = "confirmed") {
    if (!selected || busy) return;
    setBusy(true);
    setMessage("");
    try {
      let token = tokens[selected.id];
      let next = tokens;
      if (action === "register") {
        token ||= Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
        next = { ...tokens, [selected.id]: token };
        localStorage.setItem("club-registration-tokens-v1", JSON.stringify(next));
        setTokens(next);
      }
      const response = await fetch(`/api/games/${encodeURIComponent(selected.id)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "register" ? { nickname: nickname.trim(), phone: phone.trim(), token, status, isProxy } : { token }),
      });
      const result = await response.json() as { error?: string; status?: string };
      if (!response.ok) throw new Error(result.error || "操作失败，请重试。");
      if (action === "cancel") {
        next = { ...next };
        delete next[selected.id];
        localStorage.setItem("club-registration-tokens-v1", JSON.stringify(next));
        setTokens(next);
      }
      setSelected(null);
      setPhone("");
      setMessage(action === "register" ? (result.status === "waiting" ? "已加入候补。" : "报名成功。") : "已取消报名。");
      await refresh(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败，请重试。");
    } finally { setBusy(false); }
  }

  const chinaToday = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const chinaTomorrow = new Date(Date.now() + 32 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const closed = (game: Game) => Date.now() >= Date.parse(game.date + "T" + game.start + ":00+08:00");
  const visible = tab === "mine" ? games.filter(game => mine.has(game.id)) : games.filter(game =>
    (venue === "all" || venue === game.venue) &&
    (format === "all" || Number(format) === game.format) &&
    (day === "all" || (day === "today" && game.date === chinaToday) ||
      (day === "tomorrow" && game.date === chinaTomorrow) ||
      (day === "weekend" && [0, 6].includes(new Date(game.date + "T00:00:00Z").getUTCDay()))) &&
    (!onlyAvailable || (game.registered < game.capacity && !closed(game)))
  );
  return <div className="app">
    <header className="header"><div className="header-inner">
      <a className="brand" href="/">将进酒足球俱乐部</a>
      <nav aria-label="主导航">
        <button aria-current={tab === "games" ? "page" : undefined} onClick={() => setTab("games")}>专属报名</button>
        <button aria-current={tab === "mine" ? "page" : undefined} onClick={() => setTab("mine")}>我的报名</button>
        <button aria-current={tab === "organizer" ? "page" : undefined} onClick={() => setTab("organizer")}>发起者</button>
      </nav>
    </div></header>
    <main>
      <div className="hero">
        {/* The crest is a local static asset served by the existing Worker. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="team-crest" src="/team-crest.png" width={84} height={98} alt="将进酒足球俱乐部队徽" />
        <h1>将进酒俱乐部专属报名</h1><span>西安</span>
      </div>
      <p className="feedback" role="status">{message}</p>
      {tab === "organizer" ? <Organizer refresh={() => refresh(loadTokens())} games={games} /> :
        <section>
          <div className="heading"><h2>{tab === "mine" ? "我的报名" : "球局安排"}</h2><span>{visible.length} 场</span></div>
          {tab === "games" && <div className="filters">
            <div className="day-filters" aria-label="按日期筛选">{[["all","全部"],["today","今天"],["tomorrow","明天"],["weekend","周末"]].map(([value,label]) =>
              <button key={value} className="secondary" aria-pressed={day === value} onClick={() => setDay(value)}>{label}</button>
            )}</div>
            <label>球场<select value={venue} onChange={event => setVenue(event.target.value)}><option value="all">全部球场</option>{["凯恩", "省体训练中心", "软西"].map(value => <option key={value}>{value}</option>)}</select></label>
            <label>几人制<select value={format} onChange={event => setFormat(event.target.value)}><option value="all">全部人数</option>{[5,6,7,8,9,11].map(value => <option key={value} value={value}>{value} 人制</option>)}</select></label>
            <label className="check-filter"><input type="checkbox" checked={onlyAvailable} onChange={event => setOnlyAvailable(event.target.checked)} />只看有名额</label>
          </div>}
          {!loaded ? <p>正在加载球局…</p> : visible.length === 0
            ? <div className="empty">{tab === "mine" ? "这台设备暂无报名。" : games.length ? "没有符合条件的球局，请调整筛选。" : "暂无球局，请等待发起者创建。"}</div>
            : <div className="games">{visible.map(game => {
              const remaining = Math.max(0, game.capacity - game.registered);
              return <article className="card" key={game.id}>
                <div className="row"><h3>{game.title}</h3><span className="badge">{mine.get(game.id) === "waiting" ? "候补中" : mine.has(game.id) ? "已报名" : closed(game) ? "报名截止" : remaining ? `余 ${remaining} 位` : "已满员"}</span></div>
                <p>{game.date} · {game.start}–{game.end}</p>
                <p>{game.venue}{game.fieldNumber ? ` · ${game.fieldNumber} 号场` : ""}</p>
                <div className="row card-bottom"><span>{game.format} 人制 · {feeLabel(game)}</span><button onClick={() => { setSelected(game); setIsProxy(false); setMessage(""); }}>{mine.has(game.id) ? "查看报名" : "查看球局"}</button></div>
              </article>;
            })}</div>}
        </section>}
      <footer>将进酒足球俱乐部</footer>
    </main>
    {selected && <div className="overlay" onClick={() => setSelected(null)}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="game-title" onClick={event => event.stopPropagation()}>
        <button className="close" aria-label="关闭" onClick={() => setSelected(null)}>×</button>
        <h2 id="game-title">{selected.title}</h2>
        <p>{selected.date} · {selected.start}–{selected.end}</p>
        <p>{selected.venue}{selected.fieldNumber ? ` · ${selected.fieldNumber} 号场` : ""}</p>
        <p>{selected.format} 人制 · {feeLabel(selected)}</p>
        <p>已报名 {selected.registered} / {selected.capacity} 人</p>
        <details><summary>查看报名名单</summary>
          {selected.roster.length ? <ul>{selected.roster.map((name, index) => <li key={index}>{name}</li>)}</ul> : <p>暂无已登记的昵称。</p>}
          {selected.registered > selected.roster.length && <p>另有 {selected.registered - selected.roster.length} 人未登记昵称。</p>}
        </details>
        {selected.note && <p>{selected.note}</p>}
        {mine.get(selected.id) === "waiting" && <p className="small">你已候补，有空位时可以转为报名。</p>}
        {closed(selected) && <p className="small">本场报名已截止。</p>}
        {!closed(selected) && (!mine.has(selected.id) || (mine.get(selected.id) === "waiting" && selected.registered < selected.capacity)) &&
          <form onSubmit={event => { event.preventDefault(); void submit("register", selected.registered >= selected.capacity ? "waiting" : "confirmed"); }}>
            <label>报名方式<select value={isProxy ? "proxy" : "self"} onChange={event => setIsProxy(event.target.value === "proxy")}><option value="self">本人参加</option><option value="proxy">本人不参加，替别人报名</option></select></label>
            <label>{isProxy ? "参加者昵称" : "队内昵称"}<input required maxLength={24} value={nickname} onChange={event => setNickname(event.target.value)} /></label>
            <label>{isProxy ? "代报人联系电话" : "手机号"}<input required inputMode="numeric" pattern="1[0-9]{10}" maxLength={11} value={phone} onChange={event => setPhone(event.target.value)} /></label>
            <p className="small">{isProxy ? "本次只为一位参加者报名，代报人本人不占名额。" : "手机号仅发起者可查看。"}请使用本设备取消报名。</p>
            <button type="submit" disabled={busy}>{mine.get(selected.id) === "waiting" ? "转为报名" : selected.registered >= selected.capacity ? "加入候补" : "确认报名"}</button>
          </form>}
        {mine.has(selected.id) && <button className="secondary" disabled={busy} onClick={() => void submit("cancel")}>{mine.get(selected.id) === "waiting" ? "取消候补" : "取消报名"}</button>}
        <p className="feedback" role="status">{message}</p>
      </section>
    </div>}
  </div>;
}
