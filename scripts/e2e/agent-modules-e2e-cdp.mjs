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

  const response = await fetch(`${PAGE_ORIGIN}${path}`, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(buildCookieHeader() ? { Cookie: buildCookieHeader() } : {}),
      ...(cookieJar.get(CSRF_COOKIE_NAME) && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
        ? { [CSRF_HEADER_NAME]: cookieJar.get(CSRF_COOKIE_NAME) }
        : {}),
      ...(init.headers || {}),
    },
    ...init,
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
        const textareas = Array.from(document.querySelectorAll('textarea'))
          .filter((element) => element.offsetParent !== null);
        const textarea = textareas[textareas.length - 1];
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
        const bodyText = document.body.innerText || '';
        const buttons = Array.from(document.querySelectorAll('button'))
          .filter((element) => element.offsetParent !== null)
          .map((element) => (element.textContent || '').trim())
          .filter(Boolean);
        const toolBadges = Array.from(document.querySelectorAll('span'))
          .map((element) => (element.textContent || '').trim())
          .filter((text) => text && /^[a-z_]+$/.test(text));

        return {
          bodyText,
          buttons,
          toolBadges,
          textareaDisabled: textarea ? textarea.disabled : null,
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

async function waitForConfirmationButton(cdp) {
  await waitFor(
    cdp,
    `
      () => {
        const buttons = Array.from(document.querySelectorAll('button'))
          .filter((element) => element.offsetParent !== null)
          .map((element) => (element.textContent || '').trim())
          .filter(Boolean);
        return buttons.some((text) => text.includes('确认') || text.includes('执行') || text.includes('Approve'));
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

async function runPrompt(cdp, prompt, { expectTool, confirm = false } = {}) {
  const before = await getPageState(cdp);
  const previousCount = expectTool
    ? before.toolBadges.filter((badge) => badge === expectTool).length
    : 0;

  await sendPrompt(cdp, prompt);
  await waitForProcessingStop(cdp);

  if (confirm) {
    await waitForConfirmationButton(cdp);
    await clickConfirmation(cdp);
    await waitForAgentReady(cdp);
  } else {
    await waitForAgentReady(cdp, 30000);
  }

  const after = await getPageState(cdp);
  const bodyText = String(after.bodyText || '');
  const toolCalled = expectTool
    ? after.toolBadges.filter((badge) => badge === expectTool).length > previousCount || bodyText.includes(expectTool)
    : true;

  return {
    before,
    after,
    bodyText,
    toolCalled,
    hasGenericError: hasGenericError(bodyText),
  };
}

async function main() {
  const wsUrl = await getPageDebuggerUrl();
  const cdp = new CDPClient(wsUrl);
  const suffix = Date.now().toString(36);
  const taskTitle = `Authority Test Task ${suffix}`;
  let createdTaskId = null;

  const summary = {
    pageUrl: null,
    tests: [],
    failures: [],
  };

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await waitForAppReady(cdp);
    await cdp.send('Page.reload');
    await waitForAppReady(cdp);

    await cdp.evaluate(
      toExpression(`
        () => {
          window.localStorage.removeItem('theme');
          return true;
        }
      `)
    );

    await navigateToDashboard(cdp);
    summary.pageUrl = await cdp.evaluate('location.href');
    await openAgentPanel(cdp);
    await waitForAgentReady(cdp);

    const readOnlyTests = [
      {
        test: 'query_tasks',
        prompt: 'Strictly call query_tasks only and summarize the current tasks. Do not use any other tool.',
        tool: 'query_tasks',
      },
      {
        test: 'get_task_stats',
        prompt: 'Strictly call get_task_stats only and summarize the current task stats. Do not use any other tool.',
        tool: 'get_task_stats',
      },
      {
        test: 'query_finance',
        prompt: 'Strictly call query_finance only and summarize the latest finance records. Do not use any other tool.',
        tool: 'query_finance',
      },
      {
        test: 'get_finance_stats',
        prompt: 'Strictly call get_finance_stats only and summarize the current finance stats. Do not use any other tool.',
        tool: 'get_finance_stats',
      },
      {
        test: 'search_knowledge',
        prompt: 'Strictly call search_knowledge only and search for notes related to smoke. Do not use any other tool.',
        tool: 'search_knowledge',
      },
    ];

    for (const test of readOnlyTests) {
      const result = await runPrompt(cdp, test.prompt, { expectTool: test.tool });
      summary.tests.push({
        test: test.test,
        toolCalled: result.toolCalled,
        hasGenericError: result.hasGenericError,
      });
      if (!result.toolCalled) {
        summary.failures.push(`${test.test}: tool was not called`);
      }
      if (result.hasGenericError) {
        summary.failures.push(`${test.test}: generic error surfaced in the dashboard agent UI`);
      }
    }

    const createTaskResult = await runPrompt(
      cdp,
      `Strictly call create_task only with this JSON:\n\`\`\`json\n{"title":"${taskTitle}","priority":"medium"}\n\`\`\``,
      { expectTool: 'create_task', confirm: true }
    );
    const tasksPayload = await requestApi('/api/tasks');
    const createdTask = Array.isArray(tasksPayload?.items)
      ? tasksPayload.items.find((item) => item.title === taskTitle)
      : null;
    createdTaskId = createdTask?.id || null;

    summary.tests.push({
      test: 'create_task',
      toolCalled: createTaskResult.toolCalled,
      persisted: Boolean(createdTaskId),
      hasGenericError: createTaskResult.hasGenericError,
    });
    if (!createTaskResult.toolCalled) {
      summary.failures.push('create_task: tool was not called');
    }
    if (!createdTaskId) {
      summary.failures.push('create_task: task was not persisted');
    }
    if (createTaskResult.hasGenericError) {
      summary.failures.push('create_task: generic error surfaced in the dashboard agent UI');
    }

    if (createdTaskId) {
      const deleteTaskResult = await runPrompt(
        cdp,
        `Strictly call delete_task only with this JSON:\n\`\`\`json\n{"id":"${createdTaskId}"}\n\`\`\``,
        { expectTool: 'delete_task', confirm: true }
      );

      const tasksAfterDelete = await requestApi('/api/tasks');
      const stillExists = Array.isArray(tasksAfterDelete?.items)
        ? tasksAfterDelete.items.some((item) => item.id === createdTaskId)
        : false;

      summary.tests.push({
        test: 'delete_task',
        toolCalled: deleteTaskResult.toolCalled,
        removed: !stillExists,
        hasGenericError: deleteTaskResult.hasGenericError,
      });
      if (!deleteTaskResult.toolCalled) {
        summary.failures.push('delete_task: tool was not called');
      }
      if (stillExists) {
        summary.failures.push('delete_task: task still exists after confirmation');
      } else {
        createdTaskId = null;
      }
      if (deleteTaskResult.hasGenericError) {
        summary.failures.push('delete_task: generic error surfaced in the dashboard agent UI');
      }
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
