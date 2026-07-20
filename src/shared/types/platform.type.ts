export const SUPPORTED_PLATFORMS = ["qidian"] as const;

export type Platform = (typeof SUPPORTED_PLATFORMS)[number];
