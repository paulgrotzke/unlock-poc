import { describe, expect, it } from "vitest";

import { decideUnlocked } from "./unlock";

describe("decideUnlocked", () => {
  it("unlocks when threshold is 0", () => {
    expect(decideUnlocked(0, 0, 0)).toBe(true);
    expect(decideUnlocked(0, 10, 0)).toBe(true);
    expect(decideUnlocked(10, 0, 0)).toBe(true);
  });

  it("unlocks at exact threshold", () => {
    expect(decideUnlocked(3, 3, 3)).toBe(true);
  });

  it("locks when either side is below threshold", () => {
    expect(decideUnlocked(2, 3, 3)).toBe(false);
    expect(decideUnlocked(3, 2, 3)).toBe(false);
  });

  it("locks for asymmetric counts even if one side exceeds", () => {
    expect(decideUnlocked(100, 0, 3)).toBe(false);
    expect(decideUnlocked(0, 100, 3)).toBe(false);
  });
});
