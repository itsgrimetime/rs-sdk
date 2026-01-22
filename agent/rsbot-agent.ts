#!/usr/bin/env bun
// rsbot Agent - Claude Agent SDK integration for RuneScape bot
// Uses rsbot CLI via Bash to interact with the game

import { query, ClaudeAgentOptions } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { $ } from 'bun';

// Send a chat message in-game (truncates to 80 chars)
async function sayInGame(text: string): Promise<void> {
    let message = text.trim();
    if (message.length > 80) {
        message = message.substring(0, 80);
    }
    if (message.length > 0) {
        try {
            await $`./rsbot action say ${message}`.quiet();
        } catch {
            // Ignore errors - chat is best effort
        }
    }
}

interface QueuedAction {
    id: string;
    action: any;
    timestamp: number;
    status: 'pending' | 'sent' | 'completed' | 'failed';
    result?: { success: boolean; message: string };
    completedAt?: number;
}

interface ActionQueue {
    pending: QueuedAction[];
    current: QueuedAction | null;
    completed: QueuedAction[];
}

// Wait for any pending/current actions to complete before next iteration
// Returns early if a user message is pending (so we can process it quickly)
async function waitForActionsToComplete(timeout: number = 30000): Promise<void> {
    const actionsFile = join(process.cwd(), 'actions.json');
    const messageFile = join(process.cwd(), 'user-message.json');
    const start = Date.now();

    while (Date.now() - start < timeout) {
        // Check for user message - if present, return early to process it
        if (existsSync(messageFile)) {
            console.log('[Agent] User message detected during wait, returning early to process');
            return;
        }

        if (!existsSync(actionsFile)) {
            return; // No actions file, nothing to wait for
        }

        try {
            const queue: ActionQueue = JSON.parse(readFileSync(actionsFile, 'utf-8'));

            // If no pending actions and no current action (or current is done), we're good
            if (queue.pending.length === 0 &&
                (!queue.current || queue.current.status === 'completed' || queue.current.status === 'failed')) {
                return;
            }

            // Still have pending/active actions, wait a bit
            await new Promise(r => setTimeout(r, 100));
        } catch {
            // Error reading file, try again
            await new Promise(r => setTimeout(r, 100));
        }
    }

    console.log('[Agent] Warning: Timeout waiting for actions to complete');
}

// Check for user message file and consume it
function checkForUserMessage(): string | null {
    const messageFile = join(process.cwd(), 'user-message.json');
    console.log(`[Agent] Checking for user message at: ${messageFile}`);
    if (!existsSync(messageFile)) {
        return null;
    }

    console.log(`[Agent] Found user message file!`);
    try {
        const data = JSON.parse(readFileSync(messageFile, 'utf-8'));
        unlinkSync(messageFile); // Consume the message
        console.log(`[Agent] Received message from user: ${data.message}`);
        return data.message;
    } catch (e) {
        console.error('[Agent] Error reading user message:', e);
        try { unlinkSync(messageFile); } catch {}
        return null;
    }
}

const SYSTEM_PROMPT = `You are an AI agent controlling a character in RuneScape 2 (2004 era). You have access to the rsbot CLI tool to observe the game world and take actions.

## Quick Start
1. Run \`./rsbot status\` to check connection
2. Run \`./rsbot state\` to see the full world state
3. Take actions with \`./rsbot action <type> [args] --wait\`

## Available Commands

### State Commands (Reading Game State)
- \`./rsbot state\` - Full world state in markdown format (comprehensive view)
- \`./rsbot status\` - Connection and sync status
- \`./rsbot player\` - Your player's position, combat level, run energy, weight
- \`./rsbot inventory\` - Inventory items with slot numbers and options (format: [slot] name xcount (id) [op:Option])
- \`./rsbot npcs\` - Nearby NPCs with indices, combat levels, distance, and options
- \`./rsbot locations\` - Nearby interactable objects (trees, doors, rocks, etc.) with coordinates and options
- \`./rsbot ground\` - Ground items nearby with coordinates
- \`./rsbot dialog\` - Current dialog state (options numbered 0-5)
- \`./rsbot messages\` - Recent game messages (combat, skilling, chat)
- \`./rsbot skills\` - All skill levels with current/base level and XP
- \`./rsbot shop\` - Shop interface state (if open) - shows shop items and your items
- \`./rsbot combat\` - Current combat style and available styles with indices

### Action Commands
All actions support \`--wait\` or \`-w\` flag to wait for completion.

**Movement:**
- \`./rsbot action walk <x> <z>\` - Walk to world coordinates
- \`./rsbot action walk <x> <z> --run\` - Run to coordinates (uses run energy)

**NPC Interaction:**
- \`./rsbot action talk <npc_index>\` - Talk to NPC (uses option 1)
- \`./rsbot action interact-npc <index> <option>\` - Use specific NPC option (1-5)

**Object/Location Interaction:**
- \`./rsbot action interact-loc <x> <z> <id> <option>\` - Interact with world object
  - x, z: world coordinates from \`./rsbot locations\`
  - id: object ID
  - option: 1-5 (e.g., 1=Chop down, 1=Mine, 1=Open)

**Ground Items:**
- \`./rsbot action pickup <x> <z> <item_id>\` - Pick up item from ground

**Inventory Actions:**
- \`./rsbot action use-item <slot> <option>\` - Use inventory item (option 1-5)
- \`./rsbot action drop <slot>\` - Drop item from inventory slot
- \`./rsbot action item-on-item <source_slot> <target_slot>\` - Use item on another item (e.g., tinderbox on logs)
- \`./rsbot action item-on-loc <item_slot> <x> <z> <loc_id>\` - Use inventory item on world object

**Dialog:**
- \`./rsbot action dialog <option>\` - Click dialog option
  - 0 = click continue
  - 1-5 = select numbered choice

**Shop:**
- \`./rsbot action shop-buy <slot> [amount]\` - Buy item from shop (amount: 1, 5, or 10)
- \`./rsbot action shop-sell <slot> [amount]\` - Sell inventory item (amount: 1, 5, or 10)

**Combat:**
- \`./rsbot action set-combat-style <style>\` - Change combat style
  - 0 = Accurate (trains Attack)
  - 1 = Aggressive (trains Strength)
  - 2 = Defensive (trains Defence)
  - 3 = Controlled (trains all)

**Tutorial/Misc:**
- \`./rsbot action design\` - Accept character design screen
- \`./rsbot action skip-tutorial\` - Auto-progress through tutorial
- \`./rsbot action wait [ticks]\` - Do nothing for specified ticks (default: 1)
- \`./rsbot action none\` - Explicit no-op

### Utility Commands
- \`./rsbot queue\` - Show current action queue (pending, current, completed)
- \`./rsbot clear\` - Clear all pending actions
- \`./rsbot wait [action_id]\` - Wait for specific action or current action to complete
- \`./rsbot help\` - Show full CLI help

### Multi-Bot Support
- \`./rsbot bots\` - List all available bots with status
- \`./rsbot --bot <name> <command>\` - Run command for specific bot

## Understanding Output Formats

**NPC format:** \`#<index>: <name> (Lvl <combat>) - <distance> tiles [<op>:<Option>, ...]\`
**Location format:** \`<name> at (<x>, <z>) - <distance> tiles, id: <id> [<op>:<Option>, ...]\`
**Inventory format:** \`[<slot>] <name> x<count> (id: <id>) [<op>:<Option>, ...]\`

The \`op:Option\` format shows which option index to use (e.g., \`1:Chop down\` means use option 1).

## Important Rules

1. **Always check state first** - Before acting, use \`./rsbot state\` or specific state commands to understand your situation.

2. **Handle dialogs immediately** - If a dialog is open, you must interact with it before doing anything else. Use \`./rsbot dialog\` to see options.

3. **Use correct indices** - NPCs and inventory items have specific indices/slots. Always check with \`./rsbot npcs\` or \`./rsbot inventory\` first.

4. **Objects use world coordinates** - When interacting with locations (trees, doors), use the world coordinates from \`./rsbot locations\`.

5. **Wait between actions** - Actions take time. Check \`./rsbot messages\` to see if your action completed (e.g., "You get some logs.").

6. **Auto-pathing** - When you interact with NPCs/objects/items, the game auto-walks you there. You don't need to walk first.

7. **Random events** - Respond to random events. Some require you talk to an NPC, others require you pick up an axe head, others need you to run away from a monster (at least 30 tiles) then return.

8. **Use --wait flag** - Add \`--wait\` to actions to block until completion and see the result.

## Example Sessions

### Woodcutting & Firemaking
\`\`\`
./rsbot locations                           # Find trees
./rsbot action interact-loc 3217 3231 1278 1 --wait  # Chop tree (option 1)
./rsbot inventory                           # Check for logs
./rsbot action item-on-item 0 1 --wait      # Use tinderbox (slot 0) on logs (slot 1)
\`\`\`

### Talking to NPCs
\`\`\`
./rsbot npcs                                # Find NPC (e.g., "#5782: RuneScape Guide [1:Talk-to]")
./rsbot action talk 5782 --wait             # Talk to them
./rsbot dialog                              # See dialog options
./rsbot action dialog 0 --wait              # Click continue
./rsbot action dialog 1 --wait              # Select option 1
\`\`\`

### Mining & Smithing
\`\`\`
./rsbot locations                           # Find rocks
./rsbot action interact-loc 3230 3148 2091 1 --wait  # Mine copper
./rsbot inventory                           # Check for ore
\`\`\`

### Combat
\`\`\`
./rsbot combat                              # Check current style
./rsbot action set-combat-style 1 --wait    # Switch to Aggressive (Strength)
./rsbot npcs                                # Find target
./rsbot action interact-npc 1234 1 --wait   # Attack NPC (option 1 = Attack)
\`\`\`

### Shopping
\`\`\`
./rsbot npcs                                # Find shopkeeper
./rsbot action interact-npc 520 2 --wait    # Trade with shopkeeper (option 2)
./rsbot shop                                # View shop inventory
./rsbot action shop-buy 0 10 --wait         # Buy 10 of item in slot 0
./rsbot action shop-sell 5 5 --wait         # Sell 5 of inventory slot 5
\`\`\`

## Task Tracking

You have access to TodoRead and TodoWrite tools to help track progress on complex goals. Consider using them when:
- Your goal has multiple steps or sub-tasks
- You want to stay organized on longer objectives
- You need to remember what you've completed vs what's left

## Current Task

Your current goal will be provided. Work methodically toward it, checking your progress and adapting to what you observe in the game.
`;

