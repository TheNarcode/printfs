import { Hono } from "hono";
import db from "../database/index";
import { metadata } from "../database/schema";
import { PDFDocument, StandardFonts } from "pdf-lib";
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

    let fileBuffer: ArrayBuffer | Uint8Array = arrayBuffer;
    let pages = 1;
    if (file.type === "application/pdf") {
      const pdf = await PDFDocument.load(arrayBuffer);
      pages = pdf.getPageCount();

      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const pdfPages = pdf.getPages();

      pdfPages[0].drawText(c.get("payload").email, {
        x: 10,
        y: 10,
        size: 5,
        font: font,
      });

      fileBuffer = await pdf.save();
    }

    await Promise.all([
      c.env.PRINTFBUCKET.put(fileId, fileBuffer),
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