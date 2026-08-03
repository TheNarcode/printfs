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

// check this
export function resolveFooterOption(
  email: string,
  userRequestedOption?: boolean
): { footer: boolean; extraCost: number } {
  const domain = getDomain(email);

  if (domain === "sfit.ac.in") {
    return { footer: false, extraCost: 2 };
  }

  if (domain === "student.sfit.ac.in") {
    if (!userRequestedOption) {
      return { footer: false, extraCost: 2 };
    } else {
      return { footer: true, extraCost: 0 };
    }
  }

  return { footer: true, extraCost: 0 };
}

export function generateQueueTokenId(totalOrderIndex: number = 1, date = new Date()): string {
  const n = Math.max(1, totalOrderIndex);
  const y = ((n - 1) % 5) + 1;
  const xxxx = (Math.floor((n - 1) / 5) + 1).toString().padStart(4, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear().toString();
  const ddmmyyyy = `${day}${month}${year}`;
  return `${y}${xxxx}-${ddmmyyyy}`;
}
