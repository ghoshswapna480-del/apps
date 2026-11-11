const { test, expect } = require('@playwright/test');

async function setEmptyServerState(request) {
  const now = new Date();
  const currentDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  await request.put('/api/state', {
    data: {
      state: {
        schemaVersion: 2,
        activeTab: 'routine',
        taskFilter: 'all',
        noteSearch: '',
        currentDay,
        routines: [],
        classes: [],
        tasks: [],
        notes: [],
        journal: [],
        progressHistory: {},
        scheduleHistory: {},
        focusSessions: 0
      }
    }
  });
}

async function setSliderValue(slider, value) {
  await slider.evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test.beforeEach(async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('#storageStatus')).toContainText(/server/i);
  await page.evaluate(() => localStorage.clear());
  await setEmptyServerState(request);
  await page.reload();
  await expect(page.locator('#storageStatus')).toHaveText('Connected to the server; changes sync across devices');
});

test('one-off task dates and progress survive a reload', async ({ page }) => {
  await page.getByRole('tab', { name: /Advanced Tasks/ }).click();
  await page.getByLabel('Task title').fill('Finish project report');
  await page.getByLabel('One-off task due date').fill('2026-12-15');
  await page.getByRole('button', { name: '+ Add Task' }).click();

  const slider = page.getByRole('slider', { name: 'Progress for Finish project report' });
  await slider.evaluate(element => {
    element.value = '45';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(
    page.getByRole('tabpanel', { name: /Advanced Tasks/ }).getByText('45%', { exact: true })
  ).toBeVisible();

  await page.reload();
  await expect(page.getByText('Finish project report')).toBeVisible();
  await expect(page.getByText('Due 2026-12-15 at 17:00')).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Progress for Finish project report' })).toHaveValue('45');
});

test('workspace progress bar reflects partial and completed task progress', async ({ page }) => {
  await page.getByRole('tab', { name: /Advanced Tasks/ }).click();
  await page.getByLabel('Task title').fill('Track progress');
  await page.getByRole('button', { name: '+ Add Task' }).click();

  const slider = page.getByRole('slider', { name: 'Progress for Track progress' });
  const progressBar = page.getByRole('progressbar', { name: 'Daily completion' });

  await setSliderValue(slider, 45);
  await expect(progressBar).toHaveAttribute('aria-valuenow', '45');
  await expect(page.locator('#overallProgressText')).toContainText('45% Work Progress');

  await setSliderValue(slider, 100);
  await expect(progressBar).toHaveAttribute('aria-valuenow', '100');
  await expect(page.locator('#overallProgressText')).toContainText('100% Work Progress');
});

test('daily reset clears recurring work but preserves one-off progress', async ({ page }) => {
  const yesterday = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('dailyflow_v1_state')));
  state.currentDay = yesterday;
  state.routines = [{ id: 'r-test', time: '08:00', title: 'Water plants', block: 'Morning', done: true }];
  state.classes = [];
  state.tasks = [
    { id: 't-daily', title: 'Plan the day', category: 'Personal', priority: 'Low', type: 'recurring', dueDate: '', due: '08:30', progress: 80, completed: false },
    { id: 't-once', title: 'Finish assignment', category: 'Study', priority: 'High', type: 'one-off', dueDate: '2026-12-15', due: '17:00', progress: 40, completed: false }
  ];
  await page.evaluate(async saved => {
    localStorage.setItem('dailyflow_v1_state', JSON.stringify(saved));
    await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: saved }) });
  }, state);
  await page.reload();

  await expect(page.getByRole('checkbox', { name: 'Mark Water plants complete' })).not.toBeChecked();
  await page.getByRole('tab', { name: /Advanced Tasks/ }).click();
  await expect(page.getByRole('slider', { name: 'Progress for Plan the day' })).toHaveValue('0');
  await expect(page.getByRole('slider', { name: 'Progress for Finish assignment' })).toHaveValue('40');
});

