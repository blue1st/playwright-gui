const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: process.env.PW_HEADLESS === "1" });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://www.hatena.ne.jp/');

  // Extract text from a
  const text_667 = await page.innerText('a');
  console.log('Value of a:', text_341);
  // Extract text from a
  const text_349 = await page.innerText('a');
  console.log('Value of a:', text_498);