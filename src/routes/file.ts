import { Hono } from "hono";
import db from "../database/index";
import { metadata } from "../database/schema";
import { PDFDocument } from "pdf-lib";
import { authMiddleware } from "../middlewares/auth";
import { maxFileSizeLimit, validMimes } from "../constants";
import shortUniqueId from "short-unique-id";

const app = new Hono<{ Bindings: Env }>();
const sui = new shortUniqueId({ dictionary: "alpha_lower", length: 5 });

app.post("/create", authMiddleware, async (c) => {
  try {
    const database = db(c.env.PRINTFDB);
    const { file } = await c.req.parseBody();

    if (
      !(file instanceof File) ||
      !validMimes.includes(file.type) ||
      file.size > maxFileSizeLimit
    ) {
      return c.body(null, 400);
    }

    const fileId = sui.rnd();
    const arrayBuffer = await file.arrayBuffer();

    let pages = 1;
    if (file.type === "application/pdf") {
      const pdf = await PDFDocument.load(arrayBuffer);
      pages = pdf.getPageCount();
    }

    await Promise.all([
      c.env.PRINTFBUCKET.put(fileId, arrayBuffer),
      database
        .insert(metadata)
        .values({ fileId, type: file.type, name: file.name, pages }),
    ]);

    return c.json({ fileId }, 200);
  } catch (e) {
    return c.body(null, 500);
  }
});

export default app;
