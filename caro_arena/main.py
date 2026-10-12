import asyncio
import os
from pathlib import Path
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List

from caro_arena.engine.game_manager import GameManager
from caro_arena.engine.laya_agent import get_shared_laya_agent
from caro_arena.engine.jev_agent import JevPlayer

app = FastAPI(title="Caro Arena - Battle Royale")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

manager = GameManager()
auto_play_task: Optional[asyncio.Task] = None
active_websockets: List[WebSocket] = []


class AutoPlayRequest(BaseModel):
    enabled: bool
    delay_sec: float = 0.02


class NewBattleRequest(BaseModel):
    players: Optional[List[str]] = None  # e.g. ["laya", "jev", "von", "mojev", "human"]


class HumanMoveRequest(BaseModel):
    row: int
    col: int


async def broadcast_state():
    if not active_websockets:
        return
    state = manager.get_state()
    dead = []
    for ws in active_websockets:
        try:
            await ws.send_json(state)
        except Exception:
            dead.append(ws)
    for ws in dead:
        if ws in active_websockets:
            active_websockets.remove(ws)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_websockets.append(websocket)
    try:
        await websocket.send_json(manager.get_state())
        while True:
            await websocket.receive_text()
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        if websocket in active_websockets:
            active_websockets.remove(websocket)


@app.get("/")
async def root():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/style.css")
async def get_css():
    return FileResponse(STATIC_DIR / "style.css")


@app.get("/app.js")
async def get_js():
    return FileResponse(STATIC_DIR / "app.js")


@app.get("/engine.js")
async def get_engine():
    return FileResponse(STATIC_DIR / "engine.js")


@app.get("/api/health")
async def health_check():
    laya_ready = get_shared_laya_agent() is not None
    jev_agent = JevPlayer(name="Jev Check")

    return {
        "status": "ok",
        "laya_model": {"name": "Convai Laya", "ready": laya_ready},
        "jev_model": {"name": "TypeSafe Jev", "ready": jev_agent.is_available()},
        "von_model": {"name": "Von", "ready": True},
        "mojev_model": {"name": "MoJev", "ready": True}
    }


@app.get("/api/battle/current")
async def get_current_battle():
    return manager.get_state()


@app.post("/api/battle/new")
async def new_battle(req: Optional[NewBattleRequest] = None):
    global auto_play_task
    manager.is_auto_playing = False
    if auto_play_task and not auto_play_task.done():
        auto_play_task.cancel()

    if manager.status == "finished":
        manager.battle_number += 1

    player_types = req.players if req and req.players else None
    state = manager.new_game(player_types=player_types)

    # If battle has human and first player is AI, launch auto-play so AI makes opening move
    if manager.has_human_player() and not manager.is_human_turn():
        manager.is_auto_playing = True
        auto_play_task = asyncio.create_task(_run_auto_play())

    await broadcast_state()
    return state


@app.post("/api/battle/human-move")
async def human_move(req: HumanMoveRequest):
    global auto_play_task
    if not manager.is_human_turn():
        raise HTTPException(status_code=400, detail="Not human's turn")
    state = manager.human_move(req.row, req.col)
    if state is None:
        raise HTTPException(status_code=400, detail="Invalid move")

    # If game not finished and now it's an AI's turn, ensure auto-play is running to respond
    if manager.status != "finished" and not manager.is_human_turn():
        if not manager.is_auto_playing or auto_play_task is None or auto_play_task.done():
            manager.is_auto_playing = True
            auto_play_task = asyncio.create_task(_run_auto_play())

    await broadcast_state()
    return state


async def _run_auto_play():
    loop = asyncio.get_event_loop()
    try:
        while manager.is_auto_playing:
            if manager.status != "finished":
                # Skip if it's human's turn — wait for manual input
                if manager.is_human_turn():
                    await asyncio.sleep(0.1)
                    continue

                await loop.run_in_executor(None, manager.step)
                await broadcast_state()
                await asyncio.sleep(manager.auto_delay_sec)

            if manager.status == "finished":
                await broadcast_state()
                # If there's a human player, don't auto-chain battles
                if manager.has_human_player():
                    manager.is_auto_playing = False
                    await broadcast_state()
                    break
                await asyncio.sleep(3.0)
                if not manager.is_auto_playing:
                    break

                manager.battle_number += 1
                manager.new_game()
                manager.status = "playing"
                await broadcast_state()
    except asyncio.CancelledError:
        pass
    except Exception as e:
        print(f"Error in auto-play loop: {e}")
        manager.is_auto_playing = False
        await broadcast_state()


@app.post("/api/battle/auto-play")
async def toggle_auto_play(req: AutoPlayRequest):
    global auto_play_task
    manager.is_auto_playing = req.enabled
    manager.auto_delay_sec = max(0.02, req.delay_sec)

    if req.enabled:
        if auto_play_task is None or auto_play_task.done():
            auto_play_task = asyncio.create_task(_run_auto_play())
    else:
        if auto_play_task and not auto_play_task.done():
            auto_play_task.cancel()

    await broadcast_state()
    return {"is_auto_playing": manager.is_auto_playing, "delay_sec": manager.auto_delay_sec}


@app.get("/api/leaderboard")
async def get_leaderboard():
    return manager.storage.get_leaderboard()


@app.get("/api/battles")
async def list_battles(limit: int = 50):
    return manager.storage.get_battle_history(limit=limit)


@app.get("/api/battles/{battle_id}")
async def get_battle_detail(battle_id: str):
    battle = manager.storage.get_battle(battle_id)
    if not battle:
        raise HTTPException(status_code=404, detail="Battle not found")
    return battle


@app.api_route("/api/history/clear", methods=["GET", "POST"])
async def clear_history():
    global auto_play_task
    manager.is_auto_playing = False
    if auto_play_task and not auto_play_task.done():
        auto_play_task.cancel()

    manager.storage.clear_history()
    manager.battle_number = 1
    manager.selected_player_types = ["laya", "jev", "von", "mojev"]
    manager.new_game(player_types=["laya", "jev", "von", "mojev"])
    await broadcast_state()
    return {"status": "cleared"}
