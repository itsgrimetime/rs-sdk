// Bot SDK - Porcelain Layer
// High-level domain-aware methods that wrap plumbing with game knowledge
// Actions resolve when the EFFECT is complete (not just acknowledged)
// This layer evolves through testing as we learn domain edge cases

import { BotSDK } from './sdk';
import type {
    BotWorldState,
    ActionResult,
    SkillState,
    InventoryItem,
    NearbyNpc,
    NearbyLoc,
    GroundItem,
    DialogState,
    ShopItem
} from './types';

export interface ChopTreeResult {
    success: boolean;
    logs?: InventoryItem;
    message: string;
}

export interface BurnLogsResult {
    success: boolean;
    xpGained: number;
    message: string;
}

export interface PickupResult {
    success: boolean;
    item?: InventoryItem;
    message: string;
    reason?: 'item_not_found' | 'cant_reach' | 'inventory_full' | 'timeout';
}

export interface TalkResult {
    success: boolean;
    dialog?: DialogState;
    message: string;
}

export interface ShopResult {
    success: boolean;
    item?: InventoryItem;
    message: string;
}

export interface ShopSellResult {
    success: boolean;
    message: string;
    amountSold?: number;
    rejected?: boolean;  // True if shop refused to buy this item
}

// Valid sell amounts - maps to shop interface buttons
export type SellAmount = 1 | 5 | 10 | 'all';

export interface EquipResult {
    success: boolean;
    message: string;
}

export interface EatResult {
    success: boolean;
    hpGained: number;
    message: string;
}

export interface AttackResult {
    success: boolean;
    message: string;
    reason?: 'npc_not_found' | 'no_attack_option' | 'out_of_reach' | 'already_in_combat' | 'timeout';
}

export interface OpenDoorResult {
    success: boolean;
    message: string;
    reason?: 'door_not_found' | 'no_open_option' | 'already_open' | 'walk_failed' | 'open_failed' | 'timeout';
    door?: NearbyLoc;
}

export class BotActions {
    constructor(private sdk: BotSDK) {}

    // ============ Porcelain: UI Helpers ============

    /**
     * Dismisses any blocking UI (level-up dialogs, modals, etc.)
     * Many actions can't proceed while dialogs are open, so this
     * should be called before starting actions.
     */
    async dismissBlockingUI(): Promise<void> {
        const maxAttempts = 10;
        for (let i = 0; i < maxAttempts; i++) {
            const state = this.sdk.getState();
            if (!state) break;

            // Check for open dialog (click to continue)
            if (state.dialog.isOpen) {
                console.log(`  [dismissBlockingUI] Dismissing dialog (attempt ${i + 1})`);
                await this.sdk.sendClickDialog(0);
                await this.sdk.waitForStateChange(2000).catch(() => {});
                continue;
            }

            // No blocking UI found
            break;
        }
    }

    // ============ Porcelain: Smart Actions ============
    // These encode domain knowledge about "when is this done?"

    /**
     * Opens a door or gate. Automatically walks to the door if too far.
     *
     * @param target - Door to open (can be NearbyLoc, name string, or RegExp pattern)
     *                 Defaults to finding nearest door with "Open" option
     *
     * Success signals:
     * - Door now has "Close" option (was "Open" before)
     * - Door no longer visible at same location (some doors disappear when opened)
     *
     * Failure modes:
     * - door_not_found: No door matching the pattern was found
     * - no_open_option: Door exists but has no "Open" option (might already be open)
     * - already_open: Door has "Close" option (already open)
     * - walk_failed: Could not walk to the door
     * - open_failed: Clicked open but door didn't change state
     * - timeout: Waited too long for door to open
     */
    async openDoor(target?: NearbyLoc | string | RegExp): Promise<OpenDoorResult> {
        // Find door
        const door = this.resolveLocation(target, /door|gate/i);
        if (!door) {
            return {
                success: false,
                message: 'No door found nearby',
                reason: 'door_not_found'
            };
        }

        // Check if door has "Open" option
        const openOpt = door.optionsWithIndex.find(o => /^open$/i.test(o.text));
        if (!openOpt) {
            // Check if it's already open (has "Close" option)
            const closeOpt = door.optionsWithIndex.find(o => /^close$/i.test(o.text));
            if (closeOpt) {
                return {
                    success: true,
                    message: `${door.name} is already open`,
                    reason: 'already_open',
                    door
                };
            }
            return {
                success: false,
                message: `${door.name} has no Open option (options: ${door.options.join(', ')})`,
                reason: 'no_open_option',
                door
            };
        }

        // If door is too far, walk to it first
        // Most doors require being within 1-2 tiles to interact
        if (door.distance > 2) {
            const walkResult = await this.walkTo(door.x, door.z);
            if (!walkResult.success) {
                return {
                    success: false,
                    message: `Could not walk to ${door.name}: ${walkResult.message}`,
                    reason: 'walk_failed',
                    door
                };
            }

            // Re-find the door after walking (our NearbyLoc might be stale)
            const doorsNow = this.sdk.getNearbyLocs().filter(l =>
                l.x === door.x && l.z === door.z && /door|gate/i.test(l.name)
            );
            const refreshedDoor = doorsNow[0];
            if (!refreshedDoor) {
                // Door not visible anymore - might have been opened by someone else
                return {
                    success: true,
                    message: `${door.name} is no longer visible (may have been opened)`,
                    door
                };
            }

            // Check if still has Open option
            const refreshedOpenOpt = refreshedDoor.optionsWithIndex.find(o => /^open$/i.test(o.text));
            if (!refreshedOpenOpt) {
                const hasClose = refreshedDoor.optionsWithIndex.some(o => /^close$/i.test(o.text));
                if (hasClose) {
                    return {
                        success: true,
                        message: `${door.name} is already open`,
                        reason: 'already_open',
                        door: refreshedDoor
                    };
                }
                return {
                    success: false,
                    message: `${door.name} no longer has Open option`,
                    reason: 'no_open_option',
                    door: refreshedDoor
                };
            }

            // Use refreshed door for interaction
            await this.sdk.sendInteractLoc(refreshedDoor.x, refreshedDoor.z, refreshedDoor.id, refreshedOpenOpt.opIndex);
        } else {
            // Door is close enough, open it directly
            await this.sdk.sendInteractLoc(door.x, door.z, door.id, openOpt.opIndex);
        }

        // Wait for door to change state
        const doorX = door.x;
        const doorZ = door.z;
        const startTick = this.sdk.getState()?.tick || 0;

        try {
            await this.sdk.waitForCondition(state => {
                // Check for failure messages
                for (const msg of state.gameMessages) {
                    if (msg.tick > startTick) {
                        const text = msg.text.toLowerCase();
                        if (text.includes("can't reach") || text.includes("cannot reach")) {
                            return true; // Will check below
                        }
                    }
                }

                // Check if door at same location now has "Close" option (opened)
                const doorNow = state.nearbyLocs.find(l =>
                    l.x === doorX && l.z === doorZ && /door|gate/i.test(l.name)
                );
                if (!doorNow) {
                    return true; // Door gone (some doors disappear when opened)
                }
                // Check if it now has Close option instead of Open
                const hasClose = doorNow.optionsWithIndex.some(o => /^close$/i.test(o.text));
                const hasOpen = doorNow.optionsWithIndex.some(o => /^open$/i.test(o.text));
                return hasClose && !hasOpen;
            }, 5000);

            // Check what happened
            const finalState = this.sdk.getState();

            // Check for "can't reach" message
            for (const msg of finalState?.gameMessages ?? []) {
                if (msg.tick > startTick) {
                    const text = msg.text.toLowerCase();
                    if (text.includes("can't reach") || text.includes("cannot reach")) {
                        return {
                            success: false,
                            message: `Cannot reach ${door.name} - still blocked`,
                            reason: 'open_failed',
                            door
                        };
                    }
                }
            }

            // Verify door is open
            const doorAfter = finalState?.nearbyLocs.find(l =>
                l.x === doorX && l.z === doorZ && /door|gate/i.test(l.name)
            );

            if (!doorAfter) {
                return {
                    success: true,
                    message: `Opened ${door.name}`,
                    door
                };
            }

            const hasCloseNow = doorAfter.optionsWithIndex.some(o => /^close$/i.test(o.text));
            if (hasCloseNow) {
                return {
                    success: true,
                    message: `Opened ${door.name}`,
                    door: doorAfter
                };
            }

            return {
                success: false,
                message: `${door.name} did not open`,
                reason: 'open_failed',
                door: doorAfter
            };

        } catch {
            return {
                success: false,
                message: `Timeout waiting for ${door.name} to open`,
                reason: 'timeout',
                door
            };
        }
    }

    /**
     * Chops a tree and waits for logs to appear in inventory.
     * Finds the nearest tree matching the pattern if not specified.
     */
    async chopTree(target?: NearbyLoc | string | RegExp): Promise<ChopTreeResult> {
        // Dismiss any blocking UI before starting
        await this.dismissBlockingUI();

        const tree = this.resolveLocation(target, /^tree$/i);
        if (!tree) {
            return { success: false, message: 'No tree found' };
        }

        const invCountBefore = this.sdk.getInventory().length;
        const result = await this.sdk.sendInteractLoc(tree.x, tree.z, tree.id, 1);

        if (!result.success) {
            return { success: false, message: result.message };
        }

        try {
            // Wait for: new item in inventory OR tree disappears
            await this.sdk.waitForCondition(state => {
                const newItem = state.inventory.length > invCountBefore;
                const treeGone = !state.nearbyLocs.find(l =>
                    l.x === tree.x && l.z === tree.z && l.id === tree.id
                );
                return newItem || treeGone;
            }, 30000);

            const logs = this.sdk.findInventoryItem(/logs/i);
            return {
                success: true,
                logs: logs || undefined,
                message: 'Chopped tree'
            };
        } catch {
            return { success: false, message: 'Timed out waiting for tree chop' };
        }
    }

