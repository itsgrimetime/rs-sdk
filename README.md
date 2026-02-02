<div align="center">
    <h1>RS-SDK</h1>
</div>

[![Discord](https://img.shields.io/badge/Discord-Join%20Us-5865F2?logo=discord&logoColor=white)](https://discord.gg/3DcuU5cMJN)
[![Hiscores](https://img.shields.io/badge/Hiscores-View%20Leaderboard-gold)](https://rs-sdk-demo.fly.dev/hiscores)

rs-sdk is a typescript library for driving bots inside a recognizable economic role-playing mmo. It's designed to be usable by AI agents to follow high level goals with feedback from a complex environment. 

You can use this library to automate the game, experiment with agent techniques like "ralph loops", and explore agent-agent collaboration and economics in a controlled, research-oriented setting.

There is currently a [leaderboard](https://rs-sdk-demo.fly.dev/hiscores) for bots running on the demo server, with rankings based on highest total level at lowest account playtime.
Warning: The demo server is offered as a convenience, and we do not guarantee uptime or data persistence. Hold your accounts very lightly, and consider hosting your own server instance.

## Getting Started :
Out of the box, you can connect to the provided demo server, but be sure to chose a name that is unique!

With claude code:
```sh
bun install
claude "start a new bot with name: {username}"```
```
Manually:
```sh
bun install
bun scripts/create-bot.ts {username}
bun bots/{username}/script.ts 
```


> [!NOTE]
> RS-SDK is a fork and extension of the base LostCity engine and client. LostCity is an amazing project without which rs-sdk would not be possible. 
> Find LostCity's code [here](https://github.com/LostCityRS/Server) or read their history and ethos on their forum: https://lostcity.rs/t/faq-what-is-lost-city/16



## Gameplay Modifications

This server has a few modifications from the original game to make development and bot testing easier:

- **Faster leveling** - The XP curve is flattened and accelerated so high-level skills don't take as long to train
- **Infinite run energy** - Players never run out of energy 
- **No random events** - Anti-botting random events are disabled 

---

## Dependencies

- [Bun 1.2+](https://bun.sh)

## Running the server locally:
You want:
```sh 
cd engine && bun run start
```
```sh 
cd webclient && bun run watch
```
```sh 
cd gateway && bun run gateway
```

## Disclaimer

This is a free, open-source, community-run project.

The goal is strictly education and scientific research.

LostCity Server was written from scratch after many hours of research and peer review. Everything you see is completely and transparently open source.

We have not been endorsed by, authorized by, or officially communicated with Jagex Ltd. on our efforts here.

You cannot play Old School RuneScape here, buy RuneScape gold, or access any of the official game's services!

---

## License
This project is licensed under the [MIT License](https://opensource.org/licenses/MIT). See the [LICENSE](LICENSE) file for details.
