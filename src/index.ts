import { Hono } from "hono";
import orderRouter from "./routes/order.js";
import uploadRouter from "./routes/file.js";
import webhookRouter from "./routes/webhook.js";
import notificationRouter from "./routes/notification.js";
import clientRouter from "./routes/client.js";
import { cors } from "hono/cors";

const app = new Hono<{ Bindings: Env }>();

app.use(cors()); 
app.route("/order", orderRouter);
app.route("/file", uploadRouter);
app.route("/webhook", webhookRouter);
app.route("/notification", notificationRouter);
app.route("/client", clientRouter);

app.get("/", async (c) => {
  return c.text("ok");
});

export function getUniquePrintPageCount(
  range: string,
  totalPages: number,
): number {
  const trimmed = range?.trim().toLowerCase();
  if (!trimmed || trimmed === "all") return totalPages;

  const pages = new Set<number>();

  range.split(",").forEach((part) => {
    part = part.trim();

    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) {
          if (i >= 1 && i <= totalPages) {
            pages.add(i);
          }
        }
      }
    } else {
      const pageNum = Number(part);
      if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
        pages.add(pageNum);
      }
    }
  });

  return pages.size || totalPages;
}

export default app;