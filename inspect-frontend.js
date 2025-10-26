const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Capture console messages
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  // Capture network errors
  page.on('requestfailed', request => {
    console.log('NETWORK ERROR:', request.url(), request.failure().errorText);
  });

  page.on('request', request => {
    const url = request.url();
    if (!url.startsWith('http://localhost:8787')) {
      return;
    }
    console.log('BACKEND REQUEST:', request.method(), url);
  });

  page.on('response', async response => {
    const url = response.url();
    if (!url.startsWith('http://localhost:8787')) {
      return;
    }
    const status = response.status();
    console.log('BACKEND RESPONSE:', status, url);
    if (status >= 400) {
      const contentType = response.headers()['content-type'] ?? '';
      if (!contentType.includes('text/event-stream')) {
        try {
          const text = await response.text();
          console.log('RESPONSE BODY:', text.slice(0, 500));
        } catch (error) {
          console.log('FAILED TO READ RESPONSE BODY:', String(error));
        }
      }
    }
  });

  // Capture page errors
  page.on('pageerror', error => {
    console.log('PAGE ERROR:', error.message);
  });

  try {
    console.log('Navigating to http://localhost:5173/...');
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 10000 });

    const streamingEnabled = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const target = buttons.find(btn => (btn.textContent ?? '').toLowerCase().includes('streaming'));
      if (!target) {
        return false;
      }
      if (target.classList.contains('active')) {
        return true;
      }
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    });
    console.log(streamingEnabled ? 'Streaming mode enabled.' : 'Streaming mode toggle not found.');
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('\n=== Taking screenshot ===');
    await page.screenshot({ path: '/home/azureuser/agent-rag/frontend-screenshot.png', fullPage: true });
    console.log('Screenshot saved to frontend-screenshot.png');

    console.log('\n=== Checking for error messages in UI ===');
    const errorText = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('*'));
      const errors = elements.filter(el => {
        const text = el.textContent || '';
        return text.toLowerCase().includes('error') && el.children.length === 0;
      }).map(el => el.textContent.trim()).filter(t => t.length < 200);
      return [...new Set(errors)];
    });
    console.log('Error messages found:', errorText);

    console.log('\n=== Checking network requests ===');
    const requests = await page.evaluate(() => {
      return window.performance.getEntries()
        .filter(e => e.entryType === 'resource')
        .map(e => ({ name: e.name, duration: e.duration }));
    });
    console.log('Network requests:', requests.slice(0, 10));

    console.log('\n=== Attempting to send a test message ===');
    await page.waitForSelector('textarea, input[type="text"]', { timeout: 5000 });
    const input = await page.$('textarea');
    if (input) {
      await input.type('test message');
      console.log('Typed test message');

      // Look for send button
      const buttons = await page.$$('button');
      for (const button of buttons) {
        const text = await button.evaluate(el => el.textContent);
        if (text && (text.includes('Send') || text.includes('→') || text.toLowerCase().includes('send'))) {
          console.log('Clicking send button...');
          await button.click();

          // Wait a bit and check for response
          await new Promise(resolve => setTimeout(resolve, 10000));

          const statusText = await page.evaluate(() => document.querySelector('.status')?.textContent ?? '');
          console.log('Activity status text:', statusText.trim());

          const toastText = await page.evaluate(() => {
            const toastRoot = document.querySelector('[data-sonner-toast], [data-testid="toast"]');
            if (!toastRoot) return null;
            return toastRoot.textContent;
          });
          if (toastText) {
            console.log('Toast message:', toastText.trim());
          }

          const errorPills = await page.evaluate(() => Array.from(document.querySelectorAll('.chat-error, .error')).map(el => el.textContent?.trim()).filter(Boolean));
          if (errorPills.length) {
            console.log('Error elements:', errorPills);
          }

          break;
        }
      }
    }

    console.log('\n=== Final page content check ===');
    const pageText = await page.evaluate(() => document.body.innerText);
    if (pageText.toLowerCase().includes('error')) {
      console.log('Page contains error text');
      const errorLines = pageText.split('\n').filter(line => line.toLowerCase().includes('error'));
      console.log('Error lines:', errorLines.slice(0, 5));
    }

  } catch (error) {
    console.error('Script error:', error.message);
  } finally {
    await browser.close();
  }
})();
