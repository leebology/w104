/**
 * "1ST", "2ND", "3RD", "4TH". Display-only, and upper case because every place
 * in this app is set in Bungee, which has no lower case to lose.
 *
 * The teens are the exception the naive rule gets wrong — 11th/12th/13th take
 * "TH" despite ending 1/2/3. The player cap is 10 so they are unreachable
 * today, but a rule that is only correct up to its current caller is a trap
 * for whoever raises the cap.
 */
export function ordinal(n: number): string {
  const teen = n % 100;
  if (teen >= 11 && teen <= 13) return `${n}TH`;
  switch (n % 10) {
    case 1:
      return `${n}ST`;
    case 2:
      return `${n}ND`;
    case 3:
      return `${n}RD`;
    default:
      return `${n}TH`;
  }
}