    /**
     * Burns logs with a tinderbox and waits for firemaking to complete.
     * Automatically finds tinderbox and logs if not specified.
     *
     * This function will NOT return until:
     * - SUCCESS: Firemaking XP increases (fire was lit)
     * - FAILURE: Timeout expires, or failure message detected
     */
    async burnLogs(logsTarget?: InventoryItem | string | RegExp): Promise<BurnLogsResult> {
        // Dismiss any blocking UI (level-up dialogs, etc.) before starting
        await this.dismissBlockingUI();

        const tinderbox = this.sdk.findInventoryItem(/tinderbox/i);
        if (!tinderbox) {
            return { success: false, xpGained: 0, message: 'No tinderbox in inventory' };
        }

        const logs = this.resolveInventoryItem(logsTarget, /logs/i);
        if (!logs) {
            return { success: false, xpGained: 0, message: 'No logs in inventory' };
        }

        const fmBefore = this.sdk.getSkill('Firemaking')?.experience || 0;
        const logsCountBefore = this.sdk.getInventory().filter(i => /logs/i.test(i.name)).length;

        const result = await this.sdk.sendUseItemOnItem(tinderbox.slot, logs.slot);
        if (!result.success) {
            return { success: false, xpGained: 0, message: result.message };
        }

        // Record the current tick so we can filter for NEW messages only
        const startTick = this.sdk.getState()?.tick || 0;

        // Wait for firemaking to complete - this is the key domain knowledge:
        // - XP gain is the ONLY reliable success indicator
        // - Logs disappearing alone doesn't mean success (could be dropped, etc.)
        // - Failure messages are checked, but ONLY if they arrived after we started (using tick)
        // - Timeout of 30s allows for walking + animation
        // - Level-up dialogs can appear mid-action and must be dismissed
        let lastDialogClickTick = 0;
        try {
            await this.sdk.waitForCondition(state => {
                // Check for XP gain - this is SUCCESS
                const fmXp = state.skills.find(s => s.name === 'Firemaking')?.experience || 0;
                if (fmXp > fmBefore) {
                    return true;  // Fire was lit!
                }

                // If a dialog opened during the action (e.g., level-up), dismiss it
                // Level-up dialogs can have multiple pages, so keep clicking every few ticks
                // We do this AFTER checking XP so we don't miss the success
                if (state.dialog.isOpen && (state.tick - lastDialogClickTick) >= 3) {
                    lastDialogClickTick = state.tick;
                    // Fire and forget - the next state update will show if it closed
                    this.sdk.sendClickDialog(0).catch(() => {});
                }

                // Check for failure messages that arrived AFTER we started
                // (filtering by tick prevents old messages from causing false failures)
                const failureMessages = [
                    "can't light a fire",
                    "you need to move",
                    "can't do that here"
                ];
                for (const msg of state.gameMessages) {
                    // Only check messages that arrived after we started
                    if (msg.tick > startTick) {
                        const text = msg.text.toLowerCase();
                        if (failureMessages.some(f => text.includes(f))) {
                            return true;  // Will check XP below to determine success/failure
                        }
                    }
                }

                return false;
            }, 30000);

            const fmAfter = this.sdk.getSkill('Firemaking')?.experience || 0;
            const xpGained = fmAfter - fmBefore;

            return {
                success: xpGained > 0,
                xpGained,
                message: xpGained > 0 ? 'Burned logs' : 'Failed to light fire (possibly bad location)'
            };
        } catch {
            return { success: false, xpGained: 0, message: 'Timed out waiting for fire' };
        }
    }

    /**
     * Picks up a ground item and waits for it to appear in inventory.
     *
     * Failure modes:
     * - item_not_found: No item matching the pattern was found on ground
     * - cant_reach: Path to item is blocked (door, wall, obstacle)
     * - inventory_full: Inventory is full
     * - timeout: Waited too long for item to appear in inventory
     */
    async pickupItem(target: GroundItem | string | RegExp): Promise<PickupResult> {
        const item = this.resolveGroundItem(target);
        if (!item) {
            return {
                success: false,
                message: 'Item not found on ground',
                reason: 'item_not_found'
            };
        }

        const invCountBefore = this.sdk.getInventory().length;
        const startTick = this.sdk.getState()?.tick || 0;
        const result = await this.sdk.sendPickup(item.x, item.z, item.id);

        if (!result.success) {
            return { success: false, message: result.message };
        }

        try {
            // Wait for: inventory count increases OR failure message
            const finalState = await this.sdk.waitForCondition(state => {
                // Check for failure messages (arrived after we started)
                for (const msg of state.gameMessages) {
                    if (msg.tick > startTick) {
                        const text = msg.text.toLowerCase();
                        if (text.includes("can't reach") || text.includes("cannot reach")) {
                            return true; // Will check below
                        }
                        if (text.includes("inventory") && text.includes("full")) {
                            return true; // Will check below
                        }
                    }
                }

                // Check for success - item in inventory
                return state.inventory.length > invCountBefore;
            }, 10000);

            // Check what caused us to exit
            for (const msg of finalState.gameMessages) {
                if (msg.tick > startTick) {
                    const text = msg.text.toLowerCase();
                    if (text.includes("can't reach") || text.includes("cannot reach")) {
                        return {
                            success: false,
                            message: `Cannot reach ${item.name} at (${item.x}, ${item.z}) - path blocked`,
                            reason: 'cant_reach'
                        };
                    }
                    if (text.includes("inventory") && text.includes("full")) {
                        return {
                            success: false,
                            message: 'Inventory is full',
                            reason: 'inventory_full'
                        };
                    }
                }
            }

            // Success - find the item that was just picked up
            const pickedUp = this.sdk.getInventory().find(i =>
                i.id === item.id
            );

            return {
                success: true,
                item: pickedUp,
                message: `Picked up ${item.name}`
            };
        } catch {
            return {
                success: false,
                message: 'Timed out waiting for pickup',
                reason: 'timeout'
            };
        }
    }