test('routine, class, note, journal, and focus controls work', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.getByLabel('Routine title').fill('Morning review');
  await page.getByRole('button', { name: '+ Add Block' }).click();
  const routineCheckbox = page.getByRole('checkbox', { name: 'Mark Morning review complete' });
  await expect(routineCheckbox).toBeVisible();
  await routineCheckbox.check();
  await expect(routineCheckbox).toBeChecked();

  await page.getByRole('tab', { name: /Classes/ }).click();
  await page.getByLabel('Class subject').fill('Biology');
  await page.getByLabel('Class topic or room').fill('Cell structure');
  await page.getByRole('button', { name: '+ Add Class' }).click();
  const classCheckbox = page.getByRole('checkbox', { name: 'Mark Biology attended' });
  await expect(classCheckbox).toBeVisible();
  await classCheckbox.check();
  await expect(classCheckbox).toBeChecked();

  await page.getByRole('tab', { name: /Notes/ }).click();
  await page.getByLabel('Note title').fill('Array notes');
  await page.getByLabel('Note tag').fill('Study');
  await page.getByLabel('Note content').fill('Review arrays and indexing.');
  await page.getByRole('button', { name: '+ Save Note' }).click();
  await expect(page.getByText('Array notes')).toBeVisible();
  await page.getByLabel('Search notes').fill('missing phrase');
  await expect(page.getByText('Array notes')).toHaveCount(0);
  await page.getByLabel('Search notes').fill('indexing');
  await expect(page.getByText('Array notes')).toBeVisible();

  await page.getByRole('tab', { name: /Journal/ }).click();
  await page.getByLabel('Journal headline').fill('Small win');
  await page.getByLabel('Journal entry').fill('Finished the review and stayed focused.');
  await page.getByRole('button', { name: '+ Log Journal Entry' }).click();
  await expect(page.getByText('Small win')).toBeVisible();

  const timer = page.getByRole('timer', { name: 'Focus timer' });
  await expect(timer).toHaveText('25:00');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect(timer).not.toHaveText('25:00', { timeout: 2500 });
  const pausedAt = await timer.textContent();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForTimeout(1100);
  await expect(timer).toHaveText(pausedAt);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(timer).not.toHaveText(pausedAt, { timeout: 2500 });

  await page.evaluate(() => {
    window.__dailyflowOriginalNow = Date.now;
    Date.now = () => window.__dailyflowOriginalNow() + 25 * 60 * 1000;
  });
  await expect(timer).toHaveText('00:00', { timeout: 1500 });
  await expect(page.locator('#focusSessionsBadge')).toContainText('1 Focus Session');
  await page.evaluate(() => { Date.now = window.__dailyflowOriginalNow; });

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(timer).toHaveText('25:00');

  expect(pageErrors).toEqual([]);
});

test('server sync shares edits with a fresh browser context', async ({ page, browser }) => {
  await page.getByRole('tab', { name: /Advanced Tasks/ }).click();
  await page.getByLabel('Task title').fill('Shared workspace task');
  await page.getByRole('button', { name: '+ Add Task' }).click();
  const firstSlider = page.getByRole('slider', { name: 'Progress for Shared workspace task' });
  await setSliderValue(firstSlider, 35);
  await expect(page.locator('#storageStatus')).toHaveText('Saved in this browser and synced to the server');

  const secondContext = await browser.newContext();
  try {
    const secondPage = await secondContext.newPage();
    await secondPage.goto('/');
    await expect(secondPage.locator('#storageStatus')).toContainText(/server/i);
    await secondPage.getByRole('tab', { name: /Advanced Tasks/ }).click();
    const secondSlider = secondPage.getByRole('slider', { name: 'Progress for Shared workspace task' });
    await expect(secondSlider).toHaveValue('35');
    await setSliderValue(secondSlider, 65);
    await expect(secondPage.locator('#storageStatus')).toHaveText('Saved in this browser and synced to the server');

    await page.reload();
    await page.getByRole('tab', { name: /Advanced Tasks/ }).click();
    await expect(page.getByRole('slider', { name: 'Progress for Shared workspace task' })).toHaveValue('65');
  } finally {
    await secondContext.close();
  }
});

