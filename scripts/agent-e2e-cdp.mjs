const DEBUGGER_URL = 'http://127.0.0.1:9222/json/list';
const PAGE_URL_PREFIX = 'http://localhost:3266/';

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

async function waitFor(cdp, predicateSource, { timeout = 60000, interval = 250 } = {}) {
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

function js(value) {
  return JSON.stringify(value);
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

async function waitForAgentReady(cdp) {
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
    { timeout: 90000 }
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
        const tasks = JSON.parse(localStorage.getItem('tasks_records') || '[]');
        const finance = JSON.parse(localStorage.getItem('finance_records') || '[]');
        const bodyText = document.body.innerText || '';
        const confirmationButtons = Array.from(document.querySelectorAll('button'))
          .map((element) => element.textContent?.trim())
          .filter(Boolean);

        return {
          bodyText,
          toolBadges,
          tasksCount: Array.isArray(tasks) ? tasks.length : 0,
          financeCount: Array.isArray(finance) ? finance.length : 0,
          textareaDisabled: textarea ? textarea.disabled : null,
          hasVisibleTextarea: !!textarea,
          confirmationButtons,
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

        const sendButton = textarea.parentElement?.querySelector('button');
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
        const resultVisible = bodyText.includes(${js(`工具 ${toolName} 执行结果`)})
          || bodyText.includes(${js(`工具 ${toolName} 已执行成功`)})
          || bodyText.includes(${js(`即将执行 ${toolName}`)})
          || bodyText.includes(${js(`工具 ${toolName} 执行失败`)});
        return badgeCount > ${previousCount} || resultVisible;
      }
    `,
    { timeout: 120000 }
  );
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
          .map((element) => element.textContent?.trim())
          .filter(Boolean);
        const hasConfirm = buttons.length >= 2 && buttons.some((text) => /纭|确|鎿/.test(text));
        return (textarea && !textarea.disabled) || hasConfirm;
      }
    `,
    { timeout: 120000 }
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
          return /纭|确|鎵/.test(text);
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

async function main() {
  const wsUrl = await getPageDebuggerUrl();
  const cdp = new CDPClient(wsUrl);

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

    await cdp.evaluate(
      toExpression(`
        () => {
          localStorage.setItem('tasks_records', '[]');
          localStorage.setItem('finance_records', '[]');
          localStorage.removeItem('user_profile');
          localStorage.removeItem('theme');
          return true;
        }
      `)
    );

    await cdp.send('Page.reload');
    await waitFor(
      cdp,
      `
        () => document.readyState === 'complete' && location.href.includes('localhost:3266')
      `
    );

    await openAgentPanel(cdp);
    await waitForAgentReady(cdp);

    const queryTests = [
      {
        name: 'get_overview',
        prompt: '请严格只调用 get_overview 工具，查询当前工作台总览，不要调用其他工具。',
        expect: ['finance', 'tasks'],
      },
      {
        name: 'get_task_stats',
        prompt: '请严格只调用 get_task_stats 工具，查询当前任务统计，不要调用其他工具。',
        expect: ['total', 'pending'],
      },
      {
        name: 'get_finance_stats',
        prompt: '请严格只调用 get_finance_stats 工具，查询当前财务统计，不要调用其他工具。',
        expect: ['income', 'expense'],
      },
      {
        name: 'calculate_expression',
        prompt: '请严格只调用 calculate_expression 工具，计算表达式 12*(3+4)，不要调用其他工具。',
        expect: ['84'],
      },
      {
        name: 'parse_color',
        prompt: '请严格只调用 parse_color 工具，解析颜色 #165DFF，不要调用其他工具。',
        expect: ['#165DFF', '22', '93', '255'],
      },
      {
        name: 'format_json',
        prompt: '请严格只调用 format_json 工具，把 {"a":1,"b":[2,3]} 格式化为 pretty，不要调用其他工具。',
        expect: ['"a"', '"b"', '['],
      },
      {
        name: 'get_settings_overview',
        prompt: '请严格只调用 get_settings_overview 工具，读取设置总览，不要调用其他工具。',
        expect: ['glm-5', 'GLM-5 Provider'],
      },
    ];

    for (const test of queryTests) {
      const before = await getPageState(cdp);
      const previousCount = before.toolBadges.filter((badge) => badge === test.name).length;

      await sendPrompt(cdp, test.prompt);
      await waitForToolBadge(cdp, test.name, previousCount);
      await waitForProcessingStop(cdp);

      const after = await getPageState(cdp);
      const text = String(after.bodyText || '');
      const matchedExpectations = test.expect.filter((keyword) => text.includes(keyword));
      const toolCalled =
        after.toolBadges.includes(test.name) ||
        text.includes(`工具 ${test.name} 执行结果`) ||
        text.includes(`工具 ${test.name} 已执行成功`);
      const resultVisible = matchedExpectations.length > 0;

      summary.tests.push({
        test: test.name,
        toolCalled,
        resultVisible,
        matchedExpectations,
      });

      if (!toolCalled) {
        summary.failures.push(`${test.name}: 工具未出现在界面中`);
      }
      if (!resultVisible) {
        summary.failures.push(`${test.name}: 工具结果未在界面中可见`);
      }

      await waitForAgentReady(cdp);
    }

    const explainBefore = await getPageState(cdp);
    const explainTaskCountBefore = explainBefore.tasksCount;
    const explainBadgeCountBefore = explainBefore.toolBadges.filter(
      (badge) => badge === 'create_task'
    ).length;

    await sendPrompt(cdp, '如何使用 create_task？请说明它需要哪些参数，不要执行任何操作。');
    await waitForProcessingStop(cdp);
    await waitForAgentReady(cdp);

    const explainAfter = await getPageState(cdp);
    const explainText = String(explainAfter.bodyText || '');
    const explainTriggeredTool =
      explainAfter.toolBadges.filter((badge) => badge === 'create_task').length > explainBadgeCountBefore ||
      explainText.includes('即将执行 create_task') ||
      explainText.includes('工具 create_task 执行结果') ||
      explainText.includes('工具 create_task 已执行成功');

    summary.tests.push({
      test: 'create_task_explanation_no_execute',
      toolCalled: explainTriggeredTool,
      taskCountChanged: explainAfter.tasksCount !== explainTaskCountBefore,
    });

    if (explainTriggeredTool) {
      summary.failures.push('create_task_explanation_no_execute: 解释型问句错误触发了工具执行');
    }
    if (explainAfter.tasksCount !== explainTaskCountBefore) {
      summary.failures.push('create_task_explanation_no_execute: 解释型问句意外修改了任务数据');
    }

    const taskCountBefore = (await getPageState(cdp)).tasksCount;
    const createTaskToolName = 'create_task';
    const createTaskPrompt = '请严格只调用 create_task 工具，创建一个标题为 CDP联调任务 的任务，不要调用其他工具。';
    const beforeCreate = await getPageState(cdp);
    const createTaskCount = beforeCreate.toolBadges.filter((badge) => badge === createTaskToolName).length;

    await sendPrompt(cdp, createTaskPrompt);
    await waitForToolBadge(cdp, createTaskToolName, createTaskCount);
    await waitForProcessingStop(cdp);

    const pendingCreate = await getPageState(cdp);
    const beforeConfirmCount = pendingCreate.tasksCount;
    const confirmationVisible =
      pendingCreate.textareaDisabled === true &&
      String(pendingCreate.bodyText || '').includes('即将执行 create_task');

    await clickConfirmation(cdp);
    await waitForAgentReady(cdp);
    await waitFor(
      cdp,
      `
        () => {
          const tasks = JSON.parse(localStorage.getItem('tasks_records') || '[]');
          return Array.isArray(tasks) && tasks.length > ${beforeConfirmCount};
        }
      `,
      { timeout: 120000 }
    );

    const afterConfirm = await getPageState(cdp);

    summary.tests.push({
      test: 'create_task_confirmation',
      toolCalled: afterConfirm.toolBadges.includes(createTaskToolName),
      confirmationVisible,
      beforeSendCount: taskCountBefore,
      beforeConfirmCount,
      afterConfirmCount: afterConfirm.tasksCount,
      notPersistedBeforeConfirm: beforeConfirmCount === taskCountBefore,
      persistedAfterConfirm: afterConfirm.tasksCount === taskCountBefore + 1,
    });

    if (beforeConfirmCount !== taskCountBefore) {
      summary.failures.push('create_task_confirmation: 确认前任务已写入存储');
    }
    if (afterConfirm.tasksCount !== taskCountBefore + 1) {
      summary.failures.push('create_task_confirmation: 确认后任务未正确写入存储');
    }

    const exitCode = summary.failures.length > 0 ? 1 : 0;
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = exitCode;
  } finally {
    cdp.close();
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
