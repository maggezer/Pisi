import { defineConfig, devices } from '@playwright/test';

// Phone-sized browser tests against the production build (vite preview).
// Two projects run every test: light and dark system theme.
export default defineConfig({
    testDir: 'e2e',
    outputDir: 'test-results',
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    reporter: 'list',
    use: {
        ...devices['Pixel 7'],
        baseURL: 'http://127.0.0.1:4173',
        locale: 'tr-TR',
        timezoneId: 'Europe/Istanbul',
        trace: 'off'
    },
    projects: [
        { name: 'light', use: { colorScheme: 'light' } },
        { name: 'dark', use: { colorScheme: 'dark' } }
    ],
    webServer: {
        command: 'npm run build && npm run preview',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000
    }
});
