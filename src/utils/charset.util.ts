import iconv from "iconv-lite";

const DEFAULT_CHARSET = "utf-8";
const CONTENT_TYPE_PATTERN =
  /^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+(?:\s*;.*)?$/i;

function extractCharset(declaration?: string): string {
  const normalizedDeclaration = declaration?.trim();

  if (!normalizedDeclaration) {
    return DEFAULT_CHARSET;
  }

  const charsetMatch = normalizedDeclaration.match(
    /(?:^|;)\s*charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i,
  );

  if (charsetMatch) {
    return (charsetMatch[1] ?? charsetMatch[2] ?? charsetMatch[3]).trim();
  }

  if (CONTENT_TYPE_PATTERN.test(normalizedDeclaration)) {
    return DEFAULT_CHARSET;
  }

  return normalizedDeclaration.replace(/^(?:"([^"]+)"|'([^']+)')$/, "$1$2");
}

export function decodeBuffer(
  input: Buffer | Uint8Array,
  charsetDeclaration?: string,
): string {
  const charset = extractCharset(charsetDeclaration);

  if (!iconv.encodingExists(charset)) {
    throw new Error(`Unsupported charset "${charset}"`);
  }

  return iconv.decode(Buffer.from(input), charset);
}
