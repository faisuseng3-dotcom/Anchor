import { defineConfig, devices } from '@playwright/test';

// E2E-tester: de flöden som enhetstesterna inte kan nå, eftersom de renderar DOM.
// Allt mot mockad Supabase — testerna rör aldrig produktionsdatabasen.
//
// Körs INTE av `npm run verify` eller spärren före commit: de kräver en webbläsarbinär
// som inte finns förrän `npx playwright install chromium` körts. CI kör dem.
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    // Målgruppen står utomhus med telefonen i handen. Testa den skärmen.
    viewport: { width: 390, height: 844 },
    // Appen används i Stockholm och nightKey()/closingHour() läser lokal tid.
    // Samma skäl som TZ i vitest.config.js.
    timezoneId: 'Europe/Stockholm',
    locale: 'sv-SE',
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'mobil-chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60000
  }
});
