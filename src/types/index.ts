import z from "zod";

export const PrintConfig = z.object({
  fileId: z.string(),
  name: z.string(),
  orientation: z.string(),
  color: z.string(),
  copies: z.string(),
  paperFormat: z.string(),
  pageRanges: z.string(),
  numberUp: z.string(),
  sides: z.string(),
  printScaling: z.string(),
  documentFormat: z.string(),
});

export type PrintConfigType = z.infer<typeof PrintConfig>;