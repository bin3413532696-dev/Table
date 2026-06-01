const DEBUGGER_URL = 'http://127.0.0.1:9222/json/list';
const PAGE_ORIGIN = 'http://localhost:3266';
const PAGE_URL_PREFIX = `${PAGE_ORIGIN}/`;
const CSRF_COOKIE_NAME = 'table_dev_csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

const cookieJar = new Map();

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${url}`);
  }
  return response.json();
}

function storeCookies(response) {
  const getSetCookie = response.headers.getSetCookie?.bind(response.headers);
  const cookieHeaders = getSetCookie ? getSetCookie() : [];

  for (const header of cookieHeaders) {
    const [cookiePart] = String(header).split(';');
    const separatorIndex = cookiePart.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const name = cookiePart.slice(0, separatorIndex).trim();
    const value = cookiePart.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }

    cookieJar.set(name, value);
  }
}

function buildCookieHeader() {
  return Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

async function ensureCsrfCookie() {
  if (cookieJar.has(CSRF_COOKIE_NAME)) {
    return;
  }

  const response = await fetch(`${PAGE_ORIGIN}/api/auth/me`, {
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error(`GET /api/auth/me failed: HTTP ${response.status}`);
  }

  storeCookies(response);
}

async function requestApi(path, init = {}) {
  const method = (init.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    await ensureCsrfCookie();
  }

  const headers = {
    'Content-Type': 'application/json',
    ...(buildCookieHeader() ? { Cookie: buildCookieHeader() } : {}),
    ...(cookieJar.get(CSRF_COOKIE_NAME) && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
      ? { [CSRF_HEADER_NAME]: cookieJar.get(CSRF_COOKIE_NAME) }
      : {}),
    ...(init.headers || {}),
  };

  const response = await fetch(`${PAGE_ORIGIN}${path}`, {
    credentials: 'same-origin',
    ...init,
    headers,
  });

  storeCookies(response);

  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${payload?.message || response.status}`);
  }
  return payload;
}

async function getPageDebuggerUrl() {
  const targets = await fetchJson(DEBUGGER_URL);
  const pageTarget = targets.find(
    (target) => target.type === 'page' && String(target.url || '').startsWith(PAGE_URL_PREFIX)
  );

  if (!pageTarget?.webSocketDebuggerUrl) {
    throw new Error('No debugger target found for localhost:3266');
  }

  return pageTarget.webSocketDebuggerUrl;
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.openPromise = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });

    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (typeof message.id === 'number' && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          reject(new Error(message.error.message || 'CDP error'));
        } else {
          resolve(message.result || {});
        }
      }
    });
  }

  async ready() {
    await this.openPromise;
  }

  async send(method, params = {}) {
    await this.ready();
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
      throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
    }

    return result.result?.value;
  }

  close() {
    this.ws.close();
  }
}

function toExpression(source) {
  return `(${source})()`;
}

function js(value) {
  return JSON.stringify(value);
}

async function waitFor(cdp, predicateSource, { timeout = 120000, interval = 250 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const matched = await cdp.evaluate(toExpression(predicateSource));
    if (matched) {
      return matched;
    }
    await sleep(interval);
  }

  throw new Error(`waitFor timeout after ${timeout}ms`);
}

async function waitForAppReady(cdp) {
  await waitFor(
    cdp,
    `
      () => document.readyState === 'complete' && location.href.includes('localhost:3266')
    `
  );
}

async function navigateToDashboard(cdp) {
  await cdp.evaluate(
    toExpression(`
      () => {
        window.location.hash = '#/dashboard';
        return window.location.href;
      }
    `)
  );

  await waitFor(
    cdp,
    `
      () => document.readyState === 'complete'
        && location.hash.includes('/dashboard')
        && Array.from(document.querySelectorAll('textarea'))
          .some((element) => element.offsetParent !== null)
    `
  );
}

async function openAgentPanel(cdp) {
  const hasVisibleTextarea = await cdp.evaluate(
    toExpression(`
      () => Array.from(document.querySelectorAll('textarea'))
        .some((element) => element.offsetParent !== null)
    `)
  );

  if (!hasVisibleTextarea) {
    await cdp.evaluate(
      toExpression(`
        () => {
          const trigger = document.querySelector('button[title*="Ctrl+K"]');
          if (trigger) {
            trigger.click();
            return true;
          }

          window.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'k',
            ctrlKey: true,
            bubbles: true,
          }));
          return true;
        }
      `)
    );
  }

  await waitFor(
    cdp,
    `
      () => Array.from(document.querySelectorAll('textarea'))
        .some((element) => element.offsetParent !== null)
    `
  );
}