test('main workspace fits a narrow mobile viewport without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
});

test('JSON backup can be restored after confirmation', async ({ page }) => {
  page.once('dialog', dialog => dialog.accept());
  const backup = {
    activeTab: 'tasks',
    taskFilter: 'all',
    routines: [], classes: [], tasks: [], notes: [], journal: [],
    currentDay: (() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; })(),
    progressHistory: {}, scheduleHistory: {}, focusSessions: 0,
    tasks: [{ id: 'restore-task', title: 'Restored task', category: 'Project', priority: 'Medium', type: 'one-off', dueDate: '2026-12-15', due: '17:00', progress: 25, completed: false }]
  };
  await page.getByRole('tab', { name: /Advanced Tasks/ }).click();
  await page.locator('#restoreFileInput').setInputFiles({
    name: 'dailyflow_backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup))
  });
  await expect(page.getByText('Backup restored successfully.')).toBeVisible();
  await expect(page.getByText('Restored task')).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Progress for Restored task' })).toHaveValue('25');
});

test('imported task IDs cannot inject markup into the task list', async ({ page }) => {
  page.once('dialog', dialog => dialog.accept());
  const backup = {
    activeTab: 'tasks',
    routines: [], classes: [], notes: [], journal: [], tasks: [
      { id: '\"><img src=x onerror=window.__dailyflowXss=true>', title: 'Safe task', category: 'Personal', priority: 'Low', type: 'one-off', dueDate: '2026-12-15', due: '', progress: 0, completed: false }
    ]
  };

  await page.getByRole('tab', { name: /Advanced Tasks/ }).click();
  await page.locator('#restoreFileInput').setInputFiles({
    name: 'malformed-id-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup))
  });

  await expect(page.getByText('Safe task')).toBeVisible();
  await expect(page.locator('#taskList img')).toHaveCount(0);
  await expect(page.locator('#taskList [onerror]')).toHaveCount(0);
});

test('browser state sync endpoint is healthy and persists data', async ({ request }) => {
  const health = await request.get('/api/health');
  expect(health.ok()).toBeTruthy();
  const stateResponse = await request.get('/api/state');
  expect(stateResponse.ok()).toBeTruthy();
  const persisted = await stateResponse.json();
  expect(Array.isArray(persisted.data.tasks)).toBeTruthy();

  const invalidState = await request.put('/api/state', { data: { state: { tasks: [] } } });
  expect(invalidState.status()).toBe(400);

  const largeState = {
    routines: [], classes: [], tasks: [],
    notes: [{ id: 'large-note', title: 'Large note', tag: 'Test', content: 'x'.repeat(3 * 1024 * 1024) }],
    journal: []
  };
  const largeWrite = await request.put('/api/state', { data: { state: largeState } });
  expect(largeWrite.ok()).toBeTruthy();
});

test('token-protected sync rejects missing and wrong tokens but accepts the valid token', async ({ request }) => {
  const baseURL = process.env.DAILYFLOW_AUTH_TEST_URL;
  const token = process.env.DAILYFLOW_AUTH_TEST_TOKEN;
  expect(baseURL).toBeTruthy();
  expect(token).toBeTruthy();

  const health = await request.get(`${baseURL}/api/health`);
  expect(health.ok()).toBeTruthy();
  expect((await request.get(`${baseURL}/api/state`)).status()).toBe(401);
  expect((await request.get(`${baseURL}/api/state`, {
    headers: { Authorization: 'Bearer wrong-token' }
  })).status()).toBe(401);

  const state = {
    routines: [], classes: [], tasks: [{ id: 'authorized-task', title: 'Authorized write' }],
    notes: [], journal: []
  };
  const headers = { Authorization: `Bearer ${token}` };
  const put = await request.put(`${baseURL}/api/state`, { headers, data: { state } });
  expect(put.ok()).toBeTruthy();
  const read = await request.get(`${baseURL}/api/state`, { headers });
  expect((await read.json()).data.tasks[0].id).toBe('authorized-task');
});
