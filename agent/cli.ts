#!/usr/bin/env bun
// CLI - Control agents from the command line
// Usage: bun cli.ts <command> [options]

import puppeteer, { Browser, Page } from 'puppeteer';
import { BotSDK } from './sdk';

const CONTROLLER_URL = process.env.CONTROLLER_URL || 'http://localhost:7780';
const BOT_URL = process.env.BOT_URL || 'http://localhost:8888/bot';
const DEFAULT_HEADLESS = process.env.HEADLESS === 'true' || process.env.HEADLESS === '1';

interface AgentStatus {
    bot: string;
    running: boolean;
    goal: string | null;
    logCount: number;
    agentServiceConnected: boolean;
}

interface LogEntry {
    timestamp: number;
    type: 'thinking' | 'action' | 'result' | 'error' | 'system' | 'user_message' | 'code';
    content: string;
}

// ANSI color codes
const colors = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
};

function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function formatLogEntry(entry: LogEntry): string {
    const time = `${colors.dim}${formatTime(entry.timestamp)}${colors.reset}`;

    switch (entry.type) {
        case 'thinking':
            return `${time} ${colors.cyan}[THINKING]${colors.reset} ${entry.content}`;
        case 'action':
            return `${time} ${colors.yellow}[ACTION]${colors.reset} ${entry.content}`;
        case 'code':
            const codeLines = entry.content.split('\n');
            const codeFormatted = codeLines.map(l => `  ${colors.yellow}${l}${colors.reset}`).join('\n');
            return `${time} ${colors.yellow}[CODE]${colors.reset}\n${codeFormatted}`;
        case 'result':
            return `${time} ${colors.green}[RESULT]${colors.reset} ${entry.content}`;
        case 'error':
            return `${time} ${colors.red}[ERROR]${colors.reset} ${entry.content}`;
        case 'system':
            return `${time} ${colors.blue}[SYSTEM]${colors.reset} ${entry.content}`;
        case 'user_message':
            return `${time} ${colors.magenta}[USER]${colors.reset} ${entry.content}`;
        default:
            return `${time} [${entry.type}] ${entry.content}`;
    }
}

async function getStatus(botUsername: string): Promise<AgentStatus | null> {
    try {
        const response = await fetch(`${CONTROLLER_URL}/status?bot=${botUsername}`);
        return await response.json() as AgentStatus;
    } catch (e) {
        return null;
    }
}

async function getLog(botUsername: string): Promise<LogEntry[]> {
    try {
        const response = await fetch(`${CONTROLLER_URL}/log?bot=${botUsername}`);
        return await response.json() as LogEntry[];
    } catch (e) {
        return [];
    }
}

async function startAgent(botUsername: string, goal: string): Promise<boolean> {
    try {
        const response = await fetch(`${CONTROLLER_URL}/start?bot=${botUsername}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ goal })
        });
        const result = await response.json() as { ok: boolean };
        return result.ok;
    } catch (e) {
        return false;
    }
}

async function stopAgent(botUsername: string): Promise<boolean> {
    try {
        const response = await fetch(`${CONTROLLER_URL}/stop?bot=${botUsername}`, {
            method: 'POST'
        });
        const result = await response.json() as { ok: boolean };
        return result.ok;
    } catch (e) {
        return false;
    }
}

// Browser launch helper
async function launchBrowser(botName: string, headless: boolean = DEFAULT_HEADLESS): Promise<{ browser: Browser; page: Page }> {
    const browser = await puppeteer.launch({
        headless,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--mute-audio',
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 768 });
    page.setDefaultTimeout(60000);

    // Navigate to bot URL - NO tst=1 so agent panel is visible
    const url = `${BOT_URL}?bot=${botName}&password=test&fps=20`;
    console.log(`${colors.dim}Opening ${url}${colors.reset}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    return { browser, page };
}

// Wait for bot to connect to gateway
async function waitForBotConnection(botName: string, maxWaitMs: number = 60000): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
        try {
            const response = await fetch(`${CONTROLLER_URL}/status`);
            const status = await response.json() as any;
            if (status.bots?.[botName]?.connected) {
                return true;
            }
        } catch {}
        await Bun.sleep(500);
    }
    return false;
}

