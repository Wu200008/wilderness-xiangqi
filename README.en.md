<p align="center"><img src="app/assets/app-icon.png" width="144" alt="Wilderness Xiangqi icon"></p>

<h1 align="center">Wilderness Xiangqi · 荒野象棋</h1>

<p align="center">Local Chinese chess, a mixed-color hidden-piece variant, and a hand-drawn wilderness theme.</p>

<p align="center">
  <a href="https://github.com/Wu200008/wilderness-xiangqi/releases/latest">Download for Windows</a> ·
  <a href="README.md">简体中文</a> ·
  <a href="docs/USAGE.md">User guide (Chinese)</a> ·
  <a href="https://github.com/Wu200008/wilderness-xiangqi/issues">Report an issue</a>
</p>

A Windows desktop Xiangqi application with ordinary chess and a custom mixed-color Jieqi variant. Play against AI, watch AI vs. AI, or share one computer with a friend. All gameplay and analysis run locally; no account, subscription, cloud API, or GPU is required. **The application interface is currently in Simplified Chinese.**

![Start menu](docs/screenshots/screen-menu-home.png)

## Download and play

1. Open [Releases](https://github.com/Wu200008/wilderness-xiangqi/releases/latest) and download `wilderness-xiangqi-1.2.0-windows-x64.zip`. The automatically generated “Source code” archives are not the ready-to-play package.
2. Extract the **entire** archive to a writable folder and run **`荒野象棋.exe`**. Keep its accompanying folders and files together.
3. Choose **普通象棋** (ordinary Xiangqi) or **混合揭棋** (mixed Jieqi), then an opponent mode and difficulty. Click **开始对局** to begin.

The package includes Electron, Pikafish, and the matching NNUE weights. Players do not need Node.js or Python. Downloads require a connection; playing afterward does not.

**Platform:** Windows 10 / 11, x64. Recommended: at least 8 GB RAM and 2 GB free disk space. The minimum window size is 1100 × 800; allow enough usable screen space. No macOS, Linux, Windows ARM, or mobile release is currently provided.

## Features

| | Human vs. AI | AI vs. AI | Same-device two players | Analysis |
| :-- | :--: | :--: | :--: | :-- |
| Ordinary Xiangqi | ✓ | ✓ | ✓ | Red win / draw / black win, evaluation, suggested line, trend |
| Mixed-color Jieqi | ✓ | ✓ | ✓ | Public-information advantage index, suggested line, trend |

- A start menu with explicit mode, side, and difficulty selection.
- In-session resume, undo, board rotation, resignation, pause, and AI single-step.
- Public JSON game-record export without unrevealed identities.
- Soft locally synthesized move sounds, volume control, preview, and persistent mute.
- Automatic position analysis and a longer, approximately three-second analysis option.
- Don't Starve-inspired character badges and a custom desktop icon.

![Ordinary Xiangqi and analysis](docs/screenshots/screen-analysis-standard.png)

## Two games, two AI approaches

**Ordinary Xiangqi** uses official **Pikafish 2026-09-06** and its matching NNUE. Difficulty adjusts the search budget. Win/draw/loss estimates come from the engine's own statistical model; they are not a guarantee or a player's personal win rate. The trend chart shows Red's expected score: `Red win + draw / 2`.

**Mixed-color Jieqi** uses this project's public-information probability search. Both generals stay face up in their normal squares; the other 30 pieces are shuffled across colors. A covered piece moves as its starting-square role, then reveals its actual type and side—which may belong to the opponent. Captured covered pieces are removed and disclosed regardless of their true color. Revealed advisors may leave the palace, and elephants may cross the river while retaining the blocked-eye rule. If a random reveal exposes one's general to attack, the opponent may capture it next turn.

The AI and analysis worker receive only public observations and the remaining identity counts, never the actual hidden arrangement. Its −100 to +100 advantage index is **not a calibrated win probability**. This is not the official Pikafish `jieqi` binary and has no formal strength rating. Full rules are in the [Chinese user guide](docs/USAGE.md#混合揭棋的完整约定).

## Current limitations

- Repetition and no-progress draws follow simplified local rules; tournament long-check and long-chase fault adjudication is not implemented.
- Two-player mode shares one computer. There is no online multiplayer.
- Returning to the menu preserves the game only within the current app session. Closing the app loses the game; JSON export is a record, not an importable save file.
- Longer search is not a promise of victory. Neither AI is advertised as a current competition champion or a 100% winner.
- The Windows portable launcher is not commercially code-signed. Download from this repository's release page and check the supplied SHA-256 file.

## Run from source

Use **Windows x64, Node.js 22.12.0 or a newer supported version, npm, and Git**:

```powershell
git clone https://github.com/Wu200008/wilderness-xiangqi.git
cd wilderness-xiangqi
npm ci
npm run fetch:engine
npm start
```

Dependency installation and initial engine fetching require internet access. The fetch script downloads and verifies a fixed official engine release and matching weights. Engine binaries and weights are not committed to Git.

The default engine is `engines/pikafish/pikafish.exe`, with `pikafish.nnue` alongside it. To use another compatible local build:

```powershell
$env:WILD_CHESS_ENGINE_PATH = 'D:\engines\pikafish\pikafish.exe'
npm start
```

Supply the correct matching weights. Custom engines are outside this release's validation scope. Opening `app/index.html` in a browser does not provide the Electron engine bridge.

```powershell
npm test
npm run test:engine
npm run build:portable
npm run test:portable
```

`test:engine` requires the downloaded engine. Portable builds also require MinGW-w64 `gcc` and `windres` on PATH to build the themed launcher. Portable validation launches a separate hidden Electron test instance.

## Licensing and credits

The project's own program source is licensed under [GPL-3.0-only](LICENSE). **A release is a collection of components with different terms**, not a uniformly licensed asset pack:

- [Pikafish](https://github.com/official-pikafish/Pikafish) is distributed under GPLv3. Its exact tagged source archive accompanies the release.
- NNUE weights have [separate terms](docs/Pikafish-NNUE-License.md), including no commercial use without permission. See the [official Networks repository](https://github.com/official-pikafish/Networks).
- [Electron](https://www.electronjs.org/) and bundled dependencies retain their own notices and licenses.
- Art is AI-generated fan design inspired by **Don't Starve**, not official Klei artwork or an endorsed product. Character names and associated rights remain with their respective holders. The source license does not grant independent commercial rights to those characters or images. Generation records are in [`app/assets/generation.txt`](app/assets/generation.txt).

See [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md) for component details, [CHANGELOG](CHANGELOG.md) for releases, and [Issues](https://github.com/Wu200008/wilderness-xiangqi/issues) for feedback.
