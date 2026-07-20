const DISPLAYED_NUMBER_PATTERN =
  /^(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d+)?([万亿])?$/;

const UNIT_MULTIPLIERS: Record<string, number> = {
  万: 10_000,
  亿: 100_000_000,
};

export function parseDisplayedNumber(
  input: string | null | undefined,
): number | null {
  const normalizedInput = input?.trim();

  if (!normalizedInput) {
    return null;
  }

  const match = normalizedInput.match(DISPLAYED_NUMBER_PATTERN);

  if (!match) {
    return null;
  }

  const unit = match[1];
  const numericText = unit
    ? normalizedInput.slice(0, -unit.length)
    : normalizedInput;
  const value = Number(numericText.replaceAll(",", ""));
  const result = value * (unit ? UNIT_MULTIPLIERS[unit] : 1);

  if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER) {
    return null;
  }

  return result;
}
