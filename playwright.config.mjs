import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './qa',
  testMatch: '**/*.spec.mjs',
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html',{open:'never'}]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [{name:'chromium',use:{...devices['Desktop Chrome']}}],
  webServer: [
    {command:'npm run dev -- --host 127.0.0.1 --port 5173',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI,timeout:45000},
    {command:'cd backend && npm run start',url:'http://127.0.0.1:3000/api/health',reuseExistingServer:!process.env.CI,timeout:45000}
  ]
});
