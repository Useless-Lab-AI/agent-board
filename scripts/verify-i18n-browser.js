async page => {
  const check = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  // Ensure fresh start without lingering storage
  await page.goto('http://127.0.0.1:4318');
  await page.evaluate(() => localStorage.removeItem('agent-board-locale'));
  await page.reload();
  await page.locator('article').first().waitFor();

  // 1. Verify default Simplified Chinese state
  check(
    (await page.evaluate(() => document.documentElement.lang)) === 'zh-CN',
    'Default HTML lang is zh-CN',
  );
  check(
    await page.title().then(t => t.includes('会话看板')),
    'Default title contains 会话看板',
  );
  check(
    (await page.locator('header p').first().textContent()) === '原生会话 · 同屏掌握',
    'Default Chinese brand subtitle',
  );
  check(
    (await page.getByRole('button', { name: '会话看板', exact: true }).count()) === 1,
    'Tab says 会话看板',
  );
  check(
    (await page.getByRole('button', { name: '已收纳会话', exact: true }).count()) === 1,
    'Tab says 已收纳会话',
  );
  check(
    (await page.locator('select[aria-label="语言"]').inputValue()) === 'zh-CN',
    'Language select value is zh-CN',
  );

  // 2. Switch to Traditional Chinese (zh-TW)
  await page.locator('select[aria-label="语言"]').selectOption('zh-TW');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-TW');
  check(
    (await page.locator('header p').first().textContent()) === '原生會話 · 同屏掌握',
    'Traditional Chinese brand subtitle',
  );
  check(
    (await page.getByRole('button', { name: '已收納會話', exact: true }).count()) === 1,
    'Tab says 已收納會話 in zh-TW',
  );
  check(
    (await page.getByRole('combobox', { name: '來源', exact: true }).count()) === 1,
    'Source filter labeled 來源 in zh-TW',
  );
  check(
    (await page.evaluate(() => localStorage.getItem('agent-board-locale'))) === 'zh-TW',
    'zh-TW saved to localStorage',
  );

  // 3. Switch to Japanese (ja-JP)
  await page.locator('select[aria-label="語言"]').selectOption('ja-JP');
  await page.waitForFunction(() => document.documentElement.lang === 'ja');
  check(
    await page.title().then(t => t.includes('セッション看板')),
    'Japanese title contains セッション看板',
  );
  check(
    (await page.locator('header p').first().textContent()) ===
      'ネイティブセッション · 一画面で把握',
    'Japanese brand subtitle',
  );
  check(
    (await page.getByRole('button', { name: 'セッション看板', exact: true }).count()) === 1,
    'Tab says セッション看板 in Japanese',
  );
  check(
    (await page.getByRole('button', { name: '保管済みセッション', exact: true }).count()) === 1,
    'Tab says 保管済みセッション in Japanese',
  );
  check(
    (await page.getByRole('combobox', { name: 'ソース', exact: true }).count()) === 1,
    'Source filter labeled ソース in Japanese',
  );
  check(
    (await page.getByRole('combobox', { name: 'ステータス', exact: true }).count()) === 1,
    'Status filter labeled ステータス in Japanese',
  );
  check(
    (await page.evaluate(() => localStorage.getItem('agent-board-locale'))) === 'ja-JP',
    'ja-JP saved to localStorage',
  );

  // 4. Switch to English
  await page.locator('select[aria-label="言語"]').selectOption('en-US');
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  check(
    await page.title().then(t => t.includes('Session Dashboard')),
    'English title contains Session Dashboard',
  );
  check(
    (await page.locator('header p').first().textContent()) ===
      'Native Sessions · All in One View',
    'English brand subtitle',
  );
  check(
    (await page.getByRole('button', { name: 'Active Board', exact: true }).count()) === 1,
    'Tab says Active Board',
  );
  check(
    (await page.getByRole('button', { name: 'Stowed Sessions', exact: true }).count()) === 1,
    'Tab says Stowed Sessions',
  );
  check(
    (await page.getByRole('combobox', { name: 'Source', exact: true }).count()) === 1,
    'Source filter labeled Source',
  );
  check(
    (await page.getByRole('combobox', { name: 'Status', exact: true }).count()) === 1,
    'Status filter labeled Status',
  );
  check(
    (await page.getByRole('button', { name: 'Refresh sessions', exact: true }).count()) === 1,
    'Refresh button in English',
  );
  check(
    (await page.evaluate(() => localStorage.getItem('agent-board-locale'))) === 'en-US',
    'Locale saved to localStorage',
  );

  // 5. Reload page and verify persistence
  await page.reload();
  await page.locator('article').first().waitFor();
  check(
    (await page.evaluate(() => document.documentElement.lang)) === 'en',
    'English persisted after reload',
  );
  check(
    (await page.locator('header p').first().textContent()) ===
      'Native Sessions · All in One View',
    'Subtitle remains English',
  );

  // 6. Switch back to Simplified Chinese
  await page.locator('select[aria-label="Language"]').selectOption('zh-CN');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  check(
    (await page.locator('header p').first().textContent()) === '原生会话 · 同屏掌握',
    'Restored to Simplified Chinese',
  );
  check(
    (await page.getByRole('button', { name: '会话看板', exact: true }).count()) === 1,
    'Tab restored to 会话看板',
  );
  check(
    (await page.evaluate(() => localStorage.getItem('agent-board-locale'))) === 'zh-CN',
    'zh-CN saved to localStorage',
  );

  // 7. Test mobile responsive layout with language selector (375x812)
  await page.setViewportSize({ width: 375, height: 812 });
  check(
    (await page.evaluate(() => document.documentElement.scrollWidth <= 375)),
    'No horizontal overflow at 375px with 4-language selector',
  );

  // Clean up localStorage for subsequent tests
  await page.evaluate(() => localStorage.removeItem('agent-board-locale'));

  console.log(
    'PASS i18n browser: zh-CN (default), zh-TW, ja-JP, en-US, reload persistence, restore to zh-CN, mobile 375px geometry',
  );
}
