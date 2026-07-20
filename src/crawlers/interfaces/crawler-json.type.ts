export type CrawlerJsonValue =
  | string
  | number
  | boolean
  | null
  | CrawlerJsonObject
  | CrawlerJsonValue[];

export interface CrawlerJsonObject {
  [key: string]: CrawlerJsonValue;
}
