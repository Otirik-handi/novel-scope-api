import { load } from "cheerio";

const BLOCK_ELEMENTS = [
  "address",
  "article",
  "aside",
  "blockquote",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tr",
  "ul",
].join(",");

export function normalizePlainText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeHtmlText(input: string): string {
  const $ = load(input, null, false);

  $("script,style,noscript").remove();
  $("br").replaceWith("\n");
  $(BLOCK_ELEMENTS).each((_, element) => {
    $(element).before("\n").after("\n");
  });

  return normalizePlainText($.root().text().replace(/\n{2,}/g, "\n"));
}
