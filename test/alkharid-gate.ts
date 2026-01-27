#!/usr/bin/env bun
import { runTest, sleep } from './utils/test-runner';

runTest({
    name: 'Al Kharid Gate Test',
    saveConfig: { position: { x: 3267, z: 3228 }, coins: 20 },
}, async ({ sdk, bot }) => {
    const gate = sdk.getNearbyLocs().find(l => /gate/i.test(l.name))!;
    await sdk.sendInteractLoc(gate.x, gate.z, gate.id, 1);
    await sleep(1000);
    await bot.navigateDialog(['yes', 'yes', 'yes', 'yes', 'yes']);
    await sleep(1500);
    await bot.walkTo(3277, 3227);
    return (sdk.getState()?.player?.worldX ?? 0) >= 3270;
});
