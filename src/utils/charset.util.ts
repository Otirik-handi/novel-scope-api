import { MIMEType } from "node:util";
import iconv from "iconv-lite";

const DEFAULT_CHARSET = "utf-8";
const TOKEN_PATTERN = /^[\w!#$%&'*+.^_`|~-]+$/;
const PARAMETER_PATTERN =
  /^([\w!#$%&'*+.^_`|~-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([\w!#$%&'*+.^_`|~-]+))$/;

function removeMatchingQuotes(value: string): string {
  const match = value.match(/^(?:"([^"]*)"|'([^']*)')$/);

  return match ? (match[1] ?? match[2]) : value;
}

function extractCharset(declaration?: string): string {
  const normalizedDeclaration = declaration?.trim();

  if (!normalizedDeclaration) {
    return DEFAULT_CHARSET;
  }

  const bareCharset = removeMatchingQuotes(normalizedDeclaration);

  if (TOKEN_PATTERN.test(bareCharset)) {
    return bareCharset;
  }

  const independentCharset = normalizedDeclaration.match(PARAMETER_PATTERN);

  if (independentCharset?.[1].toLowerCase() === "charset") {
    return (
      independentCharset[2] ?? independentCharset[3] ?? independentCharset[4]
    );
  }

  try {
    const mimeType = new MIMEType(normalizedDeclaration);

    return mimeType.params.get("charset") ?? DEFAULT_CHARSET;
  } catch {
    return DEFAULT_CHARSET;
  }
}

export function decodeBuffer(
  input: Buffer | Uint8Array,
  charsetDeclaration?: string,
): string {
  const charset = extractCharset(charsetDeclaration);

  if (!iconv.encodingExists(charset)) {
    throw new Error("Unsupported charset");
  }

  return iconv.decode(Buffer.from(input), charset);
}
