import "server-only";
import type { Browser } from "puppeteer-core";

export const FUNDAMENTUS_DETAILS_URL = "https://fundamentus.com.br/detalhes.php?papel=";

const NAV_TIMEOUT_MS = 30_000;
const VIEWPORT = { width: 1280, height: 900, deviceScaleFactor: 1 };
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

async function launchBrowser(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default;

  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default;
    chromium.setGraphicsMode = false;
    return puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
      executablePath: await chromium.executablePath(),
      headless: "shell",
      defaultViewport: VIEWPORT,
    });
  }

  const executablePath = process.env.CHROME_EXECUTABLE_PATH;
  if (!executablePath) {
    throw new Error(
      "CHROME_EXECUTABLE_PATH não definido: informe o caminho do Chrome/Chromium local para tirar prints.",
    );
  }
  return puppeteer.launch({
    executablePath,
    headless: true,
    defaultViewport: VIEWPORT,
    args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--lang=pt-BR"],
  });
}

/** Tira um print (PNG, página inteira) de uma URL. Sempre fecha o browser. */
export async function screenshotUrl(url: string): Promise<Uint8Array> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent({ userAgent: USER_AGENT });
    await page.setExtraHTTPHeaders({ "Accept-Language": "pt-BR,pt;q=0.9" });
    page.setDefaultTimeout(NAV_TIMEOUT_MS);
    await page.goto(url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
    const png = await page.screenshot({ type: "png", fullPage: true });
    return png;
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Print da página de detalhes do Fundamentus para o ticker. */
export async function screenshotFundamentus(ticker: string): Promise<Uint8Array> {
  const t = ticker.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(t)) throw new Error(`Ticker inválido: "${ticker}"`);
  return screenshotUrl(FUNDAMENTUS_DETAILS_URL + encodeURIComponent(t));
}
