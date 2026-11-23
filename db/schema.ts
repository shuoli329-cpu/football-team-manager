import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const games = sqliteTable("games", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  date: text("date").notNull(),
  start: text("start").notNull(),
  end: text("end").notNull(),
  venue: text("venue").notNull(),
  fieldNumber: text("field_number").notNull().default(""),
  format: integer("format").notNull(),
  capacity: integer("capacity").notNull(),
  manualRegistered: integer("manual_registered").notNull().default(0),
  manualRoster: text("manual_roster").notNull().default("[]"),
  priceCents: integer("price_cents").notNull(),
  totalFeeCents: integer("total_fee_cents"),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const registrations = sqliteTable("registrations", {
  id: text("id").primaryKey(),
  gameId: text("game_id").notNull().references(() => games.id),
  nickname: text("nickname").notNull(),
  phone: text("phone").notNull(),
  isProxy: integer("is_proxy").notNull().default(0),
  tokenHash: text("token_hash").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [uniqueIndex("registration_token").on(table.gameId, table.tokenHash)]);

export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull().unique(),
});

export const attendance = sqliteTable("attendance", {
  gameId: text("game_id").notNull().references(() => games.id),
  memberId: text("member_id").notNull().references(() => members.id),
}, table => [uniqueIndex("attendance_game_member").on(table.gameId, table.memberId)]);

export const adminAttempts = sqliteTable("admin_attempts", {
  id: text("id").primaryKey(),
  windowStart: integer("window_start").notNull(),
  attempts: integer("attempts").notNull(),
});
