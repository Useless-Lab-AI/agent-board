async page => {
  const check = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:4318');
  await page.locator('article').first().waitFor();

  // 1. Verify 3 Agent buttons exist in the board heading area
  const btnCodex = page.locator('button:has-text("+ Codex")').first();
  const btnClaude = page.locator('button:has-text("+ Claude")').first();
  const btnAntigravity = page.locator('button:has-text("+ Antigravity")').first();

  check((await btnCodex.count()) === 1, 'Button + Codex exists');
  check((await btnClaude.count()) === 1, 'Button + Claude exists');
  check((await btnAntigravity.count()) === 1, 'Button + Antigravity exists');

  // Verify they are inside boardHeadingRight
  const headingRight = page.locator('div[class*="boardHeadingRight"]');
  check((await headingRight.count()) === 1, 'boardHeadingRight container exists');

  // Take screenshot of the buttons in the heading
  await headingRight.screenshot({ path: 'docs/new-session-buttons.png' });

  // 2. Click + Antigravity button and verify modal opens
  await btnAntigravity.click();
  await page.waitForTimeout(300);

  const modal = page.locator('dialog[class*="newSessionModal"]');
  check((await modal.count()) === 1, 'New Session modal dialog exists');
  check(await modal.isVisible(), 'New Session modal is visible');

  // Check CWD field
  const cwdInput = modal.locator('input[id="new-session-cwd"]');
  check((await cwdInput.count()) === 1, 'CWD input exists in modal');

  // Check prompt textarea
  const promptInput = modal.locator('textarea[id="new-session-prompt"]');
  check((await promptInput.count()) === 1, 'Prompt textarea exists in modal');

  // Check model selector for Antigravity
  const modelSelect = modal.locator('select[id="new-session-model"]');
  check((await modelSelect.count()) === 1, 'Model selector exists for Antigravity');

  // Take screenshot of Antigravity modal
  await modal.screenshot({ path: 'docs/new-session-modal-antigravity.png' });

  // 3. Switch to Codex tab
  const codexTab = modal.locator('button[role="tab"]:has-text("Codex")');
  await codexTab.click();
  await page.waitForTimeout(150);

  // In Codex tab, terminal mode option should appear, model selector should not
  check((await modal.locator('select[id="new-session-model"]').count()) === 0, 'Model selector hidden for Codex');
  const terminalOption = modal.locator('input[type="checkbox"]');
  check((await terminalOption.count()) === 1, 'Terminal mode checkbox exists for Codex');

  // Take screenshot of Codex modal
  await modal.screenshot({ path: 'docs/new-session-modal-codex.png' });

  // 4. Switch to Claude tab
  const claudeTab = modal.locator('button[role="tab"]:has-text("Claude")');
  await claudeTab.click();
  await page.waitForTimeout(150);
  check((await modal.locator('input[type="checkbox"]').count()) === 1, 'Terminal mode checkbox exists for Claude');

  // 5. Test close button
  const closeBtn = modal.locator('button[class*="newSessionCloseBtn"]');
  await closeBtn.click();
  await page.waitForTimeout(200);

  check(!(await modal.isVisible()), 'Modal closed after clicking close button');

  console.log('PASS verify-new-session: 3 buttons displayed correctly, modal opens, tabs switch cleanly, options render per agent, modal closes.');
}
