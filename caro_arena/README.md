# Caro Arena: Battle Royale

An interactive battleground and comparative benchmarking platform where non-autoregressive decision models (**Laya**, **Jev**, **Von**, **MoJev**) and **Human Players** compete in a **Caro (Five-in-a-Row)** **Battle Royale** on an **unlimited (infinite) grid**.

---

## ⚡ Overview & Concept

Traditional Caro/Gomoku platforms are limited to 1v1 duels on fixed $15 \times 15$ or $19 \times 19$ boards. **Caro Arena** transforms the game into a **simultaneous N-player Battle Royale (PUBG-style Free-for-All)** on an unbounded coordinate plane $(r, c) \in \mathbb{Z}^2$.

Multiple models fight concurrently on the same board, attempting to establish winning alignments while navigating cross-fire and blocking threats from multiple opponents.

```
+-----------------------------------------------------------------------+
|                              CARO ARENA                               |
|                                                                       |
|  [Laya: Cyan]    [Jev: Purple]    [Von: Emerald]    [MoJev: Rose]     |
|                             [Human: Amber]                            |
|                                                                       |
|                     Infinite Grid (r, c) in Z^2                       |
|        - Dynamic Multi-Model Free-For-All                             |
|        - Sequential 5-in-a-Row Elimination & Placement Ranks         |
|        - Live Cumulative Leaderboard & Replay System                  |
+-----------------------------------------------------------------------+
```

---

## 🎮 Battle Royale Rules & Mechanics

### 1. Sequential Elimination & Placements
- **Objective**: Complete an unbroken line of 5 or more stones in any direction (horizontal, vertical, or diagonal).
- **Placement by Speed**: The first participant to connect 5-in-a-row earns **1st Place (Gold 🥇)**.
- **Turn Freezing**: Once a participant places, their turns cease immediately while the remaining participants continue battling on the same board.
- **Subsequent Ranks**: The next participant to connect 5-in-a-row claims **2nd Place (Silver 🥈)**, then **3rd Place (Bronze 🥉)**, and so on.
- **Final Placement**: The battle terminates once $N-1$ participants have achieved five-in-a-row. The last remaining active participant is automatically assigned final place ($N^{\text{th}}$). Every participant receives a unique rank ($1, 2, \dots, N$).

### 2. Standings & Scoring System
Across consecutive battles, participants earn points towards the overall standings based on lobby size $N$:
$$\text{Points} = \max(1, N - \text{rank} + 1)$$

For a standard 4-player match:
| Placement | Points Awarded | Status |
| :--- | :---: | :--- |
| **1st Place 🥇** | **4 pts** | Winner |
| **2nd Place 🥈** | **3 pts** | Runner-up |
| **3rd Place 🥉** | **2 pts** | Podium |
| **4th Place** | **1 pt** | Last Survivor |

### 3. Leaderboard Tie-Breaking
The global standings table enforces strict monotonic tie-breaking:
1. $\text{Total Points} \downarrow$ (Primary)
2. $\text{Wins (1st Places)} \downarrow$ (Secondary)
3. $\text{Average Placement} \uparrow$ (Tertiary — lower average rank ranks higher)
4. $\text{Battles Played} \downarrow$

---

## 🤖 Decision Models (No LLMs)

Caro Arena evaluates lightweight, non-autoregressive decision models operating under ultra-low latency (<20 ms). No slow LLM token streaming or external inference servers (e.g. Ollama, LM Studio) are used:

| Model | Technology | Avg Latency | Playing Style |
| :--- | :--- | :---: | :--- |
| **Laya** | RLCD Non-Autoregressive Decision Agent | ~20–40 ms | Deep pattern recognition, geometric shape creation |
| **TypeSafe Jev** | TypeSafe SDK Specialized Decision Engine | ~5–15 ms | High-throughput offensive branching, aggressive lines |
| **Von** | ModernBERT + OptionMarker Bidirectional Encoder | ~15–30 ms | Balanced offensive-defensive positional clustering |
| **MoJev** | Lightweight Ensemble Decision Engine | ~10–25 ms | Fast opportunism, peripheral expansion |
| **Human** | Interactive Canvas Click-to-Play | — | Tactical human judgment with live HUD assistance |

### Tactical Evaluator & Multi-Player Dynamics
- **Unbounded Candidate Generation**: Discovers candidate moves within Manhattan/Chebyshev distance of all active stones.
- **Dynamic Defensive Weighting**:
  - In **3+ Player FFA**: Defense weight is tuned to $0.05$ (5%). In multi-player free-for-all, over-defending minor opponent threats stalls personal progression. Prioritizing forward offensive threats yields dynamic, decisive battles (~50–180 moves).
  - In **1v1 Duels**: Defense weight scales to $1.0$ (100%), reverting to classical Caro master defense.
- **Opening Stone Relative Offsets**: Model responses automatically anchor relative to the opening move's coordinates $(r_0 + \Delta r, c_0 + \Delta c)$, supporting human opening stones placed anywhere on the infinite grid.

---

## 🖥️ UI & Interaction Design

The frontend follows an anti-slop, clean light-mode editorial design system:

