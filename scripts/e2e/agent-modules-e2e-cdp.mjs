const DEBUGGER_URL = 'http://127.0.0.1:9222/json/list';
const PAGE_ORIGIN = 'http://localhost:3266';
const PAGE_URL_PREFIX = `${PAGE_ORIGIN}/`;

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

async function requestApi(path, init = {}) {
  const response = await fetch(`${PAGE_ORIGIN}${path}`, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    ...init,
  });

  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    throw new Error(`${init.method || 'GET'} ${path} failed: ${payload?.message || response.status}`);
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

async function openAgentPanel(cdp) {
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

  await waitFor(
    cdp,
    `
      () => {
        const textareas = Array.from(document.querySelectorAll('textarea'));
        return textareas.some((element) => element.offsetParent !== null);
      }
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
        const hasConfirm = buttons.some((text) => text.includes('确认执行') || text === '确认' || text.includes('纭'));
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
        return buttons.some((text) => text.includes('确认执行') || text === '确认' || text.includes('纭'));
      }
    `,
    { timeout: 30000 }
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
          return text.includes('确认执行') || text === '确认' || text.includes('纭');
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

async function runPrompt(cdp, prompt, { expectBody = [], expectTool, confirm = false } = {}) {
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
  const matchedExpectations = expectBody.filter((keyword) => bodyText.includes(keyword));
  const toolCalled = expectTool
    ? after.toolBadges.filter((badge) => badge === expectTool).length > previousCount
      || bodyText.includes(expectTool)
    : true;

  return {
    before,
    after,
    toolCalled,
    matchedExpectations,
    bodyText,
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

    await waitFor(
      cdp,
      `
        () => document.readyState === 'complete' && location.href.includes('localhost:3266')
      `
    );

    summary.pageUrl = await cdp.evaluate('location.href');

    await cdp.send('Page.reload');
    await waitFor(
      cdp,
      `
        () => document.readyState === 'complete' && location.href.includes('localhost:3266')
      `
    );

    await cdp.evaluate(
      toExpression(`
        () => {
          window.localStorage.removeItem('theme');
          return true;
        }
      `)
    );

    await openAgentPanel(cdp);
    await waitForAgentReady(cdp);

    const settingsResult = await runPrompt(
      cdp,
      '请严格只调用 get_settings_overview 工具，读取当前设置概览，不要调用其他工具。',
      { expectTool: 'get_settings_overview', expectBody: ['GLM-5 Provider', 'glm-5'] }
    );
    summary.tests.push({
      test: 'get_settings_overview',
      toolCalled: settingsResult.toolCalled,
      matchedExpectations: settingsResult.matchedExpectations,
    });
    if (settingsResult.matchedExpectations.length < 2) {
      summary.failures.push('get_settings_overview: Provider 信息未完整显示');
    }

    const apiListResult = await runPrompt(
      cdp,
      '请严格只调用 manage_api_config 工具，action 使用 list，列出当前 Provider 配置，不要调用其他工具。',
      { expectTool: 'manage_api_config', expectBody: ['GLM-5 Provider', 'glm-5'] }
    );
    summary.tests.push({
      test: 'manage_api_config_list',
      toolCalled: apiListResult.toolCalled,
      matchedExpectations: apiListResult.matchedExpectations,
    });
    if (apiListResult.matchedExpectations.length < 2) {
      summary.failures.push('manage_api_config_list: Provider 列表结果异常');
    }

    const currentTimeResult = await runPrompt(
      cdp,
      '请严格只调用 get_current_time 工具，读取当前本地时间，不要调用其他工具。',
      { expectTool: 'get_current_time', expectBody: ['timezone', 'timestamp'] }
    );
    summary.tests.push({
      test: 'get_current_time',
      toolCalled: currentTimeResult.toolCalled,
      matchedExpectations: currentTimeResult.matchedExpectations,
    });
    if (currentTimeResult.matchedExpectations.length < 2) {
      summary.failures.push('get_current_time: 时间结果未完整显示');
    }

    const createTaskResult = await runPrompt(
      cdp,
      `请严格只调用 create_task 工具，不要调用其他工具。参数如下：\`\`\`json\n{"title":"${taskTitle}","priority":"medium"}\n\`\`\``,
      { expectTool: 'create_task', confirm: true }
    );
    const createdTaskPersisted =
      String(createTaskResult.bodyText || '').includes(taskTitle) ||
      String(createTaskResult.bodyText || '').includes('工具 create_task 执行结果') ||
      String(createTaskResult.bodyText || '').includes('工具 create_task 已执行成功');
    summary.tests.push({
      test: 'create_task',
      toolCalled: createTaskResult.toolCalled,
      persisted: createdTaskPersisted,
    });
    if (!createdTaskPersisted) {
      summary.failures.push('create_task: 未观察到任务创建成功结果');
    } else {
      const tasksPayload = await requestApi('/api/tasks');
      const createdTask = Array.isArray(tasksPayload?.items)
        ? tasksPayload.items.find((item) => item.title === taskTitle)
        : null;
      createdTaskId = createdTask?.id || null;
    }

    const weatherResult = await runPrompt(
      cdp,
      '请严格只调用 get_weather 工具，查询北京天气，不要调用其他工具。',
      { expectTool: 'get_weather' }
    );
    summary.tests.push({
      test: 'get_weather',
      toolCalled: weatherResult.toolCalled,
    });
    if (!weatherResult.toolCalled) {
      summary.failures.push('get_weather: 工具未被调用');
    }

    if (createdTaskId) {
      const deleteTaskResult = await runPrompt(
        cdp,
        `请严格只调用 delete_task 工具，不要调用其他工具。参数如下：\`\`\`json\n{"id":"${createdTaskId}"}\n\`\`\``,
        { expectTool: 'delete_task', confirm: true }
      );
      summary.tests.push({
        test: 'delete_task',
        toolCalled: deleteTaskResult.toolCalled,
      });
      if (!deleteTaskResult.toolCalled) {
        summary.failures.push('delete_task: 工具未被调用');
      } else {
        createdTaskId = null;
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
