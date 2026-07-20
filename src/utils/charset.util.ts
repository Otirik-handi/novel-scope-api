import iconv from "iconv-lite";

const DEFAULT_CHARSET = "utf-8";
const MIME_TYPE_PATTERN = /^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/i;
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

  const [mimeType, ...parameterDeclarations] = normalizedDeclaration
    .split(";")
    .map((part) => part.trim());

  if (!MIME_TYPE_PATTERN.test(mimeType)) {
    return DEFAULT_CHARSET;
  }

  const parameters = parameterDeclarations.map((parameter) =>
    parameter.match(PARAMETER_PATTERN),
  );

  if (parameters.some((parameter) => !parameter)) {
    return DEFAULT_CHARSET;
  }

  const charsetParameter = parameters.find(
    (parameter) => parameter?.[1].toLowerCase() === "charset",
  );

  return charsetParameter
    ? (charsetParameter[2] ?? charsetParameter[3] ?? charsetParameter[4])
    : DEFAULT_CHARSET;
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
