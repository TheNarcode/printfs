export const validMimes = ["application/pdf", "image/jpeg", "image/png"];
export const maxFileSizeLimit = 10 * 1024 * 1024;

export function getDomain(email: string): string {
  const parts = email.toLowerCase().trim().split("@");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

export function isAllowedDomain(email: string): boolean {
  const domain = getDomain(email);
  return domain === "student.sfit.ac.in" || domain === "sfit.ac.in";
}

export function generateQueueTokenId(seq: number = 1, date = new Date()): string {
  const a = Math.floor(Math.random() * 5) + 1;
  const xxxx = (seq % 10000).toString().padStart(4, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear().toString();
  const ddmmyyyy = `${day}${month}${year}`;
  return `${a}${xxxx}-${ddmmyyyy}`;
}
