const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: process.env.DAILYFLOW_TEST_BASE_URL || 'http://127.0.0.1:4173',
    browserName: 'chromium',
    headless: true
  }
});
