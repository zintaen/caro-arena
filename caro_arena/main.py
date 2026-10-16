import asyncio
import os
import time
from pathlib import Path
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List

from caro_arena.engine.game_manager import GameManager
from caro_arena.engine.laya_agent import get_shared_laya_agent
from caro_arena.engine.jev_agent import JevPlayer

app = FastAPI(title="Caro Arena - Battle Royale")

ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CARO_CORS_ORIGINS",
        "http://localhost:8088,http://127.0.0.1:8088,http://localhost:8089,http://127.0.0.1:8089,http://localhost:8000,http://127.0.0.1:8000,http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Caro-Session"],
)

ROOT_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def _resolve_static_file(filename: str) -> Path:
    root_candidate = ROOT_DIR / filename
    if root_candidate.is_file():
        return root_candidate
    return STATIC_DIR / filename


manager = GameManager()
auto_play_task: Optional[asyncio.Task] = None
active_websockets: List[WebSocket] = []


class SessionContext:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self._manager: Optional[GameManager] = None
        self.auto_play_task: Optional[asyncio.Task] = None
        self.active_websockets: List[WebSocket] = []

    @property
    def manager(self) -> GameManager:
        if self.session_id == "default":
            return manager
        if self._manager is None:
            self._manager = GameManager(storage=manager.storage)
        else:
            self._manager.storage = manager.storage
        return self._manager


_sessions: dict[str, SessionContext] = {}


def get_session_context(session_id: str = "default") -> SessionContext:
    sid = (session_id or "default").strip()[:64] or "default"
    if sid not in _sessions:
        ctx = SessionContext(sid)
        if sid == "default":
            ctx.active_websockets = active_websockets
        _sessions[sid] = ctx
    return _sessions[sid]


class AutoPlayRequest(BaseModel):
    enabled: bool
    delay_sec: float = 0.02
    non_stop: bool = False


class NewBattleRequest(BaseModel):
    players: Optional[List[str]] = None  # e.g. ["laya", "jev", "von", "mojev", "human"]


class HumanMoveRequest(BaseModel):
    row: int
    col: int


async def broadcast_state(ctx: Optional[SessionContext] = None):
    target_ctx = ctx or get_session_context("default")
    ws_list = target_ctx.active_websockets
    if not ws_list:
        return
    payload = jsonable_encoder(target_ctx.manager.get_state())
    dead = []
    for ws in list(ws_list):
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        if ws in ws_list:
            ws_list.remove(ws)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    sid = websocket.query_params.get("session") or websocket.headers.get("x-caro-session") or "default"
    ctx = get_session_context(sid)
    await websocket.accept()
    ctx.active_websockets.append(websocket)
    try:
        await websocket.send_json(jsonable_encoder(ctx.manager.get_state()))
        while True:
            await websocket.receive_text()
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        if websocket in ctx.active_websockets:
            ctx.active_websockets.remove(websocket)


@app.get("/")
async def root():
    return FileResponse(_resolve_static_file("index.html"))


@app.get("/style.css")
async def get_css():
    return FileResponse(_resolve_static_file("style.css"))


@app.get("/app.js")
async def get_js():
    return FileResponse(_resolve_static_file("app.js"))


@app.get("/engine.js")
async def get_engine():
    return FileResponse(_resolve_static_file("engine.js"))


@app.get("/audio.js")
async def get_audio():
    return FileResponse(_resolve_static_file("audio.js"))


@app.get("/multiplayer.js")
async def get_multiplayer():
    return FileResponse(_resolve_static_file("multiplayer.js"))


@app.get("/supabase-config.js")
async def get_supabase_config():
    return FileResponse(_resolve_static_file("supabase-config.js"))


@app.get("/manifest.json")
async def get_manifest():
    return FileResponse(_resolve_static_file("manifest.json"))


@app.get("/icon.svg")
async def get_icon():
    return FileResponse(_resolve_static_file("icon.svg"))


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


from fastapi import Request


def _ctx_from_request(request: Request, session: Optional[str] = None) -> SessionContext:
    sid = session or request.headers.get("x-caro-session") or request.query_params.get("session") or "default"
    return get_session_context(sid)


@app.get("/api/battle/current")
async def get_current_battle(request: Request, session: Optional[str] = None):
    ctx = _ctx_from_request(request, session)
    return ctx.manager.get_state()


@app.post("/api/battle/new")
async def new_battle(request: Request, req: Optional[NewBattleRequest] = None, session: Optional[str] = None):
    global auto_play_task
    ctx = _ctx_from_request(request, session)
    gm = ctx.manager
    player_types = req.players if req and req.players is not None else None
    if player_types is not None:
        if len(player_types) < 2 or len(player_types) > 5:
            raise HTTPException(status_code=400, detail="Roster must contain between 2 and 5 players")
        for pt in player_types:
            if not isinstance(pt, str) or pt not in GameManager.VALID_PLAYER_TYPES:
                raise HTTPException(status_code=400, detail=f"Invalid player type: {pt}")

    gm.is_auto_playing = False
    if ctx.auto_play_task and not ctx.auto_play_task.done():
        ctx.auto_play_task.cancel()

    if gm.status == "finished":
        gm.battle_number += 1

    try:
        state = gm.new_game(player_types=player_types)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # If battle has human and first player is AI, launch auto-play so AI makes opening move
    if gm.has_human_player() and not gm.is_human_turn():
        gm.is_auto_playing = True
        ctx.auto_play_task = asyncio.create_task(_run_auto_play(ctx))
        if ctx.session_id == "default":
            auto_play_task = ctx.auto_play_task

    await broadcast_state(ctx)
    return state


