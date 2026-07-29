import { describe, expect, test } from "vitest";
import {
  activeTimeToGbSeconds,
  barWidth,
  formatBytes,
  formatCountdown,
  formatValue,
  fraction,
  LIMITS,
  nextReset,
  severity,
} from "./usage";

describe("fraction", () => {
  test("is the plain ratio in range", () => {
    expect(fraction(25, 100)).toBe(0.25);
  });

  test("clamps above the limit so a bar can never overflow its track", () => {
    expect(fraction(150, 100)).toBe(1);
  });

  test("is zero for an unknown reading rather than NaN", () => {
    expect(fraction(null, 100)).toBe(0);
  });

  test("survives a zero limit", () => {
    expect(fraction(5, 0)).toBe(0);
  });
});

describe("severity", () => {
  test("bands at 70% and 90%", () => {
    expect(severity(10, 100)).toBe("ok");
    expect(severity(69, 100)).toBe("ok");
    expect(severity(70, 100)).toBe("warn");
    expect(severity(89, 100)).toBe("warn");
    expect(severity(90, 100)).toBe("danger");
  });

  test("stays danger past the limit", () => {
    expect(severity(400, 100)).toBe("danger");
  });

  test("an unknown reading is not alarming", () => {
    expect(severity(null, 100)).toBe("ok");
  });
});

describe("nextReset", () => {
  // 2026-07-29T13:45:00Z — mid-day, mid-month, so neither rollover is trivial.
  const now = Date.UTC(2026, 6, 29, 13, 45);

  test("daily is the next UTC midnight, not the next local one", () => {
    expect(nextReset("daily", now)).toBe(Date.UTC(2026, 6, 30));
  });

  test("daily from just before midnight rolls to the next day", () => {
    const late = Date.UTC(2026, 6, 29, 23, 59);
    expect(nextReset("daily", late)).toBe(Date.UTC(2026, 6, 30));
  });

  test("daily rolls the month over", () => {
    expect(nextReset("daily", Date.UTC(2026, 6, 31, 12))).toBe(Date.UTC(2026, 7, 1));
  });

  test("monthly is the first of the next month", () => {
    expect(nextReset("monthly", now)).toBe(Date.UTC(2026, 7, 1));
  });

  test("monthly rolls the year over", () => {
    expect(nextReset("monthly", Date.UTC(2026, 11, 15))).toBe(Date.UTC(2027, 0, 1));
  });

  test("a total ceiling never resets", () => {
    expect(nextReset("none", now)).toBeNull();
  });
});

describe("activeTimeToGbSeconds", () => {
  test("one second of active time is 0.125 GB-s at 128 MB", () => {
    expect(activeTimeToGbSeconds(1_000_000)).toBeCloseTo(0.125, 10);
  });

  test("scales linearly", () => {
    expect(activeTimeToGbSeconds(8_000_000)).toBeCloseTo(1, 10);
  });

  test("zero is zero", () => {
    expect(activeTimeToGbSeconds(0)).toBe(0);
  });
});

describe("formatBytes", () => {
  test("whole bytes carry no decimal", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  test("steps up through the units", () => {
    expect(formatBytes(1024)).toBe("1.00 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.00 GB");
  });

  test("drops to one decimal once the mantissa is large", () => {
    expect(formatBytes(500 * 1024 ** 2)).toBe("500.0 MB");
  });

  test("stops at TB rather than inventing a unit", () => {
    expect(formatBytes(1024 ** 5)).toBe("1024.0 TB");
  });
});

describe("formatValue", () => {
  test("counts are grouped", () => {
    expect(formatValue(1234567, "count")).toBe("1,234,567");
  });

  test("gb-seconds carry their unit", () => {
    expect(formatValue(13000, "gb-seconds")).toBe("13,000 GB-s");
  });

  test("bytes go through formatBytes", () => {
    expect(formatValue(1024, "bytes")).toBe("1.00 KB");
  });
});

describe("formatCountdown", () => {
  test("reads as a duration, not a clock time", () => {
    expect(formatCountdown(3 * 3_600_000 + 12 * 60_000)).toBe("3h 12m");
  });

  test("drops the hours when there are none", () => {
    expect(formatCountdown(45 * 60_000)).toBe("45m");
  });

  test("uses days once past 24 hours", () => {
    expect(formatCountdown(2 * 86_400_000 + 5 * 3_600_000)).toBe("2d 5h");
  });

  test("a lapsed reset reads as now, never as a negative", () => {
    expect(formatCountdown(-1)).toBe("now");
    expect(formatCountdown(0)).toBe("now");
  });
});

describe("LIMITS", () => {
  // These are the numbers every bar is drawn against; a typo in one is
  // invisible on screen but makes the panel lie.
  test("match Cloudflare's published free-tier allowances", () => {
    expect(LIMITS.workersRequestsPerDay).toBe(100_000);
    expect(LIMITS.doRequestsPerDay).toBe(100_000);
    expect(LIMITS.doDurationGbsPerDay).toBe(13_000);
    expect(LIMITS.d1RowsReadPerDay).toBe(5_000_000);
    expect(LIMITS.d1RowsWrittenPerDay).toBe(100_000);
  });

  test("storage ceilings are 5 GB in bytes, not 5e9", () => {
    expect(LIMITS.doStoredBytes).toBe(5_368_709_120);
    expect(LIMITS.d1StoredBytes).toBe(5_368_709_120);
  });
});

describe("barWidth", () => {
  test("a true zero paints nothing", () => {
    expect(barWidth(0, 100)).toBe("0");
  });

  test("an unknown reading paints nothing", () => {
    expect(barWidth(null, 100)).toBe("0");
  });

  test("a tiny but real figure keeps a visible hairline", () => {
    // 41 of 100,000 is 0.041% — zero painted pixels on a 245px track without
    // this, and so indistinguishable from unused on the collapsed strip.
    expect(barWidth(41, 100_000)).toBe("max(2px, 0.041%)");
  });

  test("an ordinary figure is just its percentage", () => {
    expect(barWidth(25, 100)).toBe("max(2px, 25%)");
  });

  test("over the limit pins full, matching fraction's clamp", () => {
    expect(barWidth(150, 100)).toBe("max(2px, 100%)");
  });
});