async function waitForAgentReady(cdp, timeout = 90000) {
  await waitFor(
    cdp,
    `
      () => {
        const visibleTextareas = Array.from(document.querySelectorAll('textarea'))
          .filter((element) => element.offsetParent !== null);
        const textarea = visibleTextareas[visibleTextareas.length - 1];
        return !!textarea && !textarea.disabled;
      }
    `,
    { timeout }
  );
}

async function getPageState(cdp) {
  return cdp.evaluate(
    toExpression(`
      () => {
        const textareas = Array.from(document.querySelectorAll('textarea'))
          .filter((element) => element.offsetParent !== null);
        const textarea = textareas[textareas.length - 1] || null;
        const toolBadges = Array.from(document.querySelectorAll('span'))
          .map((element) => element.textContent?.trim())
          .filter((text) => text && /^[a-z_]+$/.test(text));
        const bodyText = document.body.innerText || '';
        const buttons = Array.from(document.querySelectorAll('button'))
          .filter((element) => element.offsetParent !== null)
          .map((element) => (element.textContent || '').trim())
          .filter(Boolean);

        return {
          bodyText,
          toolBadges,
          textareaDisabled: textarea ? textarea.disabled : null,
          hasVisibleTextarea: !!textarea,
          buttons,
        };
      }
    `)
  );
}

async function sendPrompt(cdp, prompt) {
  const sent = await cdp.evaluate(
    toExpression(`
      () => {
        const textareas = Array.from(document.querySelectorAll('textarea'))
          .filter((element) => element.offsetParent !== null);
        const textarea = textareas[textareas.length - 1];
        if (!textarea || textarea.disabled) {
          return false;
        }

        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value'
        )?.set;
        setter?.call(textarea, ${js(prompt)});
        textarea.dispatchEvent(new Event('input', { bubbles: true }));

        const sendButton = textarea.parentElement?.querySelector('button:last-of-type');
        sendButton?.click();
        return true;
      }
    `)
  );

  if (!sent) {
    throw new Error('Failed to send prompt');
  }
}

async function waitForToolBadge(cdp, toolName, previousCount) {
  await waitFor(
    cdp,
    `
      () => {
        const badgeCount = Array.from(document.querySelectorAll('span'))
          .map((element) => element.textContent?.trim())
          .filter((text) => text === ${js(toolName)}).length;
        const bodyText = document.body.innerText || '';
        return badgeCount > ${previousCount} || bodyText.includes(${js(toolName)});
      }
    `
  );
}

function hasConfirmationButton(buttons) {
  return buttons.some((text) => text.includes('确认') || text.includes('执行') || text.includes('Approve'));
}

async function waitForProcessingStop(cdp) {
  await waitFor(
    cdp,
    `
      () => {
        const textareas = Array.from(document.querySelectorAll('textarea'))
          .filter((element) => element.offsetParent !== null);
        const textarea = textareas[textareas.length - 1];
        const buttons = Array.from(document.querySelectorAll('button'))
          .filter((element) => element.offsetParent !== null)
          .map((element) => (element.textContent || '').trim())
          .filter(Boolean);
        const hasConfirm = buttons.some((text) => text.includes('确认') || text.includes('执行') || text.includes('Approve'));
        return (textarea && !textarea.disabled) || hasConfirm;
      }
    `
  );
}

async function clickConfirmation(cdp) {
  const clicked = await cdp.evaluate(
    toExpression(`
      () => {
        const buttons = Array.from(document.querySelectorAll('button'))
          .filter((element) => element.offsetParent !== null);
        const confirmButton = buttons.find((element) => {
          const text = (element.textContent || '').trim();
          return text.includes('确认') || text.includes('执行') || text.includes('Approve');
        });

        if (!confirmButton) {
          return false;
        }

        confirmButton.click();
        return true;
      }
    `)
  );

  if (!clicked) {
    throw new Error('Confirmation button not found');
  }
}

function hasGenericError(text) {
  return text.includes('处理请求时发生错误') ||
    text.includes('Unexpected server error') ||
    text.includes('Agent runtime unavailable');
}