    /**
     * Talks to an NPC and waits for dialog to open.
     */
    async talkTo(target: NearbyNpc | string | RegExp): Promise<TalkResult> {
        const npc = this.resolveNpc(target);
        if (!npc) {
            return { success: false, message: 'NPC not found' };
        }

        const result = await this.sdk.sendTalkToNpc(npc.index);
        if (!result.success) {
            return { success: false, message: result.message };
        }

        try {
            // Wait for dialog to open
            const state = await this.sdk.waitForCondition(s =>
                s.dialog.isOpen,
                10000
            );

            return {
                success: true,
                dialog: state.dialog,
                message: `Talking to ${npc.name}`
            };
        } catch {
            return { success: false, message: 'Timed out waiting for dialog' };
        }
    }

    /**
     * Walks to a location using server-side pathfinding.
     * Uses the rsmod WASM pathfinder which has access to the full collision map,
     * so it automatically navigates around obstacles like walls and buildings.
     *
     * Works for any distance - short walks and long city-to-city journeys.
     * For very long distances beyond the pathfinder's search radius (~100 tiles),
     * it will re-query after making progress.
     *
     * @param x - Destination world X coordinate
     * @param z - Destination world Z coordinate
     *
     * Note: This does NOT handle doors, stairs, or teleports. If the path
     * is blocked by a closed door, use openDoor() first. For multi-level
     * navigation, call this separately for each floor.
     */
    async walkTo(x: number, z: number): Promise<ActionResult> {
        const tolerance = 3;
        const startState = this.sdk.getState();
        if (!startState?.player) {
            return { success: false, message: 'No player state' };
        }

        const startX = startState.player.worldX;
        const startZ = startState.player.worldZ;

        // Check if already at destination
        const startDist = Math.sqrt(Math.pow(x - startX, 2) + Math.pow(z - startZ, 2));
        if (startDist <= tolerance) {
            return { success: true, message: `Already at (${x}, ${z})` };
        }

        const MAX_PATH_QUERIES = 20;
        let stuckCount = 0;

        for (let query = 0; query < MAX_PATH_QUERIES; query++) {
            const currentState = this.sdk.getState();
            if (!currentState?.player) {
                return { success: false, message: 'Lost player state' };
            }

            const currentX = currentState.player.worldX;
            const currentZ = currentState.player.worldZ;

            // Check if we've arrived
            const distToGoal = Math.sqrt(Math.pow(x - currentX, 2) + Math.pow(z - currentZ, 2));
            if (distToGoal <= tolerance) {
                return { success: true, message: `Arrived at (${currentX}, ${currentZ})` };
            }

            // Ask pathfinder for path to destination
            let pathResult = await this.sdk.sendFindPath(x, z, 500);

            // If destination is too far (pathfinder has ~100 tile search radius),
            // calculate a closer intermediate target in the direction of the goal
            if ((!pathResult.waypoints || pathResult.waypoints.length === 0) && distToGoal > 60) {
                const INTERMEDIATE_DIST = 60;
                const ratio = INTERMEDIATE_DIST / distToGoal;
                const intermediateX = Math.round(currentX + (x - currentX) * ratio);
                const intermediateZ = Math.round(currentZ + (z - currentZ) * ratio);
                pathResult = await this.sdk.sendFindPath(intermediateX, intermediateZ, 500);
            }

            if (!pathResult.success || !pathResult.waypoints || pathResult.waypoints.length === 0) {
                // No path found - try a direct walk command as last resort
                await this.sdk.sendWalk(x, z, true);
                try {
                    await this.sdk.waitForCondition(s => {
                        if (!s.player) return false;
                        const d = Math.sqrt(Math.pow(x - s.player.worldX, 2) + Math.pow(z - s.player.worldZ, 2));
                        return d <= tolerance;
                    }, 10000);
                    return { success: true, message: `Arrived at (${x}, ${z})` };
                } catch {
                    return { success: false, message: `No path found to (${x}, ${z})` };
                }
            }

            const waypoints = pathResult.waypoints;

            // Follow waypoints from the path
            // Walk to every 5th waypoint (~5 tiles) for efficiency while staying on path
            const WAYPOINT_STEP = 5;
            for (let wpIndex = Math.min(WAYPOINT_STEP - 1, waypoints.length - 1); wpIndex < waypoints.length; wpIndex += WAYPOINT_STEP) {
                const wp = waypoints[wpIndex];
                await this.sdk.sendWalk(wp.x, wp.z, true);

                try {
                    await this.sdk.waitForCondition(s => {
                        if (!s.player) return false;
                        const dx = Math.abs(s.player.worldX - wp.x);
                        const dz = Math.abs(s.player.worldZ - wp.z);
                        return dx <= 3 && dz <= 3;
                    }, 5000);
                } catch {
                    // Timeout - continue anyway
                }

                const checkState = this.sdk.getState();
                if (!checkState?.player) {
                    return { success: false, message: 'Lost connection during walk' };
                }

                // Check if we've arrived at final destination
                const newDist = Math.sqrt(Math.pow(x - checkState.player.worldX, 2) + Math.pow(z - checkState.player.worldZ, 2));
                if (newDist <= tolerance) {
                    return { success: true, message: `Arrived at (${checkState.player.worldX}, ${checkState.player.worldZ})` };
                }
            }

            // Walk to the last waypoint
            const lastWp = waypoints[waypoints.length - 1];
            await this.sdk.sendWalk(lastWp.x, lastWp.z, true);
            try {
                await this.sdk.waitForCondition(s => {
                    if (!s.player) return false;
                    const dx = Math.abs(s.player.worldX - lastWp.x);
                    const dz = Math.abs(s.player.worldZ - lastWp.z);
                    return dx <= 3 && dz <= 3;
                }, 5000);
            } catch {
                // Continue even if we don't reach exactly
            }

            // Check progress
            const afterState = this.sdk.getState();
            const afterX = afterState?.player?.worldX ?? currentX;
            const afterZ = afterState?.player?.worldZ ?? currentZ;
            const newDistToGoal = Math.sqrt(Math.pow(x - afterX, 2) + Math.pow(z - afterZ, 2));

            if (newDistToGoal <= tolerance) {
                return { success: true, message: `Arrived at (${afterX}, ${afterZ})` };
            }

            // Check if we made progress
            const progressMade = distToGoal - newDistToGoal;
            if (progressMade < 5) {
                stuckCount++;
                if (stuckCount >= 3) {
                    return { success: false, message: `Stuck at (${afterX}, ${afterZ}) - cannot reach (${x}, ${z})` };
                }
            } else {
                stuckCount = 0;
            }
        }

        const finalState = this.sdk.getState();
        const finalX = finalState?.player?.worldX ?? startX;
        const finalZ = finalState?.player?.worldZ ?? startZ;
        const finalDist = Math.sqrt(Math.pow(x - finalX, 2) + Math.pow(z - finalZ, 2));

        return {
            success: finalDist <= tolerance,
            message: finalDist <= tolerance
                ? `Arrived at (${finalX}, ${finalZ})`
                : `Could not reach (${x}, ${z}) - stopped at (${finalX}, ${finalZ})`
        };
    }

