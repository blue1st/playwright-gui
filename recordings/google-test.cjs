const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://www.google.com/');
  await page.getByRole('link', { name: 'ストア' }).click();
  await page.getByRole('region', { name: 'Horizontal navigation ribbon' }).getByLabel('Pixel 10a を購入').click();
  await page.locator('#p10a-overview-special-color').getByRole('link', { name: 'さらに詳しく' }).click();
  await page.close();

  // ---------------------
  await context.close();
  await browser.close();
})();