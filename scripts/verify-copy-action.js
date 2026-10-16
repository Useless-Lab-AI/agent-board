async page => {
  const check = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:4318');
  await page.locator('article').first().waitFor();

  // 1. Verify Code Block wrapper and language label
  const codeBlock = page.locator('div[class*="codeBlockWrapper"]').first();
  await codeBlock.waitFor({ timeout: 5000 });
  check((await codeBlock.count()) > 0, 'Code block wrapper exists');

  const langBadge = codeBlock.locator('span[class*="codeBlockLang"]');
  const langText = await langBadge.textContent();
  check(langText === 'typescript', `Language badge shows typescript, got: ${langText}`);

  // 2. Verify Code Block Copy Button
  const copyBtn = codeBlock.locator('button[class*="codeCopyBtn"]');
  check((await copyBtn.count()) === 1, 'Code copy button exists in code block header');
  const initialCopyText = await copyBtn.textContent();
  check(initialCopyText.includes('复制'), `Initial code copy text contains 复制, got: ${initialCopyText}`);

  // Click code copy button
  await copyBtn.click();
  await page.waitForTimeout(100);
  check(
    (await copyBtn.getAttribute('data-copied')) === 'true',
    'Code copy button has data-copied=true after click',
  );
  const copiedText = await copyBtn.textContent();
  check(copiedText.includes('已复制'), `Copied text contains 已复制, got: ${copiedText}`);

  // 3. Verify Message-level Copy Button (复制全文)
  const messageCopyBtn = page.locator('button[class*="messageCopyBtn"]').first();
  await messageCopyBtn.waitFor({ timeout: 5000 });
  check((await messageCopyBtn.count()) > 0, 'Message-level copy button exists');
  const msgCopyText = await messageCopyBtn.textContent();
  check(msgCopyText.includes('复制全文'), `Message copy button text contains 复制全文, got: ${msgCopyText}`);

  // Click message copy button
  await messageCopyBtn.click();
  await page.waitForTimeout(100);
  check(
    (await messageCopyBtn.getAttribute('data-copied')) === 'true',
    'Message copy button has data-copied=true after click',
  );

  // 4. Take screenshot of the card showing conversation with copy button and code block
  const codeCard = page.locator('article').filter({ has: page.locator('div[class*="codeBlockWrapper"]') }).first();
  await codeCard.screenshot({ path: 'docs/code-copy-verified.png' });
  console.log('PASS verify-copy-action: Code block header, language badge, code copy button, and message copy button verified.');
}