    // ============ Porcelain: Shop Actions ============

    /**
     * Opens a shop by trading with a shopkeeper NPC.
     * Waits for the shop interface to open.
     */
    async openShop(target: NearbyNpc | string | RegExp = /shop\s*keeper/i): Promise<ActionResult> {
        const npc = this.resolveNpc(target);
        if (!npc) {
            return { success: false, message: 'Shopkeeper not found' };
        }

        // Find "Trade" option
        const tradeOpt = npc.optionsWithIndex.find(o => /trade/i.test(o.text));
        if (!tradeOpt) {
            return { success: false, message: 'No trade option on NPC' };
        }

        const result = await this.sdk.sendInteractNpc(npc.index, tradeOpt.opIndex);
        if (!result.success) {
            return result;
        }

        try {
            await this.sdk.waitForCondition(state => state.shop.isOpen, 10000);
            return { success: true, message: `Opened shop: ${this.sdk.getState()?.shop.title}` };
        } catch {
            return { success: false, message: 'Timed out waiting for shop to open' };
        }
    }

    /**
     * Buys an item from an open shop.
     * Waits for the item to appear in inventory.
     * Fails if item doesn't appear (e.g., no coins, shop out of stock).
     */
    async buyFromShop(target: ShopItem | string | RegExp, amount: number = 1): Promise<ShopResult> {
        const shop = this.sdk.getState()?.shop;
        if (!shop?.isOpen) {
            return { success: false, message: 'Shop is not open' };
        }

        const shopItem = this.resolveShopItem(target, shop.shopItems);
        if (!shopItem) {
            return { success: false, message: `Item not found in shop: ${target}` };
        }

        // Track inventory before purchase
        const invBefore = this.sdk.getInventory();
        const hadItemBefore = invBefore.find(i => i.id === shopItem.id);
        const countBefore = hadItemBefore?.count ?? 0;

        const result = await this.sdk.sendShopBuy(shopItem.slot, amount);
        if (!result.success) {
            return { success: false, message: result.message };
        }

        try {
            // Wait for item to appear or count to increase
            await this.sdk.waitForCondition(state => {
                const item = state.inventory.find(i => i.id === shopItem.id);
                if (!item) return false;
                return item.count > countBefore;
            }, 5000);

            const boughtItem = this.sdk.getInventory().find(i => i.id === shopItem.id);
            return {
                success: true,
                item: boughtItem,
                message: `Bought ${shopItem.name} x${amount}`
            };
        } catch {
            return { success: false, message: `Failed to buy ${shopItem.name} (no coins or out of stock?)` };
        }
    }

