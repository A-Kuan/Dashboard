import { defineConfig } from '@playwright/test'

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL

export default defineConfig({
  testDir: './tests',
  testMatch: '**/dashboard.spec.js',
  fullyParallel: false,
  reporter: 'line',
  use: {
    baseURL: externalBaseURL || 'http://127.0.0.1:4173',
    viewport: { width: 1680, height: 945 },
    deviceScaleFactor: 1,
    screenshot: 'only-on-failure',
  },
  webServer: externalBaseURL ? undefined : {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
})