1. **Infinite HTML5 Canvas Goban**:
   - Unbounded $(r, c) \in \mathbb{Z}^2$ grid lines with coordinate labeling.
   - Smooth **click-and-drag panning** and **scroll wheel zooming** ($0.2\times$ to $4.0\times$).
   - Dynamic auto-scaling that frames the action without disorienting viewport jumps.
   - Recenter button (🎯) to return focus to the active stone cluster.

2. **5-in-a-Row Visual FX**:
   - **Glowing Golden Halo**: Surrounds all 5 stones in each winning alignment.
   - **3-Layer Laser Strike Line**: High-contrast golden glow beam, model-colored core, and bright center laser.
   - **Floating Placement Badge**: Floats directly over each winning line (e.g. `🥇 Jev · 5 in a row`).

3. **Roster Configuration**:
   - Toggle chips in the sidebar for Laya, Jev, Von, MoJev, and Human.
   - Default roster strictly comprises the 4 AI models (Human is opt-in).
   - Changing roster dynamically resets the board when idle.
   - Graceful validation: Selecting fewer than 2 players disables battle controls and highlights `(min 2)` without intrusive popup alerts.

4. **Human Turn HUD**:
   - Prominent banner signals when human input is expected: `🎯 Your turn — click the board to place a stone`.
   - Cursor changes to a pointer with valid placement crosshairs.
   - Clicks on occupied cells or outside canvas boundaries are rejected cleanly.

5. **Integrated Replay & Review System**:
   - Browse completed matches from the **History** tab.
   - Step forward/backward through moves using **Prev** / **Next** buttons or keyboard shortcuts:
     - `←` (`ArrowLeft`): Step backward
     - `→` (`ArrowRight`): Step forward
     - `Esc` (`Escape`): Exit replay
   - Direct link support via query param: `http://localhost:8088/?replay=<battle_id>`.
   - Input sandboxing: Clicks during replay are isolated from live background games.

6. **Fixed Viewport (Zero Drift)**:
   - Viewport is locked to `100vh` (`overflow: hidden`).
   - Move stream and battle history scroll independently within dedicated scrollable panels.

---

## 📡 API Reference

### Battle Lifecycle
- `GET /api/battle/current`: Retrieves active game state, board moves, current player, and placement ranks.
- `POST /api/battle/new`: Initializes a fresh battle. Accepts optional JSON body `{"players": ["laya", "jev", "von", "mojev", "human"]}`.
- `POST /api/battle/auto-play`: Starts or pauses automatic game loops (`{"enabled": true, "delay_sec": 0.02}`).
- `POST /api/battle/human-move`: Submits human move `{"row": r, "col": c}`. Returns HTTP 400 if illegal or not human's turn.

### Standings & Replay
- `GET /api/leaderboard`: Returns overall cumulative standings ranked by points, wins, and average placement.
- `GET /api/battles`: Lists archived battles (up to 50 recent).
- `GET /api/battles/{battle_id}`: Retrieves complete move history, duration, and placement winning lines for replay.
- `POST /api/history/clear`: Clears SQLite database history, resets battle series to #1, and restores default 4-AI roster.

### Real-Time WebSocket
- `WS /ws`: Broadcasts board updates, turn shifts, and placement changes instantaneously to connected clients.

---

## 🚀 Deployment & Quickstart

Caro Arena supports **Dual-Mode Execution**:
1. **Static Web / GitHub Pages Mode**: Zero server requirements. The client-side game engine (`engine.js`) runs complete decision models, battle royale rules, and history directly in the browser with `localStorage` persistence.
2. **Local Full-Stack Mode**: Connects to the high-performance Python FastAPI backend via REST and WebSockets.

---

### Option A: Deploy to GitHub Pages (Zero Backend)

The static web build is pre-assembled in the [`docs/`](../docs/) folder.

#### Method 1: Deploy from `/docs` folder (Recommended & Easiest)
1. Commit and push the repository to GitHub.
2. In your GitHub repository, open **Settings** > **Pages**.
3. Under **Build and deployment** > **Source**, choose **Deploy from a branch**.
4. Set:
   - **Branch**: `main` (or `master`)
   - **Folder**: `/docs`
5. Click **Save**. Your site will be published at `https://<username>.github.io/<repo>/` in under a minute!

#### Method 2: Deploy via GitHub Actions
An automated deployment workflow is preconfigured in [`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml).
1. Go to **Settings** > **Pages**.
2. Under **Build and deployment** > **Source**, choose **GitHub Actions**.
3. Every push to `main` or `master` will automatically publish the arena.

---

### Option B: Local Full-Stack Mode

#### 1. Prerequisites
- Python 3.12+
- Dependencies installed in `.venv` (`fastapi`, `uvicorn`, `pydantic`, `sqlite3`).

#### 2. Launch Local Server
Ensure you are in the repository root directory:
```bash
uvicorn caro_arena.main:app --port 8088 --host 127.0.0.1
```

#### 3. Open Web Application
Navigate your browser to:
```
http://localhost:8088
```
*(The frontend automatically detects the FastAPI backend on startup and links to the live WebSocket stream!)*

---

## 🧪 Verification & Testing

An automated test suite validates the battle lifecycle, human move constraints, placement rankings, undo mechanics, and tie-breaking:

```bash
# Run comprehensive audit suite
python3 -m unittest caro_arena/tests/test_all_edge_cases.py
```
