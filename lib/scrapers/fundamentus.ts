import type { Scraper } from "./types";

// STUB — implementado pelo worker do Fundamentus
export const scrapeFundamentus: Scraper = async (ticker) => {
  throw new Error(`scrapeFundamentus(${ticker}) não implementado`);
};
