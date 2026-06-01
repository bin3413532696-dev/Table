const SERVER_ORIGIN = process.env.MODULES_API_ORIGIN || 'http://127.0.0.1:8787';
const DEFAULT_USER_ID = process.env.MODULES_USER_ID || '00000000-0000-0000-0000-000000000001';
const CSRF_COOKIE_NAME = 'table_dev_csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

const cookieJar = new Map();

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

  const response = await fetch(`${SERVER_ORIGIN}/api/auth/me`, {
    headers: {
      'x-user-id': DEFAULT_USER_ID,
    },
  });

  if (!response.ok) {
    throw new Error(`GET /api/auth/me failed: HTTP ${response.status}`);
  }

  storeCookies(response);
}

async function request(path, init = {}) {
  const method = (init.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    await ensureCsrfCookie();
  }

  const headers = {
    'x-user-id': DEFAULT_USER_ID,
    ...(init.headers || {}),
  };

  const cookieHeader = buildCookieHeader();
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  const csrfToken = cookieJar.get(CSRF_COOKIE_NAME);
  if (csrfToken && !headers[CSRF_HEADER_NAME] && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    headers[CSRF_HEADER_NAME] = csrfToken;
  }

  if (init.body !== undefined && !('Content-Type' in headers)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${SERVER_ORIGIN}${path}`, {
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
    const message =
      payload && typeof payload === 'object' && 'message' in payload
        ? payload.message
        : `HTTP ${response.status}`;
    throw new Error(`${method} ${path} failed: ${message}`);
  }

  return payload;
}

async function main() {
  const suffix = Date.now().toString(36);
  const taskTitle = `Smoke Task ${suffix}`;
  const financeDescription = `Smoke Finance ${suffix}`;
  const financeUpdatedDescription = `Smoke Finance Updated ${suffix}`;
  const summary = {
    ok: true,
    auth: null,
    task: null,
    finance: null,
  };

  let createdTaskId = null;
  let createdFinanceId = null;

  try {
    const authPayload = await request('/api/auth/me');
    summary.auth = {
      userId: authPayload?.data?.user?.id ?? null,
      source: authPayload?.data?.auth?.source ?? null,
    };

    const createdTaskPayload = await request('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: taskTitle,
        priority: 'medium',
      }),
    });
    const createdTask = createdTaskPayload?.data;
    createdTaskId = createdTask?.id ?? null;

    const tasksPayload = await request('/api/tasks');
    const listedTask = Array.isArray(tasksPayload?.items)
      ? tasksPayload.items.find((item) => item.id === createdTaskId)
      : null;
    if (!listedTask || listedTask.title !== taskTitle) {
      throw new Error('Task list did not return the created task');
    }

    const updatedTaskPayload = await request(`/api/tasks/${createdTaskId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        completed: true,
        version: createdTask.version,
      }),
    });
    const updatedTask = updatedTaskPayload?.data;
    if (!updatedTask?.completed) {
      throw new Error('Task update did not persist');
    }

    summary.task = {
      id: createdTaskId,
      dueDate: listedTask.dueDate ?? null,
      completedAfterUpdate: updatedTask.completed,
    };

    const createdFinancePayload = await request('/api/finance', {
      method: 'POST',
      body: JSON.stringify({
        type: 'expense',
        amount: 12.34,
        category: 'Smoke',
        description: financeDescription,
        recordDate: '2026-05-31',
      }),
    });
    const createdFinance = createdFinancePayload?.data;
    createdFinanceId = createdFinance?.id ?? null;

    const financeListPayload = await request('/api/finance');
    const listedFinance = Array.isArray(financeListPayload?.items)
      ? financeListPayload.items.find((item) => item.id === createdFinanceId)
      : null;
    if (!listedFinance || listedFinance.description !== financeDescription) {
      throw new Error('Finance list did not return the created record');
    }

    const updatedFinancePayload = await request(`/api/finance/${createdFinanceId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        description: financeUpdatedDescription,
        version: createdFinance.version,
      }),
    });
    const updatedFinance = updatedFinancePayload?.data;
    if (updatedFinance?.description !== financeUpdatedDescription) {
      throw new Error('Finance update did not persist');
    }

    summary.finance = {
      id: createdFinanceId,
      model: listedFinance.model ?? null,
      descriptionAfterUpdate: updatedFinance.description,
    };

    await request(`/api/tasks/${createdTaskId}`, {
      method: 'DELETE',
    });
    createdTaskId = null;

    await request(`/api/finance/${createdFinanceId}`, {
      method: 'DELETE',
    });
    createdFinanceId = null;

    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          ...summary,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  } finally {
    if (createdTaskId) {
      await request(`/api/tasks/${createdTaskId}`, {
        method: 'DELETE',
      }).catch(() => undefined);
    }

    if (createdFinanceId) {
      await request(`/api/finance/${createdFinanceId}`, {
        method: 'DELETE',
      }).catch(() => undefined);
    }
  }
}

main();