    /**
     * Sells an item to an open shop.
     * Waits for the item to leave inventory (or count to decrease).
     * Accepts InventoryItem, ShopItem (from shop.playerItems), or a pattern.
     *
     * @param target - Item to sell (InventoryItem, ShopItem, string pattern, or RegExp)
     * @param amount - Amount to sell: 1, 5, 10, or 'all' (default: 1)
     *
     * Error detection:
     * - "You can't sell this item to a shop." - item is coins
     * - "You can't sell this item." - item is untradeable
     * - "You can't sell this item to this shop." - shop doesn't buy this item type
     */
    async sellToShop(target: InventoryItem | ShopItem | string | RegExp, amount: SellAmount = 1): Promise<ShopSellResult> {
        const shop = this.sdk.getState()?.shop;
        if (!shop?.isOpen) {
            return { success: false, message: 'Shop is not open' };
        }

        // Find item in player's shop inventory (items available to sell)
        const sellItem = this.resolveShopItem(target, shop.playerItems);
        if (!sellItem) {
            return { success: false, message: `Item not found to sell: ${target}` };
        }

        const countBefore = sellItem.count;
        const startTick = this.sdk.getState()?.tick || 0;

        // For 'all', we need to sell in batches of 10 until done
        if (amount === 'all') {
            return this.sellAllToShop(sellItem, startTick);
        }

        // Valid amounts are 1, 5, 10
        const validAmount = [1, 5, 10].includes(amount) ? amount : 1;

        const result = await this.sdk.sendShopSell(sellItem.slot, validAmount);
        if (!result.success) {
            return { success: false, message: result.message };
        }

        // Check for rejection messages or successful sale
        try {
            const finalState = await this.sdk.waitForCondition(state => {
                // Check for rejection messages (arrived after we started)
                for (const msg of state.gameMessages) {
                    if (msg.tick > startTick) {
                        const text = msg.text.toLowerCase();
                        if (text.includes("can't sell this item")) {
                            return true; // Rejected - exit early
                        }
                    }
                }

                // Check for successful sale (item count decreased)
                const item = state.shop.playerItems.find(i => i.id === sellItem.id);
                if (!item) return true;  // Item gone completely
                return item.count < countBefore;  // Count decreased
            }, 5000);

            // Check if it was a rejection
            for (const msg of finalState.gameMessages) {
                if (msg.tick > startTick) {
                    const text = msg.text.toLowerCase();
                    if (text.includes("can't sell this item to this shop")) {
                        return {
                            success: false,
                            message: `Shop doesn't buy ${sellItem.name}`,
                            rejected: true
                        };
                    }
                    if (text.includes("can't sell this item to a shop")) {
                        return {
                            success: false,
                            message: `Cannot sell ${sellItem.name} to any shop`,
                            rejected: true
                        };
                    }
                    if (text.includes("can't sell this item")) {
                        return {
                            success: false,
                            message: `${sellItem.name} is not tradeable`,
                            rejected: true
                        };
                    }
                }
            }

            // Calculate actual amount sold
            const itemAfter = finalState.shop.playerItems.find(i => i.id === sellItem.id);
            const countAfter = itemAfter?.count ?? 0;
            const amountSold = countBefore - countAfter;

            return {
                success: true,
                message: `Sold ${sellItem.name} x${amountSold}`,
                amountSold
            };
        } catch {
            return { success: false, message: `Failed to sell ${sellItem.name} (timeout)` };
        }
    }

    /**
     * Sells all of an item to the shop by repeatedly selling 10 at a time.
     * Stops if the shop rejects the item or we run out.
     */
    private async sellAllToShop(sellItem: ShopItem, startTick: number): Promise<ShopSellResult> {
        let totalSold = 0;

        while (true) {
            const state = this.sdk.getState();
            if (!state?.shop.isOpen) {
                break;
            }

            const currentItem = state.shop.playerItems.find(i => i.id === sellItem.id);
            if (!currentItem || currentItem.count === 0) {
                break; // All sold
            }

            const countBefore = currentItem.count;
            const sellAmount = Math.min(10, countBefore);

            const result = await this.sdk.sendShopSell(sellItem.slot, sellAmount);
            if (!result.success) {
                break;
            }

            // Wait for sale to complete or rejection
            try {
                const finalState = await this.sdk.waitForCondition(s => {
                    // Check for rejection
                    for (const msg of s.gameMessages) {
                        if (msg.tick > startTick) {
                            if (msg.text.toLowerCase().includes("can't sell this item")) {
                                return true;
                            }
                        }
                    }

                    // Check for count decrease
                    const item = s.shop.playerItems.find(i => i.id === sellItem.id);
                    if (!item) return true;
                    return item.count < countBefore;
                }, 3000);

                // Check for rejection
                for (const msg of finalState.gameMessages) {
                    if (msg.tick > startTick) {
                        const text = msg.text.toLowerCase();
                        if (text.includes("can't sell this item to this shop")) {
                            return {
                                success: totalSold > 0,
                                message: totalSold > 0
                                    ? `Sold ${sellItem.name} x${totalSold}, then shop stopped buying`
                                    : `Shop doesn't buy ${sellItem.name}`,
                                amountSold: totalSold,
                                rejected: true
                            };
                        }
                        if (text.includes("can't sell this item")) {
                            return {
                                success: false,
                                message: `${sellItem.name} cannot be sold`,
                                amountSold: totalSold,
                                rejected: true
                            };
                        }
                    }
                }

                // Count what was sold
                const itemAfter = finalState.shop.playerItems.find(i => i.id === sellItem.id);
                const countAfter = itemAfter?.count ?? 0;
                totalSold += (countBefore - countAfter);

                // If nothing sold, exit
                if (countBefore === countAfter) {
                    break;
                }

            } catch {
                break; // Timeout
            }
        }

        if (totalSold === 0) {
            return {
                success: false,
                message: `Failed to sell any ${sellItem.name}`
            };
        }

        return {
            success: true,
            message: `Sold ${sellItem.name} x${totalSold}`,
            amountSold: totalSold
        };
    }

    // ============ Porcelain: Equipment & Combat ============

