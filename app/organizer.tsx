"use client";

import Script from "next/script";
import { useState } from "react";
import type { Game } from "./page";

type AdminGame = Game & { manualRegistered: number; manualRoster: string };
type Member = { id: string; name: string };
type Attendance = { gameId: string; memberId: string };
type Registration = { id: string; gameId: string; nickname: string; phone: string; status: string; isProxy: number };
type AdminData = { games: AdminGame[]; members: Member[]; attendance: Attendance[]; registrations: Registration[] };
type Spreadsheet = {
  read(data: unknown, options: object): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: { sheet_to_json(sheet: unknown, options: object): unknown[][] };
};
declare global { interface Window { XLSX?: Spreadsheet } }

const emptyGame = {
  title: "队内娱乐局", date: "", start: "", end: "", venue: "凯恩",
  fieldNumber: "", format: 5, capacity: 10, priceCents: 0, manualRegistered: 0,
};

export default function Organizer({ games, refresh }: { games: Game[]; refresh: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [data, setData] = useState<AdminData | null>(null);
  const [message, setMessage] = useState("");
  const [gameId, setGameId] = useState("new");
  const [form, setForm] = useState(emptyGame);
  const [roster, setRoster] = useState("");
  const [totalFee, setTotalFee] = useState("");
  const [importNames, setImportNames] = useState<string[]>([]);
  const [attendanceGame, setAttendanceGame] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  async function request<T>(path: string, payload: object): Promise<T> {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Organizer-Password": password },
      body: JSON.stringify(payload),
    });
    const result = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(result.error || "操作失败，请重试。");
    return result;
  }

  async function loadAdmin() {
    const result = await request<AdminData>("/api/admin/data", {});
    setData(result);
    return result;
  }

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try { await loadAdmin(); setMessage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "登录失败。"); }
    finally { setBusy(false); }
  }

  function selectGame(id: string) {
    setGameId(id);
    const game = data?.games.find(item => item.id === id);
    setForm(game ? {
      title: game.title, date: game.date, start: game.start, end: game.end, venue: game.venue,
      fieldNumber: game.fieldNumber, format: game.format, capacity: game.capacity,
      priceCents: game.priceCents, manualRegistered: game.manualRegistered,
    } : emptyGame);
    setTotalFee(game?.totalFeeCents != null ? String(game.totalFeeCents / 100) : "");
    try { setRoster(game ? JSON.parse(game.manualRoster).join("\n") : ""); }
    catch { setRoster(""); }
    setMessage("");
  }

  async function saveGame(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await request<{ id: string }>("/api/admin/games", {
        ...form, totalFeeCents: totalFee === "" ? null : Math.round(Number(totalFee) * 100), ...(gameId === "new" ? {} : { id: gameId }),
        manualRoster: roster.split(/\r?\n/).map(name => name.trim()).filter(Boolean),
      });
      const next = await loadAdmin();
      const updated = next.games.find(game => game.id === result.id);
      setGameId(result.id);
      if (updated) setRoster(JSON.parse(updated.manualRoster).join("\n"));
      await refresh();
      setMessage("球局已保存，队友可以查看。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败。"); }
    finally { setBusy(false); }
  }

  async function deleteGame() {
    const game = data?.games.find(item => item.id === gameId);
    if (!game || !window.confirm(`确定删除「${game.title}」？该场报名也会从列表中移除。`)) return;
    setBusy(true);
    try {
      await request("/api/admin/games", { action: "delete", id: gameId });
      await loadAdmin(); await refresh();
      setGameId("new"); setForm(emptyGame); setRoster(""); setTotalFee("");
      setMessage("球局已删除。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "删除失败。"); }
    finally { setBusy(false); }
  }

  async function readFile(event: React.ChangeEvent<HTMLInputElement>) {
    setImportNames([]);
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (!window.XLSX) throw new Error("表格组件尚未加载，请稍后重试。");
      if (file.size > 5 * 1024 * 1024) throw new Error("文件不能超过 5 MB。");
      const bytes = await file.arrayBuffer();
      let workbook;
      if (/\.csv$/i.test(file.name)) {
        let csv;
        try { csv = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
        catch { csv = new TextDecoder("gb18030").decode(bytes); }
        workbook = window.XLSX.read(csv, { type: "string", raw: true });
      } else if (/\.(xlsx|xls)$/i.test(file.name)) {
        workbook = window.XLSX.read(bytes, { type: "array", raw: true });
      } else throw new Error("请选择 Excel 或 CSV 文件。");
      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: true, defval: "", blankrows: false });
      const columns = (rows[0] || []).map((cell, index) => ({ name: String(cell ?? "").replace(/^\uFEFF/, "").trim(), index }))
        .filter(cell => ["姓名", "昵称"].includes(cell.name));
      if (columns.length !== 1) throw new Error("第一行应有且只有一列「姓名」或「昵称」。");
      const existing = new Set((data?.members || []).map(member => member.name.normalize("NFKC").trim().toLocaleLowerCase("zh-CN")));
      const names: string[] = [];
      let duplicates = 0;
      for (const row of rows.slice(1)) {
        const name = String(row[columns[0].index] ?? "").trim();
        if (!name) continue;
        if (name.length > 24) throw new Error("队员姓名最多 24 个字符。");
        const key = name.normalize("NFKC").toLocaleLowerCase("zh-CN");
        if (existing.has(key)) { duplicates++; continue; }
        existing.add(key); names.push(name);
      }
      if (names.length > 500) throw new Error("每次最多导入 500 人。");
      setImportNames(names);
      setMessage(`可导入 ${names.length} 人，跳过重复姓名 ${duplicates} 个。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "文件读取失败。"); }
  }

  async function importMembers() {
    setBusy(true);
    try {
      const result = await request<{ imported: number }>("/api/admin/attendance", { action: "import", names: importNames });
      setImportNames([]); await loadAdmin();
      setMessage(`已导入 ${result.imported} 名队员。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "导入失败。"); }
    finally { setBusy(false); }
  }

  function chooseAttendance(id: string) {
    setAttendanceGame(id);
    setChecked(new Set((data?.attendance || []).filter(row => row.gameId === id).map(row => row.memberId)));
  }

  async function saveAttendance() {
    setBusy(true);
    try {
      await request("/api/admin/attendance", { action: "save", gameId: attendanceGame, memberIds: [...checked] });
      await loadAdmin(); setMessage("出勤已保存。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败。"); }
    finally { setBusy(false); }
  }

  async function importLocalData() {
    if (!window.confirm("将这台设备上保存的球局、队员和出勤合并到共享版。已有共享球局不会覆盖。继续吗？")) return;
    setBusy(true);
    try {
      const legacyBookings = JSON.parse(localStorage.getItem("kickoff-bookings-xian-v1") || "[]") as
        { id: string; nickname?: string; registration?: string }[];
      const importedGames: string[] = [];
      let skipped = 0;
      const prefix = "kickoff-game-settings-v1:";
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key?.startsWith(prefix)) continue;
        const saved = JSON.parse(localStorage.getItem(key) || "null");
        const game = saved?.game;
        if (!game || saved.deleted || !game.id?.startsWith("team-") || key !== prefix + game.id) continue;
        const booking = legacyBookings.find(entry => entry.id === game.id && entry.registration !== "waiting");
        const manualRoster = Array.isArray(saved.rosterNames) ? [...saved.rosterNames] : [];
        if (booking?.nickname) manualRoster.push(booking.nickname);
        const result = await request<{ id: string; skipped?: boolean }>("/api/admin/games", {
          action: "import", id: game.id, title: game.title, date: game.date, start: game.start,
          end: game.end, venue: game.venue, fieldNumber: saved.fieldNumber || "", format: game.format,
          capacity: saved.maxPlayers ?? game.format * 2, priceCents: Math.round(Number(saved.price ?? game.price) * 100),
          manualRegistered: Number(saved.otherPlayers ?? 0) + Number(Boolean(booking)), manualRoster,
        });
        if (result.skipped) skipped++; else importedGames.push(result.id);
      }
      const oldMembers = JSON.parse(localStorage.getItem("kickoff-club-members-v1") || "[]") as Member[];
      for (let start = 0; start < oldMembers.length; start += 500) {
        await request("/api/admin/attendance", { action: "import", names: oldMembers.slice(start, start + 500).map(member => member.name) });
      }
      const current = await loadAdmin();
      const oldAttendance = JSON.parse(localStorage.getItem("kickoff-attendance-v1") || "{}") as Record<string, string[]>;
      const normalize = (name: string) => name.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
      const sharedByName = new Map(current.members.map(member => [normalize(member.name), member.id]));
      const oldById = new Map(oldMembers.map(member => [member.id, normalize(member.name)]));
      for (const id of importedGames) {
        const memberIds = [...new Set((oldAttendance[id] || []).map(oldId =>
          sharedByName.get(oldById.get(oldId) || "")).filter((value): value is string => Boolean(value)))];
        if (memberIds.length) await request("/api/admin/attendance", { action: "merge", gameId: id, memberIds });
      }
      await loadAdmin(); await refresh();
      setMessage(`已迁移 ${importedGames.length} 场球局，跳过 ${skipped} 场已有球局。原设备数据仍保留。`);
    } catch (error) {
      await loadAdmin(); await refresh();
      setMessage(error instanceof Error ? `部分数据可能已迁移：${error.message}` : "部分数据可能已迁移，请检查后重试。");
    } finally { setBusy(false); }
  }

  if (!data) return <div className="panel">
    <h2>发起者登录</h2>
    <form onSubmit={login}>
      <label>管理密码<input type="password" value={password} onChange={event => setPassword(event.target.value)} required autoComplete="current-password" /></label>
      <button disabled={busy}>进入管理</button>
    </form>
    <p className="feedback" role="status">{message}</p>
  </div>;

  return <>
    <Script src="/xlsx.full.min.js" strategy="afterInteractive" />
    <p className="feedback" role="status">{message}</p>
    <section className="panel">
      <h2>迁移本机试用数据</h2>
      <p className="small">在以前创建球局和导入名单的设备上操作。旧报名会作为手动登记人数；如队友重新报名，请相应减少手动登记人数。</p>
      <button className="secondary" disabled={busy} onClick={() => void importLocalData()}>迁移本机数据</button>
    </section>
    <section className="panel">
      <h2>管理球局</h2>
      <label>选择球局<select value={gameId} onChange={event => selectGame(event.target.value)}>
        <option value="new">新建球局</option>
        {data.games.map(game => <option key={game.id} value={game.id}>{game.date} · {game.title}</option>)}
      </select></label>
      <form onSubmit={saveGame}>
        <label>球局名称<input value={form.title} maxLength={40} required onChange={event => setForm({ ...form, title: event.target.value })} /></label>
        <div className="form-grid">
          <label>日期<input type="date" required value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} /></label>
          <label>球场<select value={form.venue} onChange={event => setForm({ ...form, venue: event.target.value })}>{["凯恩", "省体训练中心", "软西"].map(value => <option key={value}>{value}</option>)}</select></label>
          <label>开始时间<input type="time" required value={form.start} onChange={event => setForm({ ...form, start: event.target.value })} /></label>
          <label>结束时间<input type="time" required value={form.end} onChange={event => setForm({ ...form, end: event.target.value })} /></label>
          <label>几人制<select value={form.format} onChange={event => setForm({ ...form, format: Number(event.target.value) })}>{[5, 6, 7, 8, 9, 11].map(value => <option key={value} value={value}>{value} 人制</option>)}</select></label>
          <label>场地号<input value={form.fieldNumber} maxLength={30} onChange={event => setForm({ ...form, fieldNumber: event.target.value })} /></label>
          <label>报名上限<input type="number" required min={1} max={500} value={form.capacity} onChange={event => setForm({ ...form, capacity: Number(event.target.value) })} /></label>
          <label>手动登记人数<input type="number" min={0} placeholder="0" value={form.manualRegistered === 0 ? "" : form.manualRegistered} onChange={event => setForm({ ...form, manualRegistered: Number(event.target.value) })} /></label>
          <label>总场地费（元）<input type="number" min={0} max={100000} step="0.01" inputMode="decimal" placeholder="请输入总场地费" value={totalFee} onChange={event => setTotalFee(event.target.value)} /></label>
          <label>人均场地费（元）<output>{totalFee === "" ? "待填写总场地费" : (() => { const count = form.manualRegistered + data.registrations.filter(row => row.gameId === gameId && row.status === "confirmed").length; return count ? `¥${(Number(totalFee) / count).toFixed(2)} / 人（${count} 人）` : "暂无报名，待计算"; })()}</output></label>
        </div>
        <p className="small">踢完球后填写实际总场地费，人均费用按已确认报名人数和手动登记人数自动计算，候补不计入。</p>
        {totalFee === "" && gameId !== "new" && <p className="small">未填写总场地费时保留原有每人费用。</p>}
        <label>手动登记的昵称，每行一个<textarea rows={3} value={roster} onChange={event => setRoster(event.target.value)} /></label>
        <div className="actions"><button disabled={busy}>保存球局</button>{gameId !== "new" && <button type="button" className="danger" disabled={busy} onClick={() => void deleteGame()}>删除球局</button>}</div>
      </form>
      {gameId !== "new" && <div><h3>队友报名</h3>{data.registrations.filter(row => row.gameId === gameId).map(row => <div className="summary-row" key={row.id}><span>{row.nickname}{row.isProxy ? "（代报）" : ""}</span><span>{row.phone}</span></div>)}</div>}
    </section>
    <section className="panel">
      <h2>导入队员名单</h2><p className="small">支持 Excel 或 CSV，第一行包含「姓名」或「昵称」。</p>
      <input type="file" accept=".xlsx,.xls,.csv" onChange={event => void readFile(event)} />
      {importNames.length > 0 && <button disabled={busy} onClick={() => void importMembers()}>确认导入 {importNames.length} 人</button>}
    </section>
    <section className="panel">
      <h2>记录每场出勤</h2>
      <label>选择球局<select value={attendanceGame} onChange={event => chooseAttendance(event.target.value)}>
        <option value="">请选择球局</option>
        {data.games.map(game => <option key={game.id} value={game.id}>{game.date} · {game.title}</option>)}
      </select></label>
      <div className="member-grid">{data.members.map(member => <label key={member.id}><input type="checkbox" checked={checked.has(member.id)} onChange={event => {
        const next = new Set(checked); if (event.target.checked) next.add(member.id); else next.delete(member.id); setChecked(next);
      }} />{member.name}</label>)}</div>
      <button disabled={busy || !attendanceGame || !data.members.length} onClick={() => void saveAttendance()}>保存出勤</button>
    </section>
    <section className="panel">
      <h2>队员出勤统计</h2>
      {data.members.length ? data.members.map(member => <div className="summary-row" key={member.id}><span>{member.name}</span><strong>{data.attendance.filter(row => row.memberId === member.id).length} 场</strong></div>) : <p className="small">请先导入队员名单。</p>}
    </section>
  </>;
}