const DEFAULT_GOAL = 'Explore Lumbridge and chop some trees to gather logs.';
const MAX_ITERATIONS = 50; // Maximum number of query iterations

async function runAgentIteration(goal: string, iterationNum: number, previousResult?: string, userMessage?: string): Promise<string | null> {
    const isFirstIteration = iterationNum === 1;

    // Build the user message section if present - make it VERY prominent
    const userMessageSection = userMessage
        ? `
================================================================================
🚨 URGENT MESSAGE FROM USER - RESPOND TO THIS FIRST 🚨
================================================================================
${userMessage}
================================================================================
You MUST acknowledge and respond to this message. The user is waiting for your response.
================================================================================

`
        : '';

    const prompt = isFirstIteration
        ? `${userMessageSection}Your goal: ${goal}

First, check the game status with \`./rsbot status\` to verify the connection, then check the current state with \`./rsbot state\` to understand your situation. Then work toward your goal.

After each action, report your progress and what you plan to do next. Do not stop until your goal is achieved.`
        : `${userMessageSection}Continue working toward your goal: ${goal}

Previous status: ${previousResult || 'In progress'}

Check the current state with \`./rsbot state\` and continue working toward your goal. Report progress and keep going until the goal is achieved.`;

    let lastResult: string | null = null;

    for await (const message of query({
        prompt,
        options: {
            systemPrompt: SYSTEM_PROMPT,
            allowedTools: ['Bash', 'TodoRead', 'TodoWrite'],
            permissionMode: 'bypassPermissions',
            cwd: process.cwd()  // Use bot's state directory (set by agent-controller)
        } as ClaudeAgentOptions
    })) {
        if ('type' in message) {
            switch (message.type) {
                case 'system':
                    if (message.subtype === 'init') {
                        console.log(`[Agent] Session started: ${message.session_id}`);
                    }
                    break;

                case 'assistant':
                    if (message.message?.content) {
                        for (const block of message.message.content) {
                            if (block.type === 'text') {
                                console.log(`\n[Claude]: ${block.text}\n`);
                                lastResult = block.text;
                                // Send Claude's response as in-game chat
                                sayInGame(block.text);
                            } else if (block.type === 'tool_use') {
                                console.log(`[Tool]: ${block.name}`);
                                if (block.input && typeof block.input === 'object') {
                                    const input = block.input as Record<string, unknown>;
                                    if (input.command) {
                                        console.log(`  > ${input.command}`);
                                    }
                                    // Log todo items when TodoWrite is used
                                    if (block.name === 'TodoWrite' && Array.isArray(input.todos)) {
                                        const todos = input.todos as Array<{ content: string; status: string }>;
                                        for (const todo of todos) {
                                            const icon = todo.status === 'completed' ? '[x]' : todo.status === 'in_progress' ? '[~]' : '[ ]';
                                            console.log(`  ${icon} ${todo.content}`);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    break;

                case 'user':
                    if (message.message?.content) {
                        for (const block of message.message.content) {
                            if (block.type === 'tool_result') {
                                const content = block.content;
                                if (typeof content === 'string' && content.length > 0) {
                                    const output = content.length > 500
                                        ? content.substring(0, 500) + '...'
                                        : content;
                                    console.log(`[Result]:\n${output}\n`);
                                }
                            }
                        }
                    }
                    break;

                case 'result':
                    if (message.result) {
                        console.log(`[Iteration ${iterationNum} complete]: ${message.result}`);
                        lastResult = message.result;
                    }
                    break;
            }
        }
    }

    return lastResult;
}

async function main() {
    const goal = process.argv[2] || DEFAULT_GOAL;

    console.log('='.repeat(60));
    console.log('rsbot Agent - Claude Agent SDK RuneScape Bot');
    console.log('='.repeat(60));
    console.log(`Goal: ${goal}`);
    console.log(`Max iterations: ${MAX_ITERATIONS}`);
    console.log(`Working directory: ${process.cwd()}`);
    console.log(`User message file would be at: ${join(process.cwd(), 'user-message.json')}`);
    console.log('');

    try {
        let previousResult: string | undefined;

        for (let i = 1; i <= MAX_ITERATIONS; i++) {
            console.log(`\n${'='.repeat(40)}`);
            console.log(`[Agent] Starting iteration ${i}/${MAX_ITERATIONS}`);
            console.log('='.repeat(40));

            // Check for user messages before each iteration
            const userMessage = checkForUserMessage();

            const result = await runAgentIteration(goal, i, previousResult, userMessage || undefined);
            previousResult = result || undefined;

            // Check if goal is achieved (look for completion indicators)
            if (result && (
                result.toLowerCase().includes('goal achieved') ||
                result.toLowerCase().includes('goal complete') ||
                result.toLowerCase().includes('successfully reached') ||
                result.toLowerCase().includes('task complete')
            )) {
                console.log('\n[Agent] Goal appears to be achieved!');
                break;
            }

            // Wait for any pending actions to complete before next iteration
            console.log('[Agent] Waiting for actions to complete...');
            await waitForActionsToComplete();

            // Additional 1 second delay between iterations (skip if message pending)
            if (existsSync(join(process.cwd(), 'user-message.json'))) {
                console.log('[Agent] User message pending, skipping delay to process immediately');
            } else {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        console.log('\n[Agent] Agent session ended.');
    } catch (error) {
        console.error('[Agent] Error:', error);
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
