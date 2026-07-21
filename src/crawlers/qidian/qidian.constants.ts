import type { RankType } from "../interfaces";

export const QIDIAN_BASE_URL = "https://www.qidian.com";

export const QIDIAN_RANKING_PATHS = {
  yuepiao: "/rank/yuepiao/",
  hotsales: "/rank/hotsales/",
  recom: "/rank/recom/",
  collect: "/rank/collect/",
} as const satisfies Record<RankType, string>;

export const QIDIAN_BOOK_PATH_PREFIX = "/book/";
export const QIDIAN_MAX_CONTENT_LENGTH_BYTES = 5 * 1024 * 1024;
export const QIDIAN_MAX_REDIRECTS = 5;

export const QIDIAN_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";
export const QIDIAN_ACCEPT_LANGUAGE =
  "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6";

export const QIDIAN_CACHE_CONTROL = "max-age=0";
export const QIDIAN_REFERER = "https://www.qidian.com/";
export const QIDIAN_SEC_FETCH_DEST = "document";
export const QIDIAN_SEC_FETCH_MODE = "navigate";
export const QIDIAN_SEC_FETCH_SITE = "same-origin";
export const QIDIAN_SEC_FETCH_USER = "?1";
export const QIDIAN_UPGRADE_INSECURE_REQUESTS = "1";
export const QIDIAN_SEC_CH_UA =
  '"Not;A=Brand";v="8", "Chromium";v="150", "Microsoft Edge";v="150"';
export const QIDIAN_SEC_CH_UA_MOBILE = "?0";
export const QIDIAN_SEC_CH_UA_PLATFORM = '"Windows"';