    /**
     * Equips an item from inventory.
     * Waits for the item to move to equipment slot.
     */
    async equipItem(target: InventoryItem | string | RegExp): Promise<EquipResult> {
        const item = this.resolveInventoryItem(target, /./);
        if (!item) {
            return { success: false, message: `Item not found: ${target}` };
        }

        // Find "Wield" or "Wear" option
        const equipOpt = item.optionsWithIndex.find(o => /wield|wear|equip/i.test(o.text));
        if (!equipOpt) {
            return { success: false, message: `No equip option on ${item.name}` };
        }

        const invCountBefore = this.sdk.getInventory().length;
        const result = await this.sdk.sendUseItem(item.slot, equipOpt.opIndex);
        if (!result.success) {
            return { success: false, message: result.message };
        }

        try {
            // Wait for item to leave inventory (moved to equipment)
            await this.sdk.waitForCondition(state =>
                !state.inventory.find(i => i.slot === item.slot && i.id === item.id),
                5000
            );
            return { success: true, message: `Equipped ${item.name}` };
        } catch {
            return { success: false, message: `Failed to equip ${item.name}` };
        }
    }

    /**
     * Eats food from inventory.
     * Waits for HP to increase or food to be consumed.
     */
    async eatFood(target: InventoryItem | string | RegExp): Promise<EatResult> {
        const food = this.resolveInventoryItem(target, /./);
        if (!food) {
            return { success: false, hpGained: 0, message: `Food not found: ${target}` };
        }

        // Find "Eat" option
        const eatOpt = food.optionsWithIndex.find(o => /eat/i.test(o.text));
        if (!eatOpt) {
            return { success: false, hpGained: 0, message: `No eat option on ${food.name}` };
        }

        const hpBefore = this.sdk.getSkill('Hitpoints')?.level ?? 10;
        const foodCountBefore = this.sdk.getInventory().filter(i => i.id === food.id).length;

        const result = await this.sdk.sendUseItem(food.slot, eatOpt.opIndex);
        if (!result.success) {
            return { success: false, hpGained: 0, message: result.message };
        }

        try {
            // Wait for HP to increase OR food count to decrease
            await this.sdk.waitForCondition(state => {
                const hp = state.skills.find(s => s.name === 'Hitpoints')?.level ?? 10;
                const foodCount = state.inventory.filter(i => i.id === food.id).length;
                return hp > hpBefore || foodCount < foodCountBefore;
            }, 5000);

            const hpAfter = this.sdk.getSkill('Hitpoints')?.level ?? 10;
            return {
                success: true,
                hpGained: hpAfter - hpBefore,
                message: `Ate ${food.name}`
            };
        } catch {
            return { success: false, hpGained: 0, message: `Failed to eat ${food.name}` };
        }
    }

    /**
     * Attacks an NPC and waits for combat to start or failure to be detected.
     *
     * @param target - NPC to attack (can be NearbyNpc object, name string, or RegExp pattern)
     * @param timeout - How long to wait for combat confirmation in ms (default: 5000)
     *
     * Detects these failure modes:
     * - "I can't reach that!" - obstacle between player and NPC (e.g., fence, gate, wall)
     * - "Someone else is fighting that" - NPC already in combat with another player
     *
     * When blocked by an obstacle, use bot.openDoor() to open the gate/door, then retry.
     */
    async attackNpc(
        target: NearbyNpc | string | RegExp,
        timeout: number = 5000
    ): Promise<AttackResult> {

        const npc = this.resolveNpc(target);
        if (!npc) {
            return { success: false, message: `NPC not found: ${target}`, reason: 'npc_not_found' };
        }

        // Find "Attack" option
        const attackOpt = npc.optionsWithIndex.find(o => /attack/i.test(o.text));
        if (!attackOpt) {
            return { success: false, message: `No attack option on ${npc.name}`, reason: 'no_attack_option' };
        }

        const startTick = this.sdk.getState()?.tick || 0;
        const result = await this.sdk.sendInteractNpc(npc.index, attackOpt.opIndex);
        if (!result.success) {
            return { success: false, message: result.message };
        }

        // Wait for combat to start or failure message
        try {
            const finalState = await this.sdk.waitForCondition(state => {
                // Check for failure messages (arrived after we sent the attack command)
                for (const msg of state.gameMessages) {
                    if (msg.tick > startTick) {
                        const text = msg.text.toLowerCase();
                        if (text.includes("can't reach") || text.includes("cannot reach")) {
                            return true; // Out of reach - exit early
                        }
                        if (text.includes("someone else is fighting") || text.includes("already under attack")) {
                            return true; // Already in combat - exit early
                        }
                    }
                }

                // Check if NPC has disappeared (likely we're fighting it or it died)
                const targetNpc = state.nearbyNpcs.find(n => n.index === npc.index);
                if (!targetNpc) {
                    return true; // NPC gone - combat likely started or it died
                }

                // Check if we've moved closer to the NPC (walking to attack)
                // and NPC distance is very close (within melee range)
                if (targetNpc.distance <= 2) {
                    return true; // Close enough - combat should be starting
                }

                return false;
            }, timeout);

            // Check what caused us to exit the wait
            for (const msg of finalState.gameMessages) {
                if (msg.tick > startTick) {
                    const text = msg.text.toLowerCase();
                    if (text.includes("can't reach") || text.includes("cannot reach")) {
                        return {
                            success: false,
                            message: `Cannot reach ${npc.name} - obstacle in the way`,
                            reason: 'out_of_reach'
                        };
                    }
                    if (text.includes("someone else is fighting") || text.includes("already under attack")) {
                        return {
                            success: false,
                            message: `${npc.name} is already in combat`,
                            reason: 'already_in_combat'
                        };
                    }
                }
            }

            // No failure message found - combat likely started
            return { success: true, message: `Attacking ${npc.name}` };
        } catch {
            return {
                success: false,
                message: `Timeout waiting to attack ${npc.name}`,
                reason: 'timeout'
            };
        }
    }

