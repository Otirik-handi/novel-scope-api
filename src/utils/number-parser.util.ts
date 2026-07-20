const DISPLAYED_NUMBER_PATTERN =
  /^(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d+)?([万亿])?$/;

const UNIT_MULTIPLIERS: Record<string, bigint> = {
  万: 10_000n,
  亿: 100_000_000n,
};

const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

interface DecimalRatio {
  numerator: bigint;
  denominator: bigint;
}

function reduceDecimalRatio(ratio: DecimalRatio): DecimalRatio {
  while (ratio.denominator > 1n && ratio.numerator % 10n === 0n) {
    ratio.numerator /= 10n;
    ratio.denominator /= 10n;
  }

  return ratio;
}

function parseDecimalRatio(input: string): DecimalRatio | null {
  const match = input.match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);

  if (!match) {
    return null;
  }

  const fraction = match[2] ?? "";
  const exponent = Number(match[3] ?? 0);
  const digits = `${match[1]}${fraction}`;
  const decimalPlaces = fraction.length - exponent;
  let numerator = BigInt(digits);
  let denominator = 1n;

  if (decimalPlaces >= 0) {
    denominator = 10n ** BigInt(decimalPlaces);
  } else {
    numerator *= 10n ** BigInt(-decimalPlaces);
  }

  return reduceDecimalRatio({ numerator, denominator });
}

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
  const ratio = parseDecimalRatio(numericText.replaceAll(",", ""));

  if (!ratio) {
    return null;
  }

  ratio.numerator *= unit ? UNIT_MULTIPLIERS[unit] : 1n;
  reduceDecimalRatio(ratio);

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
