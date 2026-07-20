const DISPLAYED_NUMBER_PATTERN =
  /^(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d+)?([万亿])?$/;

const MAX_NUMERIC_TEXT_LENGTH = 128;

const UNIT_DECIMAL_SHIFTS: Record<string, number> = {
  万: 4,
  亿: 8,
};

const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

interface DecimalRatio {
  numerator: bigint;
  denominator: bigint;
}

function parseDecimalRatio(
  input: string,
  decimalShift = 0,
): DecimalRatio | null {
  const match = input.match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);

  if (!match) {
    return null;
  }

  const fraction = (match[2] ?? "").replace(/0+$/, "");
  const exponent = Number(match[3] ?? 0) + decimalShift;
  const digits = `${match[1]}${fraction}`;
  const decimalPlaces = fraction.length - exponent;
  let numerator = BigInt(digits);
  let denominator = 1n;

  if (decimalPlaces >= 0) {
    denominator = 10n ** BigInt(decimalPlaces);
  } else {
    numerator *= 10n ** BigInt(-decimalPlaces);
  }

  return { numerator, denominator };
}

export function parseDisplayedNumber(
  input: string | null | undefined,
): number | null {
  const normalizedInput = input?.trim();

  if (!normalizedInput) {
    return null;
  }

  const possibleUnit = normalizedInput.at(-1);
  const numericInput =
    possibleUnit && possibleUnit in UNIT_DECIMAL_SHIFTS
      ? normalizedInput.slice(0, -1)
      : normalizedInput;
  const normalizedNumericText = numericInput.replaceAll(",", "");

  if (normalizedNumericText.length > MAX_NUMERIC_TEXT_LENGTH) {
    return null;
  }

  const match = normalizedInput.match(DISPLAYED_NUMBER_PATTERN);

  if (!match) {
    return null;
  }

  const unit = match[1];
  const ratio = parseDecimalRatio(
    normalizedNumericText,
    unit ? UNIT_DECIMAL_SHIFTS[unit] : 0,
  );

  if (!ratio) {
    return null;
  }

  if (ratio.numerator > MAX_SAFE_INTEGER * ratio.denominator) {
    return null;
  }

  const result = Number(ratio.numerator) / Number(ratio.denominator);

  if (!Number.isFinite(result)) {
    return null;
  }

  const convertedRatio = parseDecimalRatio(result.toString());

  if (
    !convertedRatio ||
    convertedRatio.numerator * ratio.denominator !==
      ratio.numerator * convertedRatio.denominator
  ) {
    return null;
  }

  return result;
}