    // ============ Porcelain: Condition Helpers ============

    /**
     * Waits until a skill reaches the target level.
     */
    async waitForSkillLevel(skillName: string, targetLevel: number, timeout: number = 60000): Promise<SkillState> {
        const state = await this.sdk.waitForCondition(s => {
            const skill = s.skills.find(sk => sk.name.toLowerCase() === skillName.toLowerCase());
            return skill !== undefined && skill.baseLevel >= targetLevel;
        }, timeout);

        return state.skills.find(s => s.name.toLowerCase() === skillName.toLowerCase())!;
    }

    /**
     * Waits until an item appears in inventory.
     */
    async waitForInventoryItem(pattern: string | RegExp, timeout: number = 30000): Promise<InventoryItem> {
        const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;

        const state = await this.sdk.waitForCondition(s =>
            s.inventory.some(i => regex.test(i.name)),
            timeout
        );

        return state.inventory.find(i => regex.test(i.name))!;
    }

    /**
     * Waits until dialog closes.
     */
    async waitForDialogClose(timeout: number = 30000): Promise<void> {
        await this.sdk.waitForCondition(s => !s.dialog.isOpen, timeout);
    }

    /**
     * Waits until the player is idle (not moving, no pending actions).
     * This is a heuristic - checks if player position hasn't changed.
     */
    async waitForIdle(timeout: number = 10000): Promise<void> {
        // Get initial position
        const initialState = this.sdk.getState();
        if (!initialState?.player) {
            throw new Error('No player state');
        }

        const initialX = initialState.player.x;
        const initialZ = initialState.player.z;

        // Wait for next state update
        await this.sdk.waitForStateChange(timeout);

        // Check if position is the same
        await this.sdk.waitForCondition(state => {
            if (!state.player) return false;
            return state.player.x === initialX && state.player.z === initialZ;
        }, timeout);
    }

    // ============ Porcelain: Sequences ============

    /**
     * Navigates through a dialog by selecting options in sequence.
     * Options can be indices (1-based) or text patterns to match.
     */
    async navigateDialog(choices: (number | string | RegExp)[]): Promise<void> {
        for (const choice of choices) {
            // Wait for dialog to be ready
            await this.sdk.waitForCondition(s =>
                s.dialog.isOpen && !s.dialog.isWaiting,
                10000
            );

            const dialog = this.sdk.getDialog();
            if (!dialog) {
                throw new Error('Dialog closed unexpectedly');
            }

            let optionIndex: number;

            if (typeof choice === 'number') {
                optionIndex = choice;
            } else {
                // Find option matching the pattern
                const regex = typeof choice === 'string'
                    ? new RegExp(choice, 'i')
                    : choice;

                const match = dialog.options.find(o => regex.test(o.text));
                if (!match) {
                    // No options means "click to continue" (option 0)
                    if (dialog.options.length === 0) {
                        optionIndex = 0;
                    } else {
                        throw new Error(`No dialog option matching: ${choice}`);
                    }
                } else {
                    optionIndex = match.index;
                }
            }

            await this.sdk.sendClickDialog(optionIndex);

            // Small delay for dialog to process
            await this.sdk.waitForStateChange(5000).catch(() => {});
        }
    }

    // ============ Resolution Helpers ============

    private resolveLocation(
        target: NearbyLoc | string | RegExp | undefined,
        defaultPattern: RegExp
    ): NearbyLoc | null {
        if (!target) {
            return this.sdk.findNearbyLoc(defaultPattern);
        }
        if (typeof target === 'object' && 'x' in target) {
            return target;
        }
        return this.sdk.findNearbyLoc(target);
    }

    private resolveInventoryItem(
        target: InventoryItem | string | RegExp | undefined,
        defaultPattern: RegExp
    ): InventoryItem | null {
        if (!target) {
            return this.sdk.findInventoryItem(defaultPattern);
        }
        if (typeof target === 'object' && 'slot' in target) {
            return target;
        }
        return this.sdk.findInventoryItem(target);
    }

    private resolveGroundItem(target: GroundItem | string | RegExp): GroundItem | null {
        if (typeof target === 'object' && 'x' in target) {
            return target;
        }
        return this.sdk.findGroundItem(target);
    }

    private resolveNpc(target: NearbyNpc | string | RegExp): NearbyNpc | null {
        if (typeof target === 'object' && 'index' in target) {
            return target;
        }
        return this.sdk.findNearbyNpc(target);
    }

    private resolveShopItem(
        target: ShopItem | InventoryItem | string | RegExp,
        items: ShopItem[]
    ): ShopItem | null {
        // If it's an object with id/name, find matching item in the shop's item list
        if (typeof target === 'object' && 'id' in target && 'name' in target) {
            return items.find(i => i.id === target.id) ?? null;
        }
        // Otherwise it's a pattern - search by name
        const regex = typeof target === 'string' ? new RegExp(target, 'i') : target;
        return items.find(i => regex.test(i.name)) ?? null;
    }
}
