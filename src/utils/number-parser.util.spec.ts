import { parseDisplayedNumber } from "./number-parser.util";

describe("parseDisplayedNumber", () => {
  it.each([
    ["1234", 1_234],
    [" 1234 ", 1_234],
    ["12.5", 12.5],
  ])("parses an ordinary number: %s", (source, expected) => {
    expect(parseDisplayedNumber(source)).toBe(expected);
  });

  it("parses a correctly grouped number with commas", () => {
    expect(parseDisplayedNumber("1,234,567")).toBe(1_234_567);
  });

  it.each([
    ["1.2万", 12_000],
    ["2万", 20_000],
    ["1.5亿", 150_000_000],
  ])("parses a number with a Chinese unit: %s", (source, expected) => {
    expect(parseDisplayedNumber(source)).toBe(expected);
  });

  it.each(["", "   ", "not-a-number", "12,34", "1.2万次", "NaN"])(
    "returns null for invalid input: %j",
    (source) => {
      expect(parseDisplayedNumber(source)).toBeNull();
    },
  );

  it.each([null, undefined])("returns null for missing input: %s", (source) => {
    expect(parseDisplayedNumber(source)).toBeNull();
  });

  it("rejects results outside the safe integer range", () => {
    expect(parseDisplayedNumber("9007199254740991")).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(parseDisplayedNumber("9007199254740992")).toBeNull();
    expect(parseDisplayedNumber("900719925474.1万")).toBeNull();
  });
});
