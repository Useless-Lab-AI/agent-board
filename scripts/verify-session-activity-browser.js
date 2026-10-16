async page => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  if (page.url() !== 'http://127.0.0.1:4318/' || !await page.evaluate(() => window.__activityArmed)) {
    await page.goto('http://127.0.0.1:4318');
    const card = page.locator('article').filter({ has: page.getByRole('heading', { name: '活动状态合成验收', exact: true }) });
    await card.locator('[data-event-id]').first().waitFor();
    check(await card.locator('[data-state="UNKNOWN"]').textContent() === '状态未知', 'Imported history remains unknown');
    await card.locator('[tabindex="0"]').evaluate(el => { el.scrollTop = 200; el.dispatchEvent(new Event('scroll')); });
    await page.evaluate(() => { window.__activityArmed = true; });
    return { armed: true, next: 'Append one synthetic assistant record, then invoke this script again' };
  }
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: '活动状态合成验收', exact: true }) });
  const badge = card.locator('[data-state="UNKNOWN"]');
  await page.waitForFunction(() => document.querySelector('[data-activity="近期有输出"]'));
  await card.getByRole('button', { name: '查看最新输出' }).waitFor();
  check((await badge.getAttribute('title')).includes('不代表当前进程仍在运行'), 'Observational tooltip');
  check(await card.locator('[tabindex="0"]').evaluate(el => el.scrollTop) === 200, 'Output badge does not move paused reader');
  let eventReads = 0;
  const listener = request => { if (/\/api\/sessions\/[^/]+\/events/.test(request.url())) eventReads++; };
  page.on('request', listener);
  try {
    await page.waitForFunction(() => document.querySelector('[data-activity="暂未更新"]'), {}, { timeout: 36000 });
    check(eventReads === 0, 'Activity expiry must not reload transcript');
    check(await card.locator('[tabindex="0"]').evaluate(el => el.scrollTop) === 200, 'Quiet badge preserves paused reader');
    await page.screenshot({ path: 'docs/session-activity-synthetic.png' });
    return { recentOutput: true, quietAfter30s: true, tooltip: true, pausePreserved: true, eventReadsOnExpiry: eventReads };
  } finally { page.off('request', listener); }
}