async function runReadOnlyPrompt(cdp, prompt, toolName) {
  const before = await getPageState(cdp);
  const previousCount = before.toolBadges.filter((badge) => badge === toolName).length;

  await sendPrompt(cdp, prompt);
  await waitForToolBadge(cdp, toolName, previousCount);
  await waitForProcessingStop(cdp);
  await waitForAgentReady(cdp);

  const after = await getPageState(cdp);
  const bodyText = String(after.bodyText || '');
  const toolCalled =
    after.toolBadges.filter((badge) => badge === toolName).length > previousCount ||
    bodyText.includes(toolName);

  return {
    toolCalled,
    hasGenericError: hasGenericError(bodyText),
    bodyText,
  };
}

async function main() {
  const wsUrl = await getPageDebuggerUrl();
  const cdp = new CDPClient(wsUrl);
  const summary = {
    pageUrl: null,
    tests: [],
    failures: [],
  };
  const taskTitle = 'CDP agent smoke task';
  let createdTaskId = null;

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await waitForAppReady(cdp);

    await cdp.evaluate(
      toExpression(`
        () => {
          localStorage.removeItem('user_profile');
          localStorage.removeItem('theme');
          return true;
        }
      `)
    );

    await cdp.send('Page.reload');
    await waitForAppReady(cdp);
    await navigateToDashboard(cdp);
    summary.pageUrl = await cdp.evaluate('location.href');
    await openAgentPanel(cdp);
    await waitForAgentReady(cdp);

    const readOnlyTests = [
      {
        name: 'query_tasks',
        prompt: 'Strictly call query_tasks only and summarize the current tasks. Do not use any other tool.',
      },
      {
        name: 'get_task_stats',
        prompt: 'Strictly call get_task_stats only and summarize the current task stats. Do not use any other tool.',
      },
      {
        name: 'query_finance',
        prompt: 'Strictly call query_finance only and summarize the latest finance records. Do not use any other tool.',
      },
      {
        name: 'get_finance_stats',
        prompt: 'Strictly call get_finance_stats only and summarize the current finance stats. Do not use any other tool.',
      },
    ];

    for (const test of readOnlyTests) {
      const result = await runReadOnlyPrompt(cdp, test.prompt, test.name);
      summary.tests.push({
        test: test.name,
        toolCalled: result.toolCalled,
        hasGenericError: result.hasGenericError,
      });

      if (!result.toolCalled) {
        summary.failures.push(`${test.name}: tool was not called`);
      }
      if (result.hasGenericError) {
        summary.failures.push(`${test.name}: generic error surfaced in the dashboard agent UI`);
      }
    }

    const beforeCreate = await getPageState(cdp);
    const createTaskCount = beforeCreate.toolBadges.filter((badge) => badge === 'create_task').length;

    await sendPrompt(
      cdp,
      `Strictly call create_task only with this JSON:\n\`\`\`json\n{"title":"${taskTitle}","priority":"medium"}\n\`\`\``
    );
    await waitForToolBadge(cdp, 'create_task', createTaskCount);
    await waitForProcessingStop(cdp);

    const pendingCreate = await getPageState(cdp);
    const confirmationVisible = pendingCreate.textareaDisabled === true || hasConfirmationButton(pendingCreate.buttons);

    await clickConfirmation(cdp);
    await waitForAgentReady(cdp);

    const tasksPayload = await requestApi('/api/tasks');
    const createdTask = Array.isArray(tasksPayload?.items)
      ? tasksPayload.items.find((item) => item.title === taskTitle)
      : null;
    createdTaskId = createdTask?.id || null;

    const afterConfirm = await getPageState(cdp);
    summary.tests.push({
      test: 'create_task_confirmation',
      toolCalled: afterConfirm.toolBadges.includes('create_task') || String(afterConfirm.bodyText || '').includes('create_task'),
      confirmationVisible,
      persistedAfterConfirm: Boolean(createdTaskId),
      hasGenericError: hasGenericError(String(afterConfirm.bodyText || '')),
    });

    if (!confirmationVisible) {
      summary.failures.push('create_task_confirmation: confirmation UI did not appear');
    }
    if (!createdTaskId) {
      summary.failures.push('create_task_confirmation: task was not persisted');
    }
    if (hasGenericError(String(afterConfirm.bodyText || ''))) {
      summary.failures.push('create_task_confirmation: generic error surfaced in the dashboard agent UI');
    }
  } finally {
    if (createdTaskId) {
      await requestApi(`/api/tasks/${createdTaskId}`, {
        method: 'DELETE',
      }).catch(() => undefined);
    }

    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = summary.failures.length > 0 ? 1 : 0;
    cdp.close();
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