// Skip tutorial using SDK. Returns true if tutorial was skipped or not needed.
async function skipTutorial(botName: string, maxAttempts: number = 30): Promise<boolean> {
    const sdk = new BotSDK({ botUsername: botName });
    try {
        await sdk.connect();

        // Wait for game state
        await sdk.waitForCondition(s => s.inGame, 30000);

        // Accept character design if modal is open
        const state = sdk.getState();
        if (state?.modalOpen && state.modalInterface === 269) {
            await sdk.sendAcceptCharacterDesign();
            await Bun.sleep(500);
        }

        // Check if we're in tutorial (x < 3200)
        const isInTutorial = () => {
            const s = sdk.getState();
            return !s?.player || s.player.worldX < 3200;
        };

        // If not in tutorial, nothing to do
        if (!isInTutorial()) {
            await sdk.disconnect();
            return true;
        }

        console.log(`${colors.dim}Skipping tutorial...${colors.reset}`);

        let attempts = 0;
        while (isInTutorial() && attempts < maxAttempts) {
            await sdk.sendSkipTutorial();
            await Bun.sleep(1000);
            attempts++;
        }

        const success = !isInTutorial();
        await sdk.disconnect();
        return success;
    } catch (e) {
        try { await sdk.disconnect(); } catch {}
        return false;
    }
}

