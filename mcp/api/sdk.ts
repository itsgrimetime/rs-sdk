/**
 * Low-level Bot SDK API
 *
 * This module provides direct access to the bot protocol and state queries.
 * Methods resolve when server ACKNOWLEDGES them (not when effects complete).
 * For most use cases, prefer the high-level `bot` API instead.
 *
 * Import via: const { sdk } = await import('./api/index');
 * Or use directly if passed as parameter: sdk.getState(), sdk.sendWalk(), etc.
 */

export { sdk } from './index';

/**
 * Available methods on the sdk object:
 *
 * == Connection ==
 * - isConnected() - Check if connected to gateway
 * - getConnectionState() - Get connection state ('connected', 'connecting', 'disconnected', 'reconnecting')
 *
 * == State Access (Synchronous) ==
 * - getState() - Get current bot world state (player, inventory, nearby entities, etc.)
 * - getStateAge() - Get milliseconds since last state update
 *
 * == State Queries ==
 * - getInventory() - Get all inventory items
 * - findInventoryItem(pattern) - Find inventory item by name/id/pattern
 * - getNearbyNpcs() - Get all nearby NPCs
 * - findNearbyNpc(pattern) - Find NPC by name/id/pattern
 * - getNearbyLocs() - Get all nearby interactive locations (trees, rocks, doors, etc.)
 * - findNearbyLoc(pattern) - Find location by name/pattern
 * - getGroundItems() - Get all ground items
 * - findGroundItem(pattern) - Find ground item by name/pattern
 * - getSkill(name) - Get skill state (level, xp, etc.)
 * - getAllSkills() - Get all skills
 * - getEquippedItems() - Get worn equipment
 *
 * == Raw Actions (Promise-based, resolve on acknowledgment) ==
 * - sendWalk(x, z, running?) - Walk to coordinates
 * - sendInteractLoc(x, z, locId, option) - Interact with location (chop tree, mine rock, etc.)
 * - sendInteractNpc(npcIndex, option) - Interact with NPC (talk, attack, trade, etc.)
 * - sendTakeGroundItem(x, z, itemId) - Pick up ground item
 * - sendUseItem(slot, option) - Use/equip/drop item
 * - sendUseItemOnLoc(slot, x, z, locId) - Use item on location
 * - sendUseItemOnNpc(slot, npcIndex) - Use item on NPC
 * - sendUseItemOnItem(slot1, slot2) - Use item on another item
 * - sendUseItemOnGroundItem(slot, x, z, itemId) - Use item on ground item
 * - sendClickDialog(option) - Click dialog option
 * - sendOpenBank() - Request to open bank
 * - sendBankDeposit(slot, amount) - Deposit item to bank
 * - sendBankWithdraw(bankSlot, amount) - Withdraw item from bank
 * - sendShopBuy(shopSlot, amount) - Buy from shop
 * - sendShopSell(invSlot, amount) - Sell to shop
 * - sendCastSpell(spellName) - Cast spell
 * - sendCastSpellOnNpc(spellName, npcIndex) - Cast spell on NPC
 * - sendCastSpellOnItem(spellName, slot) - Cast spell on item
 * - sendCastSpellOnGroundItem(spellName, x, z, itemId) - Cast spell on ground item
 * - sendSkipTutorial() - Skip tutorial
 *
 * == Utility ==
 * - findPath(startX, startZ, endX, endZ) - Find walkable path between two points
 * - sendScreenshot() - Request screenshot from bot client (returns base64 data URL)
 * - checkBotStatus() - Check if bot client is connected to gateway
 * - waitForCondition(predicate, timeout?) - Wait for state to match predicate
 * - waitForStateChange(timeout?) - Wait for any state update
 *
 * == Listeners ==
 * - onStateUpdate(callback) - Register listener for state updates (returns unsubscribe function)
 * - onConnectionStateChange(callback) - Register listener for connection changes
 *
 * All send* methods return Promise<ActionResult> with { success: boolean, message?: string }
 * State query methods return data synchronously from cached state.
 *
 * Example usage:
 *   const state = sdk.getState();
 *   console.log('Position:', state.player.worldX, state.player.worldZ);
 *
 *   const tree = sdk.findNearbyLoc(/^tree$/i);
 *   if (tree) {
 *     const result = await sdk.sendInteractLoc(tree.x, tree.z, tree.id, 0);
 *     console.log('Chop result:', result);
 *   }
 */
