#!/usr/bin/env bun
// Puppeteer script to launch bot client and log into the game
// Usage: bun run login.ts [username] [password]

import puppeteer from 'puppeteer';

const BOT_URL = process.env.BOT_URL || 'http://localhost:8888/bot';
const USERNAME = process.argv[2] || 'testbot' + Math.random().toString(36).substring(2, 6);
const PASSWORD = process.argv[3] || 'test';
const HEADLESS = process.argv.includes('--headless') || process.env.HEADLESS === 'true';

async function main() {
    console.log(`[Login] Launching browser...`);
    console.log(`[Login] Bot URL: ${BOT_URL}`);
    console.log(`[Login] Username: ${USERNAME}`);

    const browser = await puppeteer.launch({
        headless: HEADLESS,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-web-security', // For WebSocket connections
            '--window-size=800,700'
        ],
        defaultViewport: {
            width: 800,
            height: 650
        }
    });
    console.log(`[Login] Browser launched (headless: ${HEADLESS})`);

    const page = await browser.newPage();

    // Log console messages from the page
    page.on('console', msg => {
        const text = msg.text();
        if (text.includes('[') || text.includes('error') || text.includes('Error')) {
            console.log(`[Browser] ${text}`);
        }
    });

    // Navigate to bot client
    console.log(`[Login] Loading bot client...`);
    await page.goto(BOT_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for game client to initialize
    console.log(`[Login] Waiting for game client to initialize...`);
    await page.waitForSelector('#bot-username', { timeout: 30000 });

    // Small delay for client to fully load
    await new Promise(r => setTimeout(r, 2000));

    // Fill in username and password
    console.log(`[Login] Entering credentials...`);
    await page.evaluate((username, password) => {
        const usernameField = document.getElementById('bot-username') as HTMLInputElement;
        const passwordField = document.getElementById('bot-password') as HTMLInputElement;
        if (usernameField) usernameField.value = username;
        if (passwordField) passwordField.value = password;
    }, USERNAME, PASSWORD);

    // Click login button
    console.log(`[Login] Clicking login button...`);
    await page.evaluate(() => {
        (window as any).quickLogin();
    });

    // Wait for login to process
    console.log(`[Login] Waiting for login to complete...`);
    await new Promise(r => setTimeout(r, 5000));

    // Check status
    const status = await page.evaluate(() => {
        const statusEl = document.getElementById('bot-status');
        return statusEl?.textContent || 'Unknown';
    });
    console.log(`[Login] Status: ${status}`);

    // Wait for game to fully load
    console.log(`[Login] Waiting for game to fully load...`);
    await new Promise(r => setTimeout(r, 3000));

    // Enable Agent Mode to connect to sync service
    console.log(`[Login] Enabling Agent Mode to connect to sync service...`);
    await page.evaluate(() => {
        // Access the game client and enable agent mode
        const client = (window as any).gameClient;
        if (client && client.enableAgentMode) {
            client.enableAgentMode();
            console.log('Agent mode enabled');
        } else {
            console.log('Could not find gameClient or enableAgentMode');
        }
    });

    await new Promise(r => setTimeout(r, 2000));

    // Keep the browser open for testing
    console.log(`[Login] Browser is running. Press Ctrl+C to close.`);
    console.log(`[Login] You can now use the rsbot CLI to interact with the game.`);

    // Handle cleanup on exit
    process.on('SIGINT', async () => {
        console.log('\n[Login] Closing browser...');
        await browser.close();
        process.exit(0);
    });

    // Keep process alive
    await new Promise(() => { });
}

main().catch(err => {
    console.error('[Login] Error:', err);
    process.exit(1);
});