async function streamLogs(botUsername: string, onComplete?: () => void): Promise<void> {
    let lastLogCount = 0;
    let wasRunning = true;
    let checkCount = 0;
    const maxIdleChecks = 10;  // Stop after 10 checks of no activity (~10 seconds)

    console.log(`${colors.dim}Streaming logs for ${botUsername}...${colors.reset}`);
    console.log(`${colors.dim}Press Ctrl+C to stop${colors.reset}\n`);

    while (true) {
        const status = await getStatus(botUsername);
        if (!status) {
            console.log(`${colors.red}Failed to get status - controller not available?${colors.reset}`);
            break;
        }

        const log = await getLog(botUsername);

        // Print new entries
        if (log.length > lastLogCount) {
            for (let i = lastLogCount; i < log.length; i++) {
                console.log(formatLogEntry(log[i]));
            }
            lastLogCount = log.length;
            checkCount = 0;  // Reset idle counter on activity
        }

        // Check if agent stopped
        if (wasRunning && !status.running) {
            console.log(`\n${colors.green}${colors.bold}Agent completed!${colors.reset}`);
            console.log(`${colors.dim}Logs: ${log.length} entries${colors.reset}`);
            console.log(`${colors.dim}Run recorded to ./runs/ folder${colors.reset}`);
            onComplete?.();
            break;
        }

        // Check for idle timeout when not running
        if (!status.running) {
            checkCount++;
            if (checkCount >= maxIdleChecks) {
                console.log(`\n${colors.yellow}Agent not running and no activity. Exiting.${colors.reset}`);
                break;
            }
        }

        wasRunning = status.running;
        await Bun.sleep(1000);
    }
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        console.log(`
${colors.bold}Agent CLI${colors.reset} - Trigger agent runs from the command line

${colors.bold}Usage:${colors.reset}
  bun cli.ts <command> [options]

${colors.bold}Commands:${colors.reset}
  launch <bot> "<goal>" [options]  Launch browser, start agent, stream logs
  start <bot> "<goal>"             Start agent for bot (bot must already be connected)
  stop <bot>                       Stop running agent
  status [bot]                     Get status (all bots if no bot specified)
  logs <bot>                       Stream logs for bot
  run <bot> "<goal>"               Start agent and stream logs (bot must already be connected)

${colors.bold}Launch options:${colors.reset}
  --no-skip-tutorial     Don't skip tutorial (tutorial is skipped by default)

${colors.bold}Examples:${colors.reset}
  bun cli.ts launch mybot "Get 100 coins"
  bun cli.ts launch mybot "Get 100 coins" --no-skip-tutorial
  bun cli.ts start shopper1 "Walk to the bank"
  bun cli.ts status
  bun cli.ts logs shopper1
  bun cli.ts stop shopper1

${colors.bold}Environment:${colors.reset}
  CONTROLLER_URL   Gateway URL (default: http://localhost:7780)
  BOT_URL          Bot webclient URL (default: http://localhost:8888/bot)
  HEADLESS         Run browser headless (default: false)
`);
        return;
    }

    const command = args[0];

    switch (command) {
        case 'launch': {
            const bot = args[1];
            const goal = args[2];
            const shouldSkipTutorial = !args.includes('--no-skip-tutorial');
            if (!bot || !goal) {
                console.log(`${colors.red}Usage: launch <bot> "<goal>"${colors.reset}`);
                process.exit(1);
            }

            let browser: Browser | null = null;

            // Handle cleanup on Ctrl+C
            const cleanup = async () => {
                console.log(`\n${colors.dim}Cleaning up...${colors.reset}`);
                await stopAgent(bot);
                if (browser) {
                    await browser.close();
                }
                process.exit(0);
            };
            process.removeAllListeners('SIGINT');
            process.on('SIGINT', cleanup);

            try {
                // Launch browser
                console.log(`${colors.cyan}Launching browser for ${bot}...${colors.reset}`);
                const session = await launchBrowser(bot);
                browser = session.browser;

                // Wait for bot to connect to gateway
                console.log(`${colors.dim}Waiting for bot to connect to gateway...${colors.reset}`);
                const connected = await waitForBotConnection(bot);
                if (!connected) {
                    console.log(`${colors.red}Timeout waiting for bot to connect${colors.reset}`);
                    await browser.close();
                    process.exit(1);
                }
                console.log(`${colors.green}Bot connected!${colors.reset}`);

                // Wait a moment for everything to settle
                await Bun.sleep(2000);

                // Skip tutorial if enabled (on by default)
                if (shouldSkipTutorial) {
                    const skipped = await skipTutorial(bot);
                    if (!skipped) {
                        console.log(`${colors.yellow}Warning: Failed to skip tutorial${colors.reset}`);
                    }
                }

                // Start agent
                console.log(`${colors.cyan}Starting agent...${colors.reset}`);
                console.log(`${colors.dim}Goal: ${goal}${colors.reset}\n`);
                const ok = await startAgent(bot, goal);
                if (!ok) {
                    console.log(`${colors.red}Failed to start agent${colors.reset}`);
                    await browser.close();
                    process.exit(1);
                }

                // Stream logs until completion
                await streamLogs(bot, async () => {
                    // Keep browser open briefly for inspection
                    console.log(`${colors.dim}Keeping browser open for 5s...${colors.reset}`);
                    await Bun.sleep(5000);
                    await browser?.close();
                });

            } catch (e: any) {
                console.log(`${colors.red}Error: ${e.message}${colors.reset}`);
                if (browser) await browser.close();
                process.exit(1);
            }
            break;
        }

        case 'start': {
            const bot = args[1];
            const goal = args[2];
            if (!bot || !goal) {
                console.log(`${colors.red}Usage: start <bot> "<goal>"${colors.reset}`);
                process.exit(1);
            }
            console.log(`${colors.cyan}Starting agent for ${bot}...${colors.reset}`);
            console.log(`${colors.dim}Goal: ${goal}${colors.reset}\n`);
            const ok = await startAgent(bot, goal);
            if (ok) {
                console.log(`${colors.green}Agent started!${colors.reset}`);
                console.log(`${colors.dim}Run: bun cli.ts logs ${bot}  to stream logs${colors.reset}`);
            } else {
                console.log(`${colors.red}Failed to start agent. Is the controller running?${colors.reset}`);
                process.exit(1);
            }
            break;
        }

        case 'stop': {
            const bot = args[1];
            if (!bot) {
                console.log(`${colors.red}Usage: stop <bot>${colors.reset}`);
                process.exit(1);
            }
            console.log(`${colors.cyan}Stopping agent for ${bot}...${colors.reset}`);
            const ok = await stopAgent(bot);
            if (ok) {
                console.log(`${colors.green}Agent stopped!${colors.reset}`);
            } else {
                console.log(`${colors.red}Failed to stop agent${colors.reset}`);
                process.exit(1);
            }
            break;
        }

        case 'status': {
            const bot = args[1] || 'all';
            const response = await fetch(`${CONTROLLER_URL}/status?bot=${bot}`);
            const status = await response.json();
            console.log(JSON.stringify(status, null, 2));
            break;
        }

        case 'logs': {
            const bot = args[1];
            if (!bot) {
                console.log(`${colors.red}Usage: logs <bot>${colors.reset}`);
                process.exit(1);
            }
            await streamLogs(bot);
            break;
        }

        case 'run': {
            const bot = args[1];
            const goal = args[2];
            if (!bot || !goal) {
                console.log(`${colors.red}Usage: run <bot> "<goal>"${colors.reset}`);
                process.exit(1);
            }

            // Check if bot is already running
            const status = await getStatus(bot);
            if (status?.running) {
                console.log(`${colors.yellow}Agent already running for ${bot}${colors.reset}`);
                console.log(`${colors.dim}Streaming existing session...${colors.reset}\n`);
            } else {
                console.log(`${colors.cyan}Starting agent for ${bot}...${colors.reset}`);
                console.log(`${colors.dim}Goal: ${goal}${colors.reset}\n`);
                const ok = await startAgent(bot, goal);
                if (!ok) {
                    console.log(`${colors.red}Failed to start agent. Is the controller running?${colors.reset}`);
                    process.exit(1);
                }
                // Give it a moment to start
                await Bun.sleep(500);
            }

            await streamLogs(bot);
            break;
        }

        default:
            console.log(`${colors.red}Unknown command: ${command}${colors.reset}`);
            console.log(`${colors.dim}Run: bun cli.ts --help  for usage${colors.reset}`);
            process.exit(1);
    }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
    console.log(`\n${colors.dim}Interrupted.${colors.reset}`);
    process.exit(0);
});

main().catch(e => {
    console.error(`${colors.red}Error: ${e.message}${colors.reset}`);
    process.exit(1);
});
