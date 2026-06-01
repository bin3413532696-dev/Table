const DEBUG_URL = 'http://127.0.0.1:9222/json/list';
const PAGE_URL = 'http://127.0.0.1:3266/#/tasks';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTargets() {
  const response = await fetch(DEBUG_URL);
  if (!response.ok) {
    throw new Error(`Failed to load CDP targets: HTTP ${response.status}`);
  }

  return response.json();
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.readyPromise = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });

    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (typeof message.id !== 'number') {
        return;
      }

      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }

      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || 'CDP error'));
      } else {
        pending.resolve(message.result || {});
      }
    });
  }

  async send(method, params = {}) {
    await this.readyPromise;
    const id = ++this.id;
    const payload = { id, method, params };
    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.ws.send(JSON.stringify(payload));
    return result;
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Runtime evaluate failed');
    }

    return result.result?.value;
  }

  close() {
    this.ws.close();
  }
}

function js(value) {
  return JSON.stringify(value);
}

async function waitFor(client, predicate, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await client.evaluate(`(${predicate})()`);
    if (value) {
      return value;
    }
    await sleep(200);
  }

  throw new Error(`Timed out after ${timeout}ms`);
}

async function main() {
  const targets = await fetchTargets();
  const page = targets.find((target) => target.type === 'page' && target.url === PAGE_URL);
  if (!page?.webSocketDebuggerUrl) {
    throw new Error('Task page target not found');
  }

  const client = new CdpClient(page.webSocketDebuggerUrl);

  try {
    await client.send('Page.enable');
    await client.send('Runtime.enable');

    await waitFor(client, `
      () => document.readyState === 'complete' && (document.body.innerText || '').includes('任务')
    `);

    const before = await client.evaluate(`(() => {
      const inputs = Array.from(document.querySelectorAll('input'))
        .filter((element) => element.offsetParent !== null)
        .map((element) => ({
          type: element.type,
          placeholder: element.placeholder || '',
          value: element.value,
          disabled: element.disabled,
        }));
      const buttons = Array.from(document.querySelectorAll('button'))
        .filter((element) => element.offsetParent !== null)
        .map((element) => ({
          text: (element.textContent || '').trim(),
          disabled: element.disabled,
          className: element.className,
        }));
      return { inputs, buttons, bodyText: document.body.innerText };
    })()`);

    await client.evaluate(`(() => {
      if (!window.__codexFetchCalls) {
        window.__codexFetchCalls = [];
        const originalFetch = window.fetch.bind(window);
        window.fetch = async (...args) => {
          const [input, init] = args;
          window.__codexFetchCalls.push({
            input: typeof input === 'string' ? input : String(input),
            method: init?.method || 'GET',
            body: typeof init?.body === 'string' ? init.body : null,
          });
          return originalFetch(...args);
        };
      }
      return true;
    })()`);

    const title = `CDP Task ${Date.now()}`;

    const setResult = await client.evaluate(`(() => {
      const target = Array.from(document.querySelectorAll('input[type="text"]'))
        .find((element) => (element.placeholder || '').includes('输入任务内容'));
      if (!target) {
        return { ok: false, reason: 'input not found' };
      }

      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(target, ${js(title)});
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));

      const button = Array.from(document.querySelectorAll('button'))
        .find((element) => (element.textContent || '').trim() === '添加');

      return {
        ok: true,
        inputValue: target.value,
        buttonFound: Boolean(button),
        buttonDisabled: button ? button.disabled : null,
      };
    })()`);

    await sleep(300);

    const clickResult = await client.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('button'))
        .find((element) => (element.textContent || '').trim() === '添加');
      if (!button) {
        return { ok: false, reason: 'button not found' };
      }
      button.click();
      return { ok: true, disabled: button.disabled, className: button.className };
    })()`);

    await sleep(2000);

    const after = await client.evaluate(`(() => {
      const fetchCalls = window.__codexFetchCalls || [];
      const inputs = Array.from(document.querySelectorAll('input'))
        .filter((element) => element.offsetParent !== null)
        .map((element) => ({
          type: element.type,
          placeholder: element.placeholder || '',
          value: element.value,
          disabled: element.disabled,
        }));
      const alerts = Array.from(document.querySelectorAll('div'))
        .filter((element) => element.offsetParent !== null)
        .map((element) => (element.textContent || '').trim())
        .filter((text) => text.includes('添加') || text.includes('失败') || text.includes('任务'));
      return {
        fetchCalls,
        inputs,
        alerts,
        bodyText: document.body.innerText,
      };
    })()`);

    console.log(JSON.stringify({ before, setResult, clickResult, after }, null, 2));
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
