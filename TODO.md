# TODO

## Combat style heuristics in StateCollector are fragile

`StateCollector.collectCombatStyle()` guesses combat styles by matching weapon names with string includes (e.g., `wn.includes('scimitar')`). This is ~60 lines of brittle heuristics that:
- May not cover all weapons
- Could be wrong for weapons with unusual names
- Duplicates logic that the server already knows

Consider: Read actual combat style data from the server/client state instead of guessing from weapon names. The varp at index 43 has the selected style index, but the style names/types are fabricated.

## Investigate `bot.navigateDialog` introspectability

The current implementation clicks blindly every 600ms without feedback on what's happening. Consider:

- Return info about what was clicked at each step
- Option to wait for dialog state changes between clicks
- Better handling of `isWaiting` state
- Logging/debug mode that shows dialog flow

Current behavior works but is a black box - hard to debug when dialogs don't complete as expected.



Test with sonnet.






Refine sdk connection management
Refine a runner-script in claude.md with nice feedback

Repo needs to be a prompt that's all compatible
consider typescript MCP again


save file Download/upload flow! (no guarantees for save file durabilitiy  

