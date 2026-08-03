import { relations } from "drizzle-orm";
import { sqliteTable, text, real, integer, index } from "drizzle-orm/sqlite-core";
import shortUniqueId from "short-unique-id";
import { generateQueueTokenId } from "../constants";

const sui = new shortUniqueId({ dictionary: "alpha_lower", length: 5 });

export const orders = sqliteTable("orders", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => sui.rnd()),
  email: text("email").notNull(),
  amount: real("amount").notNull(),
  paymentRequestId: text("payment_request_id").notNull(),
  paid: integer("paid", { mode: "boolean" }).notNull().default(false),
  status: integer("status").notNull().default(0),
  printerName: text("printer_name"),
  footer: integer("footer", { mode: "boolean" }),
  queueTokenId: text("queue_token_id").$defaultFn(() => generateQueueTokenId()),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
}, (table) => [
  index("email_idx").on(table.email),
]);

export const files = sqliteTable("files", {
  fileId: text("id").primaryKey(),
  order: text("order").notNull(),
  orientation: text("orientation").notNull(),
  color: text("color").notNull(),
  copies: text("copies").notNull(),
  paperFormat: text("paper_format").notNull(),
  pageRanges: text("page_ranges").notNull(),
  numberUp: text("number_up").notNull(),
  sides: text("sides").notNull(),
  printScaling: text("print_scaling").notNull(),
  documentFormat: text("document_format").notNull(),
  printed: integer("printed", { mode: "boolean" }),
}, (table) => [
  index("order_idx").on(table.order),
]);

export const metadata = sqliteTable("metadata", {
  fileId: text("file_id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  pages: integer("pages").notNull(),
});

export const fcmTokens = sqliteTable("fcm_tokens", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => sui.rnd()),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const ordersRelations = relations(orders, ({ many }) => ({
  files: many(files),
}));

export const filesRelations = relations(files, ({ one }) => ({
  order: one(orders, {
    fields: [files.order],
    references: [orders.id],
  }),
  metadata: one(metadata, {
    fields: [files.fileId],
    references: [metadata.fileId],
  }),
}));
