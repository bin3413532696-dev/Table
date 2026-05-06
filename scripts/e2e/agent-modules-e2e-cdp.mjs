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

async function loadKnowledgeSnapshot() {
  const payload = await fetchJson(`${PAGE_ORIGIN}/api/knowledge/dataset?ts=${Date.now()}`);
  return payload?.data;
}

async function waitForKnowledgeCondition(
  predicate,
  { timeout = 15000, interval = 250, description = 'knowledge condition' } = {}
) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const knowledge = await loadKnowledgeSnapshot();
    if (predicate(knowledge)) {
      return knowledge;
    }
    await sleep(interval);
  }

  throw new Error(`Timed out waiting for ${description}`);
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
  const backupKnowledge = await loadKnowledgeSnapshot();
  const wsUrl = await getPageDebuggerUrl();
  const cdp = new CDPClient(wsUrl);
  const suffix = Date.now().toString(36);
  const knowledgeEntityTitle = `Agent Tool Entity ${suffix}`;
  const knowledgeDocumentTitle = `Agent Tool Document ${suffix}`;
  const knowledgeRelationSource = `agent-relation-${suffix}`;
  const knowledgeAssertionSource = `agent-assertion-${suffix}`;
  const taskTitle = `Authority Test Task ${suffix}`;
  const financeDescription = `Authority Finance ${suffix}`;
  let createdKnowledgeEntityId = null;
  let createdKnowledgeDocumentId = null;
  let createdKnowledgeAssertionId = null;

  const summary = {
    pageUrl: null,
    tests: [],
    failures: [],
    restoredKnowledge: false,
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

    const knowledgeOverviewResult = await runPrompt(
      cdp,
      '请严格只调用 get_knowledge_overview 工具，读取知识库概览，不要调用其他工具。',
      { expectTool: 'get_knowledge_overview', expectBody: ['entityCount', 'documentCount'] }
    );
    summary.tests.push({
      test: 'get_knowledge_overview',
      toolCalled: knowledgeOverviewResult.toolCalled,
      matchedExpectations: knowledgeOverviewResult.matchedExpectations,
    });
    if (knowledgeOverviewResult.matchedExpectations.length < 2) {
      summary.failures.push('get_knowledge_overview: 知识库概览结果未完整显示');
    }

    const upsertKnowledgeEntityResult = await runPrompt(
      cdp,
      `请严格只调用 upsert_knowledge_entity 工具，不要调用其他工具。参数如下：\`\`\`json\n{"typeId":"class:project","title":"${knowledgeEntityTitle}","summary":"Agent 知识库工具回归实体","tags":["agent","knowledge","e2e"],"source":"agent-modules-e2e-cdp","attributes":{"stage":"agent-e2e","kind":"entity"}}\n\`\`\``,
      { expectTool: 'upsert_knowledge_entity', confirm: true }
    );
    const knowledgeAfterCreate = await loadKnowledgeSnapshot();
    const createdKnowledgeEntity = knowledgeAfterCreate?.entities?.find(
      (entity) => entity.title === knowledgeEntityTitle
    );
    summary.tests.push({
      test: 'upsert_knowledge_entity',
      toolCalled: upsertKnowledgeEntityResult.toolCalled,
      persisted: Boolean(createdKnowledgeEntity),
    });
    if (!createdKnowledgeEntity) {
      summary.failures.push('upsert_knowledge_entity: 未在知识库权威源中找到新实体');
    } else {
      createdKnowledgeEntityId = createdKnowledgeEntity.id;
    }

    if (createdKnowledgeEntityId) {
      const createKnowledgeRelationResult = await runPrompt(
        cdp,
        `请严格只调用 create_knowledge_relation 工具，不要调用其他工具。参数如下：\`\`\`json\n{"subjectId":"${createdKnowledgeEntityId}","predicateId":"relation:relatedTo","targetId":"entity:workspace","source":"${knowledgeRelationSource}","confidence":0.9}\n\`\`\``,
        { expectTool: 'create_knowledge_relation', confirm: true }
      );
      const knowledgeAfterRelation = await loadKnowledgeSnapshot();
      const relationEntity = knowledgeAfterRelation?.entities?.find(
        (entity) => entity.id === createdKnowledgeEntityId
      );
      const relationExists = relationEntity?.relations?.some(
        (relation) =>
          relation.predicateId === 'relation:relatedTo' &&
          relation.targetId === 'entity:workspace' &&
          relation.source === knowledgeRelationSource
      );
      const mirroredRelationAssertion = knowledgeAfterRelation?.assertions?.some(
        (assertion) =>
          assertion.subjectId === createdKnowledgeEntityId &&
          assertion.predicateId === 'relation:relatedTo' &&
          assertion.objectId === 'entity:workspace' &&
          assertion.source === knowledgeRelationSource
      );
      summary.tests.push({
        test: 'create_knowledge_relation',
        toolCalled: createKnowledgeRelationResult.toolCalled,
        persisted: Boolean(relationExists),
        mirroredAssertion: Boolean(mirroredRelationAssertion),
      });
      if (!relationExists) {
        summary.failures.push('create_knowledge_relation: 未在知识实体上找到新关系');
      }
      if (!mirroredRelationAssertion) {
        summary.failures.push('create_knowledge_relation: 未生成对应关系断言');
      }

      const getKnowledgeEntityResult = await runPrompt(
        cdp,
        `请严格只调用 get_knowledge_entity 工具，不要调用其他工具。参数如下：\`\`\`json\n{"id":"${createdKnowledgeEntityId}","relationDepth":1}\n\`\`\``,
        { expectTool: 'get_knowledge_entity', expectBody: [knowledgeEntityTitle, 'relatedEntities'] }
      );
      summary.tests.push({
        test: 'get_knowledge_entity',
        toolCalled: getKnowledgeEntityResult.toolCalled,
        matchedExpectations: getKnowledgeEntityResult.matchedExpectations,
      });
      if (getKnowledgeEntityResult.matchedExpectations.length < 2) {
        summary.failures.push('get_knowledge_entity: 实体详情结果未完整显示');
      }

      const upsertKnowledgeDocumentResult = await runPrompt(
        cdp,
        `请严格只调用 upsert_knowledge_document 工具，不要调用其他工具。参数如下：\`\`\`json\n{"title":"${knowledgeDocumentTitle}","summary":"Agent 知识库工具回归文档","content":"该文档用于验证智能体对知识库文档与断言的写入删除链路。","tags":["agent","knowledge","document"],"entityIds":["${createdKnowledgeEntityId}"],"source":"agent-modules-e2e-cdp"}\n\`\`\``,
        { expectTool: 'upsert_knowledge_document', confirm: true }
      );
      const knowledgeAfterDocument = await loadKnowledgeSnapshot();
      const createdKnowledgeDocument = knowledgeAfterDocument?.documents?.find(
        (document) => document.title === knowledgeDocumentTitle
      );
      createdKnowledgeDocumentId = createdKnowledgeDocument?.id || null;
      summary.tests.push({
        test: 'upsert_knowledge_document',
        toolCalled: upsertKnowledgeDocumentResult.toolCalled,
        persisted: Boolean(createdKnowledgeDocument),
        linkedEntity: Boolean(createdKnowledgeDocument?.entityIds?.includes(createdKnowledgeEntityId)),
      });
      if (!createdKnowledgeDocument) {
        summary.failures.push('upsert_knowledge_document: 未在知识库权威源中找到新文档');
      }

      if (createdKnowledgeDocumentId) {
        const upsertKnowledgeAssertionResult = await runPrompt(
          cdp,
          `请严格只调用 upsert_knowledge_assertion 工具，不要调用其他工具。参数如下：\`\`\`json\n{"subjectId":"${createdKnowledgeEntityId}","predicateId":"relation:mentions","objectId":"${createdKnowledgeDocumentId}","evidenceDocumentIds":["${createdKnowledgeDocumentId}"],"source":"${knowledgeAssertionSource}","confidence":0.8}\n\`\`\``,
          { expectTool: 'upsert_knowledge_assertion', confirm: true }
        );
        const knowledgeAfterAssertion = await loadKnowledgeSnapshot();
        const createdKnowledgeAssertion = knowledgeAfterAssertion?.assertions?.find(
          (assertion) =>
            assertion.subjectId === createdKnowledgeEntityId &&
            assertion.objectId === createdKnowledgeDocumentId &&
            assertion.source === knowledgeAssertionSource
        );
        createdKnowledgeAssertionId = createdKnowledgeAssertion?.id || null;
        summary.tests.push({
          test: 'upsert_knowledge_assertion',
          toolCalled: upsertKnowledgeAssertionResult.toolCalled,
          persisted: Boolean(createdKnowledgeAssertion),
          evidenceLinked: Boolean(
            createdKnowledgeAssertion?.evidenceDocumentIds?.includes(createdKnowledgeDocumentId)
          ),
        });
        if (!createdKnowledgeAssertion) {
          summary.failures.push('upsert_knowledge_assertion: 未在知识库权威源中找到新断言');
        }

        if (createdKnowledgeAssertionId) {
          const deleteKnowledgeAssertionResult = await runPrompt(
            cdp,
            `请严格只调用 delete_knowledge_assertion 工具，不要调用其他工具。参数如下：\`\`\`json\n{"id":"${createdKnowledgeAssertionId}"}\n\`\`\``,
            { expectTool: 'delete_knowledge_assertion', confirm: true }
          );
          const knowledgeAfterAssertionDelete = await loadKnowledgeSnapshot();
          const assertionStillExists = knowledgeAfterAssertionDelete?.assertions?.some(
            (assertion) => assertion.id === createdKnowledgeAssertionId
          );
          summary.tests.push({
            test: 'delete_knowledge_assertion',
            toolCalled: deleteKnowledgeAssertionResult.toolCalled,
            removed: !assertionStillExists,
          });
          if (assertionStillExists) {
            summary.failures.push('delete_knowledge_assertion: 知识断言未删除');
          } else {
            createdKnowledgeAssertionId = null;
          }
        }

        const deleteKnowledgeDocumentResult = await runPrompt(
          cdp,
          `请严格只调用 delete_knowledge_document 工具，不要调用其他工具。参数如下：\`\`\`json\n{"id":"${createdKnowledgeDocumentId}"}\n\`\`\``,
          { expectTool: 'delete_knowledge_document', confirm: true }
        );
        const knowledgeAfterDocumentDelete = await loadKnowledgeSnapshot();
        const documentStillExists = knowledgeAfterDocumentDelete?.documents?.some(
          (document) => document.id === createdKnowledgeDocumentId
        );
        summary.tests.push({
          test: 'delete_knowledge_document',
          toolCalled: deleteKnowledgeDocumentResult.toolCalled,
          removed: !documentStillExists,
        });
        if (documentStillExists) {
          summary.failures.push('delete_knowledge_document: 知识文档未删除');
        } else {
          createdKnowledgeDocumentId = null;
        }
      }

      const deleteKnowledgeRelationResult = await runPrompt(
        cdp,
        `请严格只调用 delete_knowledge_relation 工具，不要调用其他工具。参数如下：\`\`\`json\n{"subjectId":"${createdKnowledgeEntityId}","predicateId":"relation:relatedTo","targetId":"entity:workspace"}\n\`\`\``,
        { expectTool: 'delete_knowledge_relation', confirm: true }
      );
      const knowledgeAfterRelationDelete = await loadKnowledgeSnapshot();
      const relationEntityAfterDelete = knowledgeAfterRelationDelete?.entities?.find(
        (entity) => entity.id === createdKnowledgeEntityId
      );
      const relationStillExists = relationEntityAfterDelete?.relations?.some(
        (relation) =>
          relation.predicateId === 'relation:relatedTo' &&
          relation.targetId === 'entity:workspace'
      );
      summary.tests.push({
        test: 'delete_knowledge_relation',
        toolCalled: deleteKnowledgeRelationResult.toolCalled,
        removed: !relationStillExists,
      });
      if (relationStillExists) {
        summary.failures.push('delete_knowledge_relation: 知识关系未删除');
      }
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
    }

    let taskKnowledgeEntityId = null;
    if (createdTaskPersisted) {
      let taskKnowledgeSnapshot = null;

      try {
        taskKnowledgeSnapshot = await waitForKnowledgeCondition(
          (knowledge) =>
            Array.isArray(knowledge?.entities) &&
            knowledge.entities.some((entity) => entity.title === taskTitle && String(entity.id || '').startsWith('entity:task-')) &&
            Array.isArray(knowledge?.assertions) &&
            knowledge.assertions.some(
              (assertion) =>
                assertion.subjectId === 'entity:workspace' &&
                assertion.predicateId === 'relation:linkedTask' &&
                String(assertion.objectId || '').startsWith('entity:task-')
            ),
          {
            description: `task knowledge mapping ${taskTitle}`,
          }
        );
      } catch (error) {
        summary.failures.push(
          `task_knowledge_mapping: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      const taskMappedEntity = taskKnowledgeSnapshot?.entities?.find(
        (entity) => entity.title === taskTitle && String(entity.id || '').startsWith('entity:task-')
      );
      taskKnowledgeEntityId = taskMappedEntity?.id || null;
      const taskMappedRelation = taskKnowledgeSnapshot?.assertions?.some(
        (assertion) =>
          assertion.subjectId === 'entity:workspace' &&
          assertion.predicateId === 'relation:linkedTask' &&
          assertion.objectId === taskKnowledgeEntityId
      );

      summary.tests.push({
        test: 'task_knowledge_mapping',
        entityCreated: !!taskMappedEntity,
        relationCreated: !!taskMappedRelation,
      });

      if (!taskMappedEntity) {
        summary.failures.push('task_knowledge_mapping: 未自动创建任务知识实体');
      }
      if (!taskMappedRelation) {
        summary.failures.push('task_knowledge_mapping: 未自动创建工作站到任务实体的关系');
      }
    }

    const addFinanceResult = await runPrompt(
      cdp,
      `请严格只调用 add_finance_record 工具，不要调用其他工具。参数如下：\`\`\`json\n{"type":"expense","amount":88,"description":"${financeDescription}","category":"其他支出","date":"2026-05-03","model":"GPT-4"}\n\`\`\``,
      { expectTool: 'add_finance_record', confirm: true }
    );
    const createdFinancePersisted =
      String(addFinanceResult.bodyText || '').includes(financeDescription) ||
      String(addFinanceResult.bodyText || '').includes('工具 add_finance_record 执行结果') ||
      String(addFinanceResult.bodyText || '').includes('工具 add_finance_record 已执行成功');
    summary.tests.push({
      test: 'add_finance_record',
      toolCalled: addFinanceResult.toolCalled,
      persisted: createdFinancePersisted,
    });
    if (!createdFinancePersisted) {
      summary.failures.push('add_finance_record: 未观察到财务记录创建成功结果');
    }

    let financeKnowledgeEntityId = null;
    if (createdFinancePersisted) {
      let financeKnowledgeSnapshot = null;

      try {
        financeKnowledgeSnapshot = await waitForKnowledgeCondition(
          (knowledge) =>
            Array.isArray(knowledge?.entities) &&
            knowledge.entities.some((entity) => entity.summary?.includes(financeDescription) && String(entity.id || '').startsWith('entity:finance-')) &&
            Array.isArray(knowledge?.assertions) &&
            knowledge.assertions.some(
              (assertion) =>
                assertion.subjectId === 'entity:workspace' &&
                assertion.predicateId === 'relation:linkedFinanceRecord' &&
                String(assertion.objectId || '').startsWith('entity:finance-')
            ),
          {
            description: `finance knowledge mapping ${financeDescription}`,
          }
        );
      } catch (error) {
        summary.failures.push(
          `finance_knowledge_mapping: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      const financeMappedEntity = financeKnowledgeSnapshot?.entities?.find(
        (entity) => entity.summary?.includes(financeDescription) && String(entity.id || '').startsWith('entity:finance-')
      );
      financeKnowledgeEntityId = financeMappedEntity?.id || null;
      const financeMappedRelation = financeKnowledgeSnapshot?.assertions?.some(
        (assertion) =>
          assertion.subjectId === 'entity:workspace' &&
          assertion.predicateId === 'relation:linkedFinanceRecord' &&
          assertion.objectId === financeKnowledgeEntityId
      );

      summary.tests.push({
        test: 'finance_knowledge_mapping',
        entityCreated: !!financeMappedEntity,
        relationCreated: !!financeMappedRelation,
      });

      if (!financeMappedEntity) {
        summary.failures.push('finance_knowledge_mapping: 未自动创建财务知识实体');
      }
      if (!financeMappedRelation) {
        summary.failures.push('finance_knowledge_mapping: 未自动创建工作站到财务实体的关系');
      }
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

    if (taskKnowledgeEntityId) {
      const deleteTaskResult = await runPrompt(
        cdp,
        `请严格只调用 delete_task 工具，不要调用其他工具。参数如下：\`\`\`json\n{"id":"${String(taskKnowledgeEntityId).replace('entity:task-', '')}"}\n\`\`\``,
        { expectTool: 'delete_task', confirm: true }
      );
      let taskKnowledgeRemoved = false;

      try {
        await waitForKnowledgeCondition(
          (knowledge) =>
            !knowledge?.entities?.some((entity) => entity.id === taskKnowledgeEntityId),
          {
            description: `task knowledge deletion ${taskKnowledgeEntityId}`,
          }
        );
        taskKnowledgeRemoved = true;
      } catch (error) {
        summary.failures.push(
          `delete_task_knowledge_mapping: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      summary.tests.push({
        test: 'delete_task',
        toolCalled: deleteTaskResult.toolCalled,
        removed: taskKnowledgeRemoved,
        knowledgeRemoved: taskKnowledgeRemoved,
      });
      if (!taskKnowledgeRemoved) {
        summary.failures.push('delete_task: 任务未删除');
      }
    }

    if (financeKnowledgeEntityId) {
      const deleteFinanceResult = await runPrompt(
        cdp,
        `请严格只调用 delete_finance_record 工具，不要调用其他工具。参数如下：\`\`\`json\n{"id":"${String(financeKnowledgeEntityId).replace('entity:finance-', '')}"}\n\`\`\``,
        { expectTool: 'delete_finance_record', confirm: true }
      );
      let financeKnowledgeRemoved = false;

      try {
        await waitForKnowledgeCondition(
          (knowledge) =>
            !knowledge?.entities?.some((entity) => entity.id === financeKnowledgeEntityId),
          {
            description: `finance knowledge deletion ${financeKnowledgeEntityId}`,
          }
        );
        financeKnowledgeRemoved = true;
      } catch (error) {
        summary.failures.push(
          `delete_finance_knowledge_mapping: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      summary.tests.push({
        test: 'delete_finance_record',
        toolCalled: deleteFinanceResult.toolCalled,
        removed: financeKnowledgeRemoved,
        knowledgeRemoved: financeKnowledgeRemoved,
      });
      if (!financeKnowledgeRemoved) {
        summary.failures.push('delete_finance_record: 财务记录未删除');
      }
    }

    if (createdKnowledgeEntityId) {
      const deleteKnowledgeEntityResult = await runPrompt(
        cdp,
        `请严格只调用 delete_knowledge_entity 工具，不要调用其他工具。参数如下：\`\`\`json\n{"id":"${createdKnowledgeEntityId}"}\n\`\`\``,
        { expectTool: 'delete_knowledge_entity', confirm: true }
      );
      const knowledgeAfterEntityDelete = await loadKnowledgeSnapshot();
      const entityStillExists = knowledgeAfterEntityDelete?.entities?.some(
        (entity) => entity.id === createdKnowledgeEntityId
      );
      summary.tests.push({
        test: 'delete_knowledge_entity',
        toolCalled: deleteKnowledgeEntityResult.toolCalled,
        removed: !entityStillExists,
      });
      if (entityStillExists) {
        summary.failures.push('delete_knowledge_entity: 知识实体未删除');
      } else {
        createdKnowledgeEntityId = null;
      }
    }
  } finally {
    try {
      await saveKnowledgeSnapshot(backupKnowledge);
      summary.restoredKnowledge = true;
    } catch (error) {
      summary.failures.push(
        `restore_knowledge_snapshot: ${error instanceof Error ? error.message : String(error)}`
      );
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
