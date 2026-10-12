# Caro Arena: Multi-Agent Battle Royale

[![GitHub Pages](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-brightgreen?logo=github)](https://zintaen.github.io/caro-arena/)
[![Python 3.12+](https://img.shields.io/badge/Python-3.12%2B-blue?logo=python)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-teal?logo=fastapi)](https://fastapi.tiangolo.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An interactive battleground and comparative benchmarking platform where non-autoregressive decision models (**Laya**, **Jev**, **Von**, **MoJev**) and **Human Players** compete in a **Caro (Five-in-a-Row)** **Battle Royale** on an **unlimited (infinite) grid**.

👉 **[Play Live Demo in Your Browser](https://zintaen.github.io/caro-arena/)** *(Zero backend required — runs 100% in-browser!)*

---

## ⚡ Overview & Concept

Traditional Caro/Gomoku platforms are limited to 1v1 duels on fixed $15 \times 15$ or $19 \times 19$ boards. **Caro Arena** transforms the game into a **simultaneous N-player Battle Royale (Free-for-All)** on an unbounded coordinate plane $(r, c) \in \mathbb{Z}^2$.

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

Caro Arena evaluates lightweight, non-autoregressive decision models operating under ultra-low latency (<20 ms). No slow LLM token streaming or external inference servers are needed:

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

The frontend follows an anti-slop, clean editorial design system:

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
   - Direct link support via query param: `?replay=<battle_id>`.

---

## 🚀 Deployment & Running

Caro Arena supports **Dual-Mode Execution**:

### 1. In-Browser / GitHub Pages (Zero Backend)
Access the live game hosted on GitHub Pages:
**[https://zintaen.github.io/caro-arena/](https://zintaen.github.io/caro-arena/)**

The client-side game engine (`engine.js`) runs complete decision models, battle royale rules, and history directly in the browser with `localStorage` persistence.

### 2. Local Full-Stack (FastAPI + Python Backend)
```bash
# Clone the repository
git clone https://github.com/zintaen/caro-arena.git
cd caro-arena

# Install dependencies
pip install -r requirements.txt

# Run FastAPI backend
uvicorn caro_arena.main:app --port 8088 --host 127.0.0.1
```
Open [http://localhost:8088](http://localhost:8088). The frontend automatically connects to the Python WebSocket stream.

---

## 🧪 Testing

Run the automated test suite verifying edge cases, placements, and tie-breaking:

```bash
python3 -m unittest caro_arena/tests/test_all_edge_cases.py
```

---

## 📄 License
MIT License.
