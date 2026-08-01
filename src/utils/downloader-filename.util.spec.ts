import { downloaderSafeFsName } from "./downloader-filename.util";

describe("downloaderSafeFsName", () => {
  it("escapes Windows reserved device names with extensions", () => {
    expect(downloaderSafeFsName("CON.txt")).toBe("_CON.txt");
    expect(downloaderSafeFsName("NUL.txt")).toBe("_NUL.txt");
  });

  it("truncates UTF-8 bytes without splitting a surrogate pair", () => {
    const input = "a".repeat(117) + "\u{1F600}";
    const result = downloaderSafeFsName(input);

    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(120);
    expect(
      [...result].some(
        (character) =>
          character.charCodeAt(0) >= 0xd800 &&
          character.charCodeAt(0) <= 0xdbff,
      ),
    ).toBe(false);
  });
});
