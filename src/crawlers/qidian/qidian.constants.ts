import type { RankType } from "../interfaces";

export const QIDIAN_BASE_URL = "https://www.qidian.com";

export const QIDIAN_RANKING_PATHS = {
  yuepiao: "/rank/yuepiao/",
  hotsales: "/rank/hotsales/",
  recom: "/rank/recom/",
  collect: "/rank/collect/",
} as const satisfies Record<RankType, string>;

export const QIDIAN_BOOK_PATH_PREFIX = "/book/";

export const QIDIAN_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
export const QIDIAN_ACCEPT_LANGUAGE = "zh-CN,zh;q=0.9,en;q=0.7";