@app.post("/api/battle/human-move")
async def human_move(request: Request, req: HumanMoveRequest, session: Optional[str] = None):
    global auto_play_task
    ctx = _ctx_from_request(request, session)
    gm = ctx.manager
    if not gm.is_human_turn():
        raise HTTPException(status_code=400, detail="Not human's turn")
    state = gm.human_move(req.row, req.col)
    if state is None:
        raise HTTPException(status_code=400, detail="Invalid move")

    # If game not finished and now it's an AI's turn, ensure auto-play is running to respond
    if gm.status != "finished" and not gm.is_human_turn():
        if not gm.is_auto_playing or ctx.auto_play_task is None or ctx.auto_play_task.done():
            gm.is_auto_playing = True
            ctx.auto_play_task = asyncio.create_task(_run_auto_play(ctx))
            if ctx.session_id == "default":
                auto_play_task = ctx.auto_play_task

    await broadcast_state(ctx)
    return state


@app.post("/api/battle/undo")
async def undo_move(request: Request, session: Optional[str] = None):
    ctx = _ctx_from_request(request, session)
    gm = ctx.manager
    if ctx.auto_play_task and not ctx.auto_play_task.done():
        ctx.auto_play_task.cancel()
    gm.is_auto_playing = False

    success = gm.undo_human_move()
    if not success:
        raise HTTPException(status_code=400, detail="Cannot undo move")
    await broadcast_state(ctx)
    return gm.get_state()


async def _run_auto_play(ctx: Optional[SessionContext] = None):
    target_ctx = ctx or get_session_context("default")
    gm = target_ctx.manager
    loop = asyncio.get_running_loop()
    try:
        while gm.is_auto_playing:
            if gm.status != "finished":
                # Skip if it's human's turn — wait for manual input
                if gm.is_human_turn():
                    await asyncio.sleep(0.1)
                    continue

                t0 = time.perf_counter()
                await loop.run_in_executor(None, gm.step)
                await broadcast_state(target_ctx)
                elapsed = time.perf_counter() - t0
                min_pace = max(0.025, gm.auto_delay_sec) if target_ctx.active_websockets else max(0.04, gm.auto_delay_sec)
                await asyncio.sleep(max(gm.auto_delay_sec, min_pace - elapsed))

            if gm.status == "finished":
                if getattr(gm, "non_stop", False):
                    await asyncio.sleep(1.2)
                    gm.battle_number += 1
                    gm.new_game(player_types=gm.selected_player_types)
                    await broadcast_state(target_ctx)
                    continue
                else:
                    gm.is_auto_playing = False
                    await broadcast_state(target_ctx)
                    break
    except asyncio.CancelledError:
        pass
    except Exception as e:
        print(f"Error in auto-play loop: {e}")
        gm.is_auto_playing = False
        await broadcast_state(target_ctx)


@app.post("/api/battle/auto-play")
async def toggle_auto_play(request: Request, req: AutoPlayRequest, session: Optional[str] = None):
    global auto_play_task
    ctx = _ctx_from_request(request, session)
    gm = ctx.manager
    gm.is_auto_playing = req.enabled
    gm.auto_delay_sec = max(0.01, req.delay_sec)
    gm.non_stop = req.non_stop

    if req.enabled:
        if ctx.auto_play_task is None or ctx.auto_play_task.done():
            ctx.auto_play_task = asyncio.create_task(_run_auto_play(ctx))
            if ctx.session_id == "default":
                auto_play_task = ctx.auto_play_task
    else:
        if ctx.auto_play_task and not ctx.auto_play_task.done():
            ctx.auto_play_task.cancel()

    await broadcast_state(ctx)
    return {"is_auto_playing": gm.is_auto_playing, "delay_sec": gm.auto_delay_sec, "non_stop": gm.non_stop}


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


@app.post("/api/history/clear")
async def clear_history(request: Request, session: Optional[str] = None):
    ctx = _ctx_from_request(request, session)
    gm = ctx.manager
    gm.is_auto_playing = False
    if ctx.auto_play_task and not ctx.auto_play_task.done():
        ctx.auto_play_task.cancel()

    gm.storage.clear_history()
    gm.battle_number = 1
    gm.selected_player_types = ["laya", "jev", "von", "mojev"]
    gm.new_game(player_types=["laya", "jev", "von", "mojev"])
    await broadcast_state(ctx)
    return {"status": "cleared"}


