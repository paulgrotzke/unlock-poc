export const decideUnlocked = (
  myCount: number,
  theirCount: number,
  threshold: number
): boolean => {
  if (threshold <= 0) {
    return true;
  }

  return myCount >= threshold && theirCount >= threshold;
};
