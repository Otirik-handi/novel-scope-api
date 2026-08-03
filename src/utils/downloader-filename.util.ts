export function downloaderSafeFsName(name: string): string {
  const replacements: Record<string, string> = {
    ":": "\uFF1A",
    '"': "\uFF02",
    "<": "\u300A",
    ">": "\u300B",
    "/": "\u3001",
    "\\": "\u3001",
    "|": "\uFF5C",
    "?": "\uFF1F",
    "*": "\uFF0A",
  };
  let cleaned = [...name]
    .map((character) =>
      character.charCodeAt(0) < 32
        ? "_"
        : (replacements[character] ?? character),
    )
    .join("");
  cleaned = cleaned.replace(/[ .]+$/g, "");
  if (cleaned.length === 0) cleaned = "unnamed";
  const reserved = new Set([
    "CON", "PRN", "AUX", "NUL",
    ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
    ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
  ]);
  const stem = cleaned.split(".")[0]!.toUpperCase();
  if (reserved.has(stem)) cleaned = `_${cleaned}`;
  const characters = [...cleaned];
  while (
    characters.length > 0 &&
    Buffer.byteLength(characters.join(""), "utf8") > 120
  ) {
    characters.pop();
  }
  cleaned = characters.join("");
  return cleaned.replace(/[ .]+$/g, "") || "unnamed";
}
