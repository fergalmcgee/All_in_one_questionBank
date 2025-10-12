from __future__ import annotations

import json
import os
import random
import socket
import string
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence
from uuid import uuid4

from flask import (
    Flask,
    abort,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
BANK_ROOT = BASE_DIR.parent

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("QRT_SECRET_KEY", "qrt-presenter-dev-secret")
PRESENTER_ACCESS_CODE = os.environ.get("QRT_PRESENTER_CODE", "cic2025")

QUESTION_BANKS: Dict[str, Dict[str, Any]] = {
    "CSA2": {"label": "Computer Science A2", "json": "A2Questions.json"},
    "CSAS": {"label": "Computer Science AS", "json": "ASQuestions.json"},
    "CSIG": {"label": "Computer Science IGCSE", "json": "IGTheory.json"},
    "PHAS": {"label": "Physics AS", "json": "ASPhysicsQB.json"},
    "PHIG": {"label": "Physics IGCSE", "json": "IGPQ.json"},
    "PHA2": {"label": "Physics A2", "json": "A2Questions.json"},
}

ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
USER_IMAGE_DIR = BASE_DIR / "UserImages"
USER_IMAGE_DIR.mkdir(parents=True, exist_ok=True)


class SessionState:
    def __init__(self, code: str, bank_id: str, questions: List[Dict[str, Any]]) -> None:
        self.code = code
        self.bank_id = bank_id
        self.questions = questions
        self.current_index = 0
        self.revealed = False
        self.responses: List[Dict[str, Any]] = []
        self.started_at = datetime.utcnow()

    @property
    def current_question(self) -> Optional[Dict[str, Any]]:
        if self.questions and 0 <= self.current_index < len(self.questions):
            return self.questions[self.current_index]
        return None


SESSIONS: Dict[str, SessionState] = {}


def _require_bank(bank_id: str) -> Dict[str, Any]:
    bank = QUESTION_BANKS.get(bank_id)
    if not bank:
        abort(404, description="Unknown question bank")

    base_dir = BANK_ROOT / bank_id
    json_path = base_dir / bank["json"]
    if not base_dir.is_dir() or not json_path.exists():
        abort(404, description="Question bank not found on server")

    return {
        "id": bank_id,
        "label": bank["label"],
        "base_dir": base_dir,
        "json_path": json_path,
    }


@lru_cache(maxsize=32)
def _bank_entries(bank_id: str) -> Dict[str, Any]:
    config = _require_bank(bank_id)
    with config["json_path"].open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    topics = payload.get("topics") if isinstance(payload, dict) else payload
    if not isinstance(topics, dict):
        abort(500, description="Unsupported question schema")

    entries: List[Dict[str, Any]] = []
    id_lookup: Dict[str, Dict[str, Any]] = {}
    for topic, groups in topics.items():
        if not isinstance(groups, list):
            continue
        for group in groups:
            if not isinstance(group, dict):
                continue
            questions = group.get("questions", []) if isinstance(group, dict) else []
            for question in questions:
                if not isinstance(question, dict):
                    continue
                entry = {
                    "topic": topic,
                    "group_id": group.get("group_id"),
                    "question": question,
                }
                entries.append(entry)
                question_id = question.get("question_id")
                if question_id and question_id not in id_lookup:
                    id_lookup[question_id] = entry

    return {"entries": entries, "id_lookup": id_lookup}


def _load_questions(
    bank_id: str,
    *,
    topics: Optional[Sequence[str]] = None,
    question_ids: Optional[Sequence[str]] = None,
) -> List[Dict[str, Any]]:
    cache = _bank_entries(bank_id)
    entries: List[Dict[str, Any]] = cache["entries"]
    id_lookup: Dict[str, Dict[str, Any]] = cache["id_lookup"]

    selected: List[Dict[str, Any]]
    if question_ids:
        selected = []
        for qid in question_ids:
            entry = id_lookup.get(qid)
            if entry:
                selected.append(_clone_entry(entry))
        if not selected:
            abort(400, description="No valid question IDs supplied")
        return selected

    topic_filter = set(topics) if topics else None
    selected = [
        _clone_entry(entry)
        for entry in entries
        if topic_filter is None or entry.get("topic") in topic_filter
    ]

    if not selected:
        abort(400, description="No questions match the selected filters")
    return selected


def _clone_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    question = dict(entry.get("question", {}))
    for key in ("images", "answer_images", "tags"):
        value = question.get(key)
        if isinstance(value, list):
            question[key] = list(value)
    return {
        "topic": entry.get("topic"),
        "group_id": entry.get("group_id"),
        "question": question,
    }


def _build_custom_entry(data: Dict[str, Any]) -> Dict[str, Any]:
    question_id = data.get("id") or f"manual-{uuid4().hex}"
    text = (data.get("text") or "Manual question").strip()
    answer_text = (data.get("answer_text") or "").strip() or None
    question_images = _sanitize_image_list(data.get("question_images"))
    answer_images = _sanitize_image_list(data.get("answer_images"))

    return {
        "topic": data.get("topic") or "Manual",
        "group_id": None,
        "question": {
            "question_id": question_id,
            "question_text": text,
            "images": question_images,
            "answer_text": answer_text,
            "answer_images": answer_images,
            "tags": ["manual"],
        },
    }


def _sanitize_image_list(value: Any) -> List[str]:
    if not value:
        return []
    images: List[str] = []
    for item in value:
        if isinstance(item, str):
            images.append(item)
    return images


def _resolve_image(bank_id: str, reference: str) -> Optional[str]:
    if not reference:
        return None
    if reference.startswith("http://") or reference.startswith("https://"):
        return reference
    if reference.startswith("/"):
        return reference
    return url_for("serve_bank_asset", bank_id=bank_id, filename=reference)


def _generate_code(length: int = 4) -> str:
    attempt = 0
    while attempt < 1000:
        code = "".join(random.choices(string.digits, k=length))
        if code not in SESSIONS:
            return code
        attempt += 1
    raise RuntimeError("Unable to generate unique session code")


def _get_session(code: Optional[str]) -> SessionState:
    if not code:
        abort(400, description="code is required")
    session = SESSIONS.get(code)
    if not session:
        abort(404, description="Session not found or has ended")
    return session


def _question_payload(session: SessionState, include_answers: bool) -> Optional[Dict[str, Any]]:
    current = session.current_question
    if not current:
        return None

    bank_id = session.bank_id
    question = current["question"]
    text = question.get("question_text")
    prompt = question.get("prompt")
    display_text = text or prompt or "Question"

    question_id = question.get("question_id")
    tags = question.get("tags") if isinstance(question.get("tags"), list) else None
    images = [
        _resolve_image(bank_id, img)
        for img in question.get("images", [])
        if isinstance(img, str)
    ]
    images = [img for img in images if img]

    answer_text = question.get("answer_text") if include_answers else None
    answer_images: List[str] = []
    if include_answers and question.get("answer_images"):
        answer_images = [
            _resolve_image(bank_id, img)
            for img in question.get("answer_images", [])
            if isinstance(img, str)
        ]
        answer_images = [img for img in answer_images if img]

    return {
        "id": question_id,
        "text": display_text,
        "topic": current.get("topic"),
        "tags": tags,
        "images": images,
        "answer": {"text": answer_text, "images": answer_images}
        if include_answers
        else None,
    }


def _session_state(session: SessionState, *, view: str) -> Dict[str, Any]:
    total = len(session.questions)
    include_answers = view == "presenter" or session.revealed
    question_payload = _question_payload(session, include_answers=include_answers)

    payload: Dict[str, Any] = {
        "active": True,
        "session_code": session.code,
        "bank_id": session.bank_id,
        "current_index": session.current_index,
        "total_questions": total,
        "revealed": session.revealed,
        "question": question_payload,
        "responses": session.responses if view == "presenter" else [],
    }

    if view != "presenter" and question_payload and not session.revealed:
        payload["question"]["answer"] = None

    if view == "presenter":
        payload["join_url"] = _build_join_url(session.code)

    return payload


@app.route("/")
def index() -> Any:
    return redirect(url_for("presenter"))


@app.route("/presenter")
def presenter() -> Any:
    if not _presenter_authorized():
        return render_template("presenter_login.html", error=None)
    banks = [{"id": key, "label": value["label"]} for key, value in QUESTION_BANKS.items()]
    return render_template("presenter.html", banks=banks)


@app.post("/presenter/login")
def presenter_login() -> Any:
    code = (request.form.get("access_code") or "").strip()
    if code == PRESENTER_ACCESS_CODE:
        session["presenter_authorized"] = True
        return redirect(url_for("presenter"))
    error = "Incorrect access code. Please try again."
    return render_template("presenter_login.html", error=error), 401


@app.post("/presenter/logout")
def presenter_logout() -> Any:
    session.pop("presenter_authorized", None)
    return redirect(url_for("presenter"))


@app.route("/student")
def student() -> Any:
    return render_template("student.html")


@app.route("/api/session", methods=["GET", "POST", "DELETE"])
def session_api() -> Any:
    if request.method == "POST":
        _require_presenter()
        data = request.get_json(silent=True) or {}
        bank_id = data.get("bank_id")
        if not bank_id:
            abort(400, description="bank_id is required")
        question_ids = data.get("question_ids")
        topics = data.get("topics") if not question_ids else None
        queue_payload = data.get("queue")
        custom_payload = data.get("custom_questions") if queue_payload else None

        if queue_payload:
            cache = _bank_entries(bank_id)
            assembled: List[Dict[str, Any]] = []
            for item in queue_payload:
                if not isinstance(item, dict):
                    continue
                item_type = item.get("type")
                item_id = item.get("id")
                if item_type == "bank" and item_id:
                    entry = cache["id_lookup"].get(item_id)
                    if entry:
                        assembled.append(_clone_entry(entry))
                elif item_type == "custom" and item_id and custom_payload:
                    custom_data = custom_payload.get(item_id)
                    if isinstance(custom_data, dict):
                        assembled.append(_build_custom_entry(custom_data))
            questions = assembled or _load_questions(bank_id, topics=topics, question_ids=question_ids)
        else:
            questions = _load_questions(bank_id, topics=topics, question_ids=question_ids)
        code = _generate_code()
        session = SessionState(code, bank_id, questions)
        SESSIONS[code] = session
        return jsonify(_session_state(session, view="presenter"))

    code = request.args.get("code")
    if request.method == "DELETE":
        _require_presenter()
        if not code:
            abort(400, description="code is required")
        session = SESSIONS.pop(code, None)
        if session:
            return jsonify({"ok": True})
        abort(404, description="Session not found or already removed")

    session_obj = _get_session(code)
    view = request.args.get("view", "student")
    if view not in {"student", "presenter"}:
        view = "student"
    if view == "presenter":
        _require_presenter()
    return jsonify(_session_state(session_obj, view=view))


@app.route("/api/session/next", methods=["POST"])
def session_next() -> Any:
    _require_presenter()
    data = request.get_json(silent=True) or {}
    session = _get_session(data.get("code"))
    if session.current_index + 1 >= len(session.questions):
        return jsonify({"active": True, "end": True, "session_code": session.code})

    session.current_index += 1
    session.revealed = False
    session.responses = []
    return jsonify(_session_state(session, view="presenter"))


@app.route("/api/session/reveal", methods=["POST"])
def session_reveal() -> Any:
    _require_presenter()
    data = request.get_json(silent=True) or {}
    session = _get_session(data.get("code"))
    session.revealed = True
    return jsonify(_session_state(session, view="presenter"))


@app.route("/api/session/responses", methods=["POST", "DELETE"])
def session_responses() -> Any:
    data = request.get_json(silent=True) or {}
    session = _get_session(data.get("code"))

    if request.method == "DELETE":
        _require_presenter()
        session.responses = []
        return jsonify(_session_state(session, view="presenter"))

    name = (data.get("name") or "").strip()
    answer = (data.get("answer") or "").strip()

    if not name or not answer:
        abort(400, description="Name and answer are required")

    session.responses.append(
        {
            "name": name,
            "answer": answer,
            "submitted_at": datetime.utcnow().isoformat(),
        }
    )
    return jsonify({"ok": True})


@app.route("/api/session/goto", methods=["POST"])
def session_goto() -> Any:
    _require_presenter()
    data = request.get_json(silent=True) or {}
    session = _get_session(data.get("code"))
    target = data.get("index")
    if not isinstance(target, int):
        abort(400, description="index must be an integer")
    if not (0 <= target < len(session.questions)):
        abort(400, description="index out of range")

    session.current_index = target
    session.revealed = False
    session.responses = []
    return jsonify(_session_state(session, view="presenter"))


@app.route("/bank-assets/<bank_id>/<path:filename>")
def serve_bank_asset(bank_id: str, filename: str):
    config = _require_bank(bank_id)
    safe_path = Path(filename)
    if safe_path.is_absolute() or ".." in safe_path.parts:
        abort(404)
    directory = config["base_dir"]
    return send_from_directory(directory, safe_path.as_posix())


@app.route("/api/bank/<bank_id>/outline")
def bank_outline(bank_id: str) -> Any:
    _require_presenter()
    cache = _bank_entries(bank_id)
    entries = cache["entries"]
    summary: Dict[str, Dict[str, Any]] = {}
    for entry in entries:
        topic = entry.get("topic") or "Untitled"
        question = entry.get("question", {})
        question_id = question.get("question_id")
        if not question_id:
            continue
        if topic not in summary:
            summary[topic] = {
                "topic": topic,
                "question_count": 0,
                "questions": [],
            }
        text = question.get("question_text") or question.get("prompt") or "Question"
        summary[topic]["question_count"] += 1
        summary[topic]["questions"].append(
            {
                "id": question_id,
                "text": text,
                "has_images": bool(question.get("images")),
                "tags": question.get("tags", []),
            }
        )

    topics = sorted(summary.values(), key=lambda item: item["topic"].lower())

    bank_meta = QUESTION_BANKS.get(bank_id, {})

    return jsonify(
        {
            "bank": {
                "id": bank_id,
                "label": bank_meta.get("label", bank_id),
            },
            "topics": topics,
        }
    )


@app.post("/api/presenter/upload-image")
def presenter_upload_image() -> Any:
    _require_presenter()
    file = request.files.get("file")
    if not file or file.filename == "":
        abort(400, description="file is required")

    filename = secure_filename(file.filename)
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_IMAGE_EXTENSIONS:
        abort(400, description="Unsupported file type")

    unique_name = f"{uuid4().hex}{extension}"
    save_path = USER_IMAGE_DIR / unique_name
    try:
        file.save(save_path)
    except OSError as exc:
        abort(500, description=f"Could not save image: {exc}")

    url = url_for("serve_user_image", filename=unique_name)
    return jsonify({"url": url, "filename": unique_name})


@app.route("/user-images/<path:filename>")
def serve_user_image(filename: str):
    safe_path = Path(filename)
    if safe_path.is_absolute() or ".." in safe_path.parts:
        abort(404)
    return send_from_directory(USER_IMAGE_DIR, safe_path.as_posix())


@app.get("/api/presenter/user-images")
def presenter_user_images() -> Any:
    _require_presenter()
    items = []
    for path in sorted(USER_IMAGE_DIR.glob("*"), key=lambda p: p.stat().st_mtime, reverse=True):
        if not path.is_file():
            continue
        if path.suffix.lower() not in ALLOWED_IMAGE_EXTENSIONS:
            continue
        items.append(
            {
                "filename": path.name,
                "url": url_for("serve_user_image", filename=path.name),
                "size": path.stat().st_size,
                "updated": datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
            }
        )
    return jsonify({"images": items})


def _build_join_url(session_code: str) -> str:
    try:
        base_host = request.host
        scheme = request.scheme or "http"
    except RuntimeError:
        base_host = None
        scheme = "http"

    if base_host:
        host, _, port = base_host.partition(":")
    else:
        host, port = None, "5000"

    if not port:
        port = "80" if scheme == "http" else "443"

    if host and host not in {"127.0.0.1", "localhost", "0.0.0.0"} and not host.startswith("127."):
        network_host = host
    else:
        network_host = _detect_local_ip()

    try:
        join_path = url_for("student", code=session_code)
    except RuntimeError:
        join_path = f"/student?code={session_code}"

    return f"{scheme}://{network_host}:{port}{join_path}"


def _detect_local_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            ip = sock.getsockname()[0]
            if ip and not ip.startswith("127."):
                return ip
    except OSError:
        pass

    try:
        hostname = socket.gethostname()
        ip = socket.gethostbyname(hostname)
        if ip and not ip.startswith("127."):
            return ip
        for addr in socket.gethostbyname_ex(hostname)[2]:
            if addr and not addr.startswith("127."):
                return addr
    except OSError:
        pass

    return "127.0.0.1"


def _presenter_authorized() -> bool:
    return session.get("presenter_authorized") is True


def _require_presenter() -> None:
    if not _presenter_authorized():
        abort(403)


if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host='0.0.0.0', port=5550, debug=True)
