const DEBUGGER_URL = 'http://127.0.0.1:9222/json/list';
const PAGE_ORIGIN = 'http://localhost:3266';
const PAGE_URL_PREFIX = `${PAGE_ORIGIN}/`;

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${url}`);
  }
  return response.json();
}

async function loadDataPayload() {
  const url = `${PAGE_ORIGIN}/api/knowledge/dataset?ts=${Date.now()}`;
  return fetchJson(url, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });
}

function summarizeLoadDataPayload(payload) {
  const knowledge = payload?.data;

  return {
    hasKnowledge: Boolean(knowledge && typeof knowledge === 'object'),
    entityCount: Array.isArray(knowledge?.entities) ? knowledge.entities.length : null,
    documentCount: Array.isArray(knowledge?.documents) ? knowledge.documents.length : null,
    assertionCount: Array.isArray(knowledge?.assertions) ? knowledge.assertions.length : null,
  };
}

async function loadKnowledgeSnapshot() {
  const payload = await loadDataPayload();
  return payload?.data;
}

async function requireKnowledgeSnapshot() {
  const payload = await loadDataPayload();
  const knowledge = payload?.data;

  if (!knowledge || typeof knowledge !== 'object') {
    const summary = summarizeLoadDataPayload(payload);
    throw new Error(
      `Knowledge API unavailable: /api/knowledge/dataset missing knowledge field (${JSON.stringify(summary)})`
    );
  }

  return knowledge;
}

async function saveKnowledgeSnapshot(knowledge) {
  const response = await fetch(`${PAGE_ORIGIN}/api/knowledge/dataset`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset: knowledge }),
  });

  if (!response.ok) {
    throw new Error(`Failed to restore knowledge snapshot: HTTP ${response.status}`);
  }
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

async function waitForServer(predicate, { timeout = 120000, interval = 400 } = {}) {
  const start = Date.now();
  let lastSummary = null;
  while (Date.now() - start < timeout) {
    const payload = await loadDataPayload();
    const snapshot = payload?.data?.knowledge;
    lastSummary = summarizeLoadDataPayload(payload);
    if (predicate(snapshot)) {
      return snapshot;
    }
    await sleep(interval);
  }

  throw new Error(
    `waitForServer timeout after ${timeout}ms (${JSON.stringify(lastSummary)})`
  );
}

async function waitForPageReady(cdp) {
  await waitFor(
    cdp,
    `
      () => document.readyState === 'complete' && location.href.includes('localhost:3266')
    `
  );
}

async function clearLocalState(cdp) {
  await cdp.evaluate(
    toExpression(`
      () => {
        localStorage.removeItem('security_pin_hashed');
        return true;
      }
    `)
  );
}

async function navigateToKnowledge(cdp) {
  await cdp.evaluate(
    toExpression(`
      () => {
        window.location.hash = '#/knowledge';
        return window.location.href;
      }
    `)
  );

  await waitFor(
    cdp,
    `
      () => {
        const text = document.body.innerText || '';
        return location.hash.includes('/knowledge') && text.includes('知识库') && text.includes('探索与维护视图');
      }
    `
  );
}

async function clickButtonByText(cdp, text) {
  const clicked = await cdp.evaluate(
    toExpression(`
      () => {
        const buttons = Array.from(document.querySelectorAll('button'))
          .filter((element) => element.offsetParent !== null);
        const button = buttons.find((element) => (element.textContent || '').trim().includes(${js(text)}));
        if (!button) {
          return false;
        }
        button.click();
        return true;
      }
    `)
  );

  if (!clicked) {
    throw new Error(`Button not found: ${text}`);
  }
}

async function clickAt(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none',
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
}

async function clickDialogButtonByText(cdp, text, { useMouse = false } = {}) {
  const target = await cdp.evaluate(
    toExpression(`
      () => {
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
          .filter((element) => element.offsetParent !== null);
        const dialog = dialogs[dialogs.length - 1];
        if (!dialog) {
          return false;
        }

        const buttons = Array.from(dialog.querySelectorAll('button'))
          .filter((element) => element.offsetParent !== null);
        const button = buttons.find((element) => (element.textContent || '').trim().includes(${js(text)}));
        if (!button) {
          return false;
        }

        const rect = button.getBoundingClientRect();
        return {
          text: (button.textContent || '').trim(),
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      }
    `)
  );

  if (!target) {
    throw new Error(`Dialog button not found: ${text}`);
  }

  if (useMouse) {
    await clickAt(cdp, target.x, target.y);
    return;
  }

  const clicked = await cdp.evaluate(
    toExpression(`
      () => {
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
          .filter((element) => element.offsetParent !== null);
        const dialog = dialogs[dialogs.length - 1];
        if (!dialog) {
          return false;
        }

        const buttons = Array.from(dialog.querySelectorAll('button'))
          .filter((element) => element.offsetParent !== null);
        const button = buttons.find((element) => (element.textContent || '').trim() === ${js(target.text)});
        if (!button) {
          return false;
        }

        button.click();
        return true;
      }
    `)
  );

  if (!clicked) {
    throw new Error(`Dialog button click failed: ${text}`);
  }
}

async function clickSectionButton(cdp, sectionTitle, buttonText) {
  const clicked = await cdp.evaluate(
    toExpression(`
      () => {
        const sections = Array.from(document.querySelectorAll('div'))
          .filter((element) => element.offsetParent !== null && (element.textContent || '').trim() === ${js(sectionTitle)});
        for (const title of sections) {
          const container = title.parentElement;
          if (!container) {
            continue;
          }
          const buttons = Array.from(container.querySelectorAll('button'))
            .filter((element) => element.offsetParent !== null);
          const button = buttons.find((element) => (element.textContent || '').trim().includes(${js(buttonText)}));
          if (button) {
            button.click();
            return true;
          }
        }
        return false;
      }
    `)
  );

  if (!clicked) {
    throw new Error(`Section button not found: ${sectionTitle} / ${buttonText}`);
  }
}

async function fillFieldByLabel(cdp, labelText, value) {
  const filled = await cdp.evaluate(
    toExpression(`
      () => {
        const labels = Array.from(document.querySelectorAll('label'))
          .filter((element) => element.offsetParent !== null);
        const label = labels.find((element) => (element.textContent || '').trim().includes(${js(labelText)}));
        if (!label) {
          return false;
        }

        const container = label.parentElement;
        const control = container?.querySelector('input:not([type="checkbox"]), textarea');
        if (!control) {
          return false;
        }

        const descriptor = Object.getOwnPropertyDescriptor(control.constructor.prototype, 'value');
        descriptor?.set?.call(control, ${js(value)});
        control.dispatchEvent(new Event('input', { bubbles: true }));
        control.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    `)
  );

  if (!filled) {
    throw new Error(`Field not found: ${labelText}`);
  }
}

async function selectOptionByLabel(cdp, labelText, optionText) {
  const selected = await cdp.evaluate(
    toExpression(`
      () => {
        const labels = Array.from(document.querySelectorAll('label'))
          .filter((element) => element.offsetParent !== null);
        const label = labels.find((element) => (element.textContent || '').trim().includes(${js(labelText)}));
        if (!label) {
          return false;
        }

        const select = label.parentElement?.querySelector('select');
        if (!select) {
          return false;
        }

        const options = Array.from(select.options);
        const option = options.find((item) => item.text.includes(${js(optionText)}) || item.value === ${js(optionText)});
        if (!option) {
          return false;
        }

        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    `)
  );

  if (!selected) {
    throw new Error(`Option not found: ${labelText} / ${optionText}`);
  }
}

async function ensureCheckboxByText(cdp, text, checked = true) {
  const updated = await cdp.evaluate(
    toExpression(`
      () => {
        const labels = Array.from(document.querySelectorAll('label'))
          .filter((element) => element.offsetParent !== null);
        const label = labels.find((element) => (element.textContent || '').includes(${js(text)}));
        if (!label) {
          return false;
        }

        const checkbox = label.querySelector('input[type="checkbox"]');
        if (!checkbox) {
          return false;
        }

        if (checkbox.checked !== ${checked}) {
          checkbox.click();
        }

        return checkbox.checked === ${checked};
      }
    `)
  );

  if (!updated) {
    throw new Error(`Checkbox not found: ${text}`);
  }
}

async function fillSearch(cdp, value) {
  const filled = await cdp.evaluate(
    toExpression(`
      () => {
        const input = Array.from(document.querySelectorAll('input'))
          .find((element) => element.getAttribute('placeholder') === '搜索实体、别名、标签或文档...');
        if (!input) {
          return false;
        }

        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        descriptor?.set?.call(input, ${js(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    `)
  );

  if (!filled) {
    throw new Error('Knowledge search input not found');
  }
}

async function clickSearchResult(cdp, title, kind = 'entity') {
  const clicked = await cdp.evaluate(
    toExpression(`
      () => {
        const buttons = Array.from(document.querySelectorAll('button'))
          .filter((element) => element.offsetParent !== null);
        const target = buttons.find((element) => {
          const text = (element.textContent || '').trim();
          return text.includes(${js(title)}) && text.includes(${js(kind)});
        });

        if (!target) {
          return false;
        }

        target.click();
        return true;
      }
    `)
  );

  if (!clicked) {
    throw new Error(`Search result not found: ${title} / ${kind}`);
  }
}

async function waitForText(cdp, text, timeout = 30000) {
  await waitFor(
    cdp,
    `
      () => (document.body.innerText || '').includes(${js(text)})
    `,
    { timeout }
  );
}

async function waitForDialogText(cdp, text, timeout = 30000) {
  await waitFor(
    cdp,
    `
      () => Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((element) => element.offsetParent !== null)
        .some((element) => (element.innerText || '').includes(${js(text)}))
    `,
    { timeout }
  );
}

async function waitForModalClose(cdp, actionText) {
  await waitFor(
    cdp,
    `
      () => !Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter((element) => element.offsetParent !== null)
        .some((element) => (element.innerText || '').includes(${js(actionText)}))
    `,
    { timeout: 30000 }
  );
}

async function getVisibleKnowledgeText(cdp) {
  return cdp.evaluate(
    toExpression(`
      () => document.body.innerText || ''
    `)
  );
}

async function main() {
  const backupKnowledge = await requireKnowledgeSnapshot();
  const wsUrl = await getPageDebuggerUrl();
  const cdp = new CDPClient(wsUrl);
  const suffix = Date.now().toString(36);
  const entityTitle = `E2E 实体 ${suffix}`;
  const documentTitle = `E2E 文档 ${suffix}`;
  const summary = {
    pageUrl: null,
    tests: [],
    failures: [],
    restored: false,
  };

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await waitForPageReady(cdp);
    summary.pageUrl = await cdp.evaluate('location.href');

    await clearLocalState(cdp);
    await cdp.send('Page.reload');
    await waitForPageReady(cdp);
    await navigateToKnowledge(cdp);

    await clickButtonByText(cdp, '新增实体');
    await waitForDialogText(cdp, '创建实体');
    await fillFieldByLabel(cdp, '标题', entityTitle);
    await fillFieldByLabel(cdp, '摘要', '知识库页面端到端回归实体。');
    await fillFieldByLabel(cdp, '标签', 'e2e, knowledge');
    await fillFieldByLabel(cdp, '来源', 'knowledge-e2e-cdp');
    await fillFieldByLabel(cdp, '属性 JSON', '{"stage":"e2e","kind":"entity"}');
    await clickDialogButtonByText(cdp, '创建实体');
    await waitForModalClose(cdp, '创建实体');
    await waitForText(cdp, '实体已创建并写入知识库。');

    const entitySnapshot = await waitForServer((knowledge) =>
      Array.isArray(knowledge?.entities) &&
      knowledge.entities.some((entity) => entity.title === entityTitle)
    );
    const createdEntity = entitySnapshot.entities.find((entity) => entity.title === entityTitle);
    summary.tests.push({
      test: 'create_entity',
      persisted: Boolean(createdEntity),
    });
    if (!createdEntity) {
      summary.failures.push('create_entity: 未在知识库权威源中找到新实体');
      throw new Error('Entity creation failed');
    }

    await clickButtonByText(cdp, '新增文档');
    await waitForDialogText(cdp, '创建文档');
    await fillFieldByLabel(cdp, '标题', documentTitle);
    await fillFieldByLabel(cdp, '摘要', '知识库页面端到端回归文档。');
    await fillFieldByLabel(cdp, '正文内容', '该文档用于验证知识库文档写入、断言证据和删除清理链路。');
    await fillFieldByLabel(cdp, '标签', 'e2e, document');
    await fillFieldByLabel(cdp, '来源', 'knowledge-e2e-cdp');
    await ensureCheckboxByText(cdp, entityTitle, true);
    await clickDialogButtonByText(cdp, '创建文档');
    await waitForModalClose(cdp, '创建文档');
    await waitForText(cdp, '文档已创建并写入知识库。');

    const documentSnapshot = await waitForServer((knowledge) =>
      Array.isArray(knowledge?.documents) &&
      knowledge.documents.some((document) => document.title === documentTitle)
    );
    const createdDocument = documentSnapshot.documents.find((document) => document.title === documentTitle);
    summary.tests.push({
      test: 'create_document',
      persisted: Boolean(createdDocument),
      linkedEntity: createdDocument?.entityIds?.includes(createdEntity.id) || false,
    });
    if (!createdDocument) {
      summary.failures.push('create_document: 未在知识库权威源中找到新文档');
      throw new Error('Document creation failed');
    }

    await clickButtonByText(cdp, '以当前文档补证据断言');
    await waitForDialogText(cdp, '创建断言');
    await selectOptionByLabel(cdp, '断言主体', entityTitle);
    await selectOptionByLabel(cdp, '目标对象', documentTitle);
    await fillFieldByLabel(cdp, '来源', 'knowledge-e2e-cdp');
    await fillFieldByLabel(cdp, '置信度', '0.8');
    await ensureCheckboxByText(cdp, documentTitle, true);
    await clickDialogButtonByText(cdp, '创建断言');
    await waitForModalClose(cdp, '创建断言');
    await waitForText(cdp, '断言已创建并写入知识库。');

    const assertionSnapshot = await waitForServer((knowledge) =>
      Array.isArray(knowledge?.assertions) &&
      knowledge.assertions.some(
        (assertion) =>
          assertion.subjectId === createdEntity.id &&
          assertion.objectId === createdDocument.id &&
          assertion.source === 'knowledge-e2e-cdp'
      )
    );
    const createdAssertion = assertionSnapshot.assertions.find(
      (assertion) =>
        assertion.subjectId === createdEntity.id &&
        assertion.objectId === createdDocument.id &&
        assertion.source === 'knowledge-e2e-cdp'
    );
    summary.tests.push({
      test: 'create_assertion',
      persisted: Boolean(createdAssertion),
      evidenceLinked: createdAssertion?.evidenceDocumentIds?.includes(createdDocument.id) || false,
    });
    if (!createdAssertion) {
      summary.failures.push('create_assertion: 未在知识库权威源中找到新断言');
      throw new Error('Assertion creation failed');
    }

    await clickSectionButton(cdp, '证据断言', '删除');
    await waitForDialogText(cdp, '删除断言');
    await clickDialogButtonByText(cdp, '删除断言', { useMouse: true });
    await waitForServer((knowledge) =>
      Array.isArray(knowledge?.assertions) &&
      !knowledge.assertions.some((assertion) => assertion.id === createdAssertion.id)
    );
    summary.tests.push({
      test: 'delete_assertion',
      removed: true,
    });

    await fillSearch(cdp, documentTitle);
    await waitForText(cdp, documentTitle);
    await clickSearchResult(cdp, documentTitle, 'document');
    await clickButtonByText(cdp, '删除当前文档');
    await waitForDialogText(cdp, '删除文档');
    await clickDialogButtonByText(cdp, '删除文档', { useMouse: true });
    await waitForServer((knowledge) =>
      Array.isArray(knowledge?.documents) &&
      !knowledge.documents.some((document) => document.id === createdDocument.id)
    );
    summary.tests.push({
      test: 'delete_document',
      removed: true,
    });

    await fillSearch(cdp, entityTitle);
    await waitForText(cdp, entityTitle);
    await clickSearchResult(cdp, entityTitle);
    await clickButtonByText(cdp, '删除当前实体');
    await waitForDialogText(cdp, '删除实体');
    await clickDialogButtonByText(cdp, '删除实体', { useMouse: true });
    await waitForServer((knowledge) =>
      Array.isArray(knowledge?.entities) &&
      !knowledge.entities.some((entity) => entity.id === createdEntity.id)
    );
    summary.tests.push({
      test: 'delete_entity',
      removed: true,
    });

    const pageText = await getVisibleKnowledgeText(cdp);
    summary.tests.push({
      test: 'knowledge_page_visible',
      visible: pageText.includes('知识库') && pageText.includes('探索与维护视图'),
    });
  } finally {
    try {
      await saveKnowledgeSnapshot(backupKnowledge);
      summary.restored = true;
    } catch (error) {
      summary.failures.push(`restore_snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      await clearLocalState(cdp);
      await cdp.send('Page.reload');
    } catch {
      // ignore restore reload failures
    }

    cdp.close();
  }

  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.failures.length > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
