import type { HistoryScraper, Scraper } from "./types";

// STUB — implementado pelo worker do InfoMoney
export const scrapeInfomoney: Scraper = async (ticker) => {
  throw new Error(`scrapeInfomoney(${ticker}) não implementado`);
};

export const fetchInfomoneyHistory: HistoryScraper = async (ticker) => {
  throw new Error(`fetchInfomoneyHistory(${ticker}) não implementado`);
};
