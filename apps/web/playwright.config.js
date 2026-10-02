import { defineConfig } from '@playwright/test'

const webPort = Number(process.env.PLAYWRIGHT_WEB_PORT || 4173)
const localBaseURL = `http://127.0.0.1:${webPort}`

export default defineConfig({
  testDir: './tests',
  testMatch: '**/dashboard.spec.js',
  fullyParallel: false,
  reporter: 'line',
  use: {
    baseURL: localBaseURL,
    viewport: { width: 1680, height: 945 },
    deviceScaleFactor: 1,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${webPort} --strictPort`,
    url: localBaseURL,
    reuseExistingServer: false,
  },
})
