from __future__ import annotations

import base64
import json
import os
import random
import socket
import string
import re
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple
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
PRESENTER_ACCESS_CODE = os.environ.get("QRT_PRESENTER_CODE", "CIC2025Presenter")

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
TEMPLATE_STORAGE_PATH = BASE_DIR / "session_templates.json"


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


def _read_template_store() -> Dict[str, Any]:
    if not TEMPLATE_STORAGE_PATH.exists():
        return {}
    try:
        with TEMPLATE_STORAGE_PATH.open("r", encoding="utf-8") as handle:
            raw = json.load(handle)
    except json.JSONDecodeError as exc:
        abort(500, description=f"Template store is corrupted: {exc}")
    except OSError as exc:
        abort(500, description=f"Unable to read templates: {exc}")

    if isinstance(raw, dict):
        if isinstance(raw.get("templates"), dict):
            return raw["templates"]
        return {
            key: value
            for key, value in raw.items()
            if isinstance(key, str) and isinstance(value, dict)
        }

    if isinstance(raw, list):
        templates: Dict[str, Any] = {}
        for item in raw:
            if isinstance(item, dict):
                template_id = item.get("id")
                if isinstance(template_id, str):
                    templates[template_id] = item
        return templates

    return {}


def _write_template_store(templates: Dict[str, Any]) -> None:
    payload = {"templates": templates}
    tmp_path = TEMPLATE_STORAGE_PATH.with_name(f"{TEMPLATE_STORAGE_PATH.name}.tmp")
    try:
        with tmp_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
        tmp_path.replace(TEMPLATE_STORAGE_PATH)
    except OSError as exc:
        abort(500, description=f"Unable to save templates: {exc}")


def _serialize_template(template_id: str, template: Dict[str, Any], *, include_details: bool = True) -> Dict[str, Any]:
    queue = template.get("queue")
    question_count = len(queue) if isinstance(queue, list) else 0
    payload: Dict[str, Any] = {
        "id": template_id,
        "name": template.get("name") or "Untitled template",
        "bank_id": template.get("bank_id"),
        "question_count": question_count,
        "created_at": template.get("created_at"),
        "updated_at": template.get("updated_at"),
    }
    if include_details:
        payload["queue"] = queue or []
        payload["custom_questions"] = template.get("custom_questions") or {}
        payload["topics"] = template.get("topics") or []
    return payload


def _get_template_record(template_id: str) -> Dict[str, Any]:
    templates = _read_template_store()
    record = templates.get(template_id)
    if not isinstance(record, dict):
        abort(404, description="Template not found")
    return record


def _sanitize_template_topics(topics: Any) -> List[str]:
    if not isinstance(topics, list):
        return []
    sanitized: List[str] = []
    for topic in topics:
        if isinstance(topic, str):
            value = topic.strip()
            if value:
                sanitized.append(value)
    return sanitized


def _normalize_custom_question_payload(raw: Dict[str, Any], default_id: str) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        abort(400, description=f"Custom question payload for {default_id} is invalid")

    normalized = dict(raw)
    normalized["id"] = str(raw.get("id") or default_id)
    question_text = raw.get("text") or ""
    normalized["text"] = question_text.strip() if isinstance(question_text, str) else str(question_text)

    answer_text = raw.get("answer_text")
    if isinstance(answer_text, str):
        normalized["answer_text"] = answer_text.strip()
    elif answer_text is None:
        normalized["answer_text"] = ""
    else:
        normalized["answer_text"] = str(answer_text).strip()

    question_images = raw.get("question_images")
    if isinstance(question_images, list):
        normalized["question_images"] = [img for img in question_images if isinstance(img, str) and img]
    else:
        normalized["question_images"] = []

    answer_images = raw.get("answer_images")
    if isinstance(answer_images, list):
        normalized["answer_images"] = [img for img in answer_images if isinstance(img, str) and img]
    else:
        normalized["answer_images"] = []

    tags = raw.get("tags")
    if isinstance(tags, list):
        normalized["tags"] = [tag for tag in tags if isinstance(tag, str)]

    return normalized


def _normalize_template_queue(
    bank_id: str,
    queue_payload: Any,
    custom_payload: Any,
) -> Tuple[List[Dict[str, str]], Dict[str, Dict[str, Any]]]:
    if not isinstance(queue_payload, list):
        abort(400, description="queue must be an array")
    if not queue_payload:
        abort(400, description="queue must contain at least one item")

    cache = _bank_entries(bank_id)
    valid_questions = cache["id_lookup"]
    custom_map: Dict[str, Any] = custom_payload if isinstance(custom_payload, dict) else {}

    cleaned_queue: List[Dict[str, str]] = []
    required_custom_ids: Set[str] = set()

    for index, entry in enumerate(queue_payload):
        if not isinstance(entry, dict):
            abort(400, description=f"queue entry at position {index + 1} is invalid")
        entry_type = entry.get("type")
        entry_id = entry.get("id")
        if entry_type == "bank":
            if not entry_id or not isinstance(entry_id, str):
                abort(400, description=f"queue entry {index + 1} is missing a question id")
            if entry_id not in valid_questions:
                abort(400, description=f"Question {entry_id} is not available in the bank")
            cleaned_queue.append({"type": "bank", "id": entry_id})
        elif entry_type == "custom":
            if not entry_id or not isinstance(entry_id, str):
                abort(400, description=f"Custom queue entry {index + 1} is missing an id")
            if entry_id not in custom_map:
                abort(400, description=f"Custom question data missing for {entry_id}")
            required_custom_ids.add(entry_id)
            cleaned_queue.append({"type": "custom", "id": entry_id})
        else:
            abort(400, description=f"Unsupported queue entry type: {entry_type}")

    if not cleaned_queue:
        abort(400, description="queue must contain at least one item")

    cleaned_custom: Dict[str, Dict[str, Any]] = {}
    for custom_id in required_custom_ids:
        cleaned_custom[custom_id] = _normalize_custom_question_payload(custom_map[custom_id], custom_id)

    return cleaned_queue, cleaned_custom


def _save_data_url_image(data_url: str, *, prefix: str = "annotation-") -> str:
    if not data_url.startswith("data:image"):
        abort(400, description="Unsupported image format")
    try:
        header, encoded = data_url.split(",", 1)
    except ValueError:
        abort(400, description="Invalid image data")
    mime_part = header.split(";")[0]
    _, _, mime = mime_part.partition(":")
    extension = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/webp": ".webp",
    }.get(mime, ".png")
    try:
        binary = base64.b64decode(encoded)
    except (base64.binascii.Error, ValueError):
        abort(400, description="Could not decode image data")

    filename = f"{prefix}{uuid4().hex}{extension}"
    path = USER_IMAGE_DIR / filename
    try:
        with path.open("wb") as handle:
            handle.write(binary)
    except OSError as exc:
        abort(500, description=f"Could not save drawing: {exc}")
    return filename


def _normalize_answer_text(text: str, *, max_length: int = 280) -> str:
    if not text:
        return ""
    compact = re.sub(r"\s+", " ", text)
    compact = compact.strip()
    if max_length and len(compact) > max_length:
        compact = compact[:max_length].rstrip()
    return compact


def _resolve_image(bank_id: str, reference: str) -> Optional[str]:
    if not reference:
        return None
    if reference.startswith("http://") or reference.startswith("https://"):
        return reference
    if reference.startswith("/"):
        return reference
    return url_for("serve_bank_asset", bank_id=bank_id, filename=reference)


def _delete_session_annotations(session_code: str) -> None:
    pattern = f"annotation-{session_code}-*"
    for path in USER_IMAGE_DIR.glob(pattern):
        try:
            if path.is_file():
                path.unlink()
        except OSError:
            continue


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
            _delete_session_annotations(session.code)
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
        response_id = (data.get("response_id") or "").strip()
        if response_id:
            before = len(session.responses)
            session.responses = [entry for entry in session.responses if entry.get("id") != response_id]
            if len(session.responses) != before:
                return jsonify(_session_state(session, view="presenter"))
            abort(404, description="Response not found")
        session.responses = []
        return jsonify(_session_state(session, view="presenter"))

    name = (data.get("name") or "").strip()
    answer_raw = data.get("answer") or ""
    answer = _normalize_answer_text(answer_raw)
    drawing_url = (data.get("drawing_url") or "").strip()

    if not name:
        abort(400, description="Name is required")
    if not answer and not drawing_url:
        abort(400, description="Provide an answer or a drawing")

    response_entry = {
        "id": uuid4().hex,
        "name": name,
        "answer": answer,
        "drawing_url": drawing_url or None,
        "submitted_at": datetime.utcnow().isoformat(),
    }
    session.responses.append(response_entry)
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


@app.route("/api/templates", methods=["GET", "POST"])
def templates_collection() -> Any:
    _require_presenter()
    if request.method == "GET":
        bank_filter = request.args.get("bank_id")
        templates = _read_template_store()
        items: List[Dict[str, Any]] = []
        for template_id, record in templates.items():
            if not isinstance(record, dict):
                continue
            if bank_filter and record.get("bank_id") != bank_filter:
                continue
            items.append(_serialize_template(template_id, record))
        items.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
        return jsonify({"templates": items})

    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        abort(400, description="name is required")
    bank_id = data.get("bank_id")
    if not bank_id or not isinstance(bank_id, str):
        abort(400, description="bank_id is required")

    queue, cleaned_custom = _normalize_template_queue(bank_id, data.get("queue"), data.get("custom_questions"))
    topics = _sanitize_template_topics(data.get("topics"))

    timestamp = datetime.utcnow().isoformat()
    template_id = uuid4().hex
    record = {
        "name": name,
        "bank_id": bank_id,
        "queue": queue,
        "custom_questions": cleaned_custom,
        "topics": topics,
        "created_at": timestamp,
        "updated_at": timestamp,
    }

    templates = _read_template_store()
    templates[template_id] = record
    _write_template_store(templates)

    return jsonify({"template": _serialize_template(template_id, record)}), 201


@app.route("/api/templates/<template_id>", methods=["GET", "DELETE"])
def template_detail(template_id: str) -> Any:
    _require_presenter()
    if request.method == "GET":
        record = _get_template_record(template_id)
        return jsonify({"template": _serialize_template(template_id, record)})

    templates = _read_template_store()
    if template_id not in templates:
        abort(404, description="Template not found")

    templates.pop(template_id)
    _write_template_store(templates)
    return jsonify({"ok": True})


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
        preview_image = None
        images = question.get("images") if isinstance(question.get("images"), list) else []
        if images:
            preview_image = _resolve_image(bank_id, images[0])
        summary[topic]["questions"].append(
            {
                "id": question_id,
                "text": text,
                "has_images": bool(images),
                "tags": question.get("tags", []),
                "preview_image": preview_image,
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


@app.get("/api/bank/<bank_id>/question/<question_id>")
def bank_question_detail(bank_id: str, question_id: str) -> Any:
    _require_presenter()
    cache = _bank_entries(bank_id)
    entry = cache["id_lookup"].get(question_id)
    if not entry:
        abort(404, description="Question not found")

    cloned = _clone_entry(entry)
    question = cloned.get("question", {})
    images = []
    for ref in question.get("images", []) or []:
        if isinstance(ref, str):
            resolved = _resolve_image(bank_id, ref)
            if resolved:
                images.append(resolved)

    answer_images = []
    for ref in question.get("answer_images", []) or []:
        if isinstance(ref, str):
            resolved = _resolve_image(bank_id, ref)
            if resolved:
                answer_images.append(resolved)

    return jsonify(
        {
            "id": question.get("question_id"),
            "topic": cloned.get("topic"),
            "group_id": cloned.get("group_id"),
            "text": question.get("question_text"),
            "prompt": question.get("prompt"),
            "tags": question.get("tags", []),
            "images": images,
            "answer_text": question.get("answer_text"),
            "answer_images": answer_images,
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


@app.post("/api/student/upload-drawing")
def student_upload_drawing() -> Any:
    data = request.get_json(silent=True) or {}
    code = data.get("code")
    image_data = data.get("image")
    session = _get_session(code)

    if not image_data or not isinstance(image_data, str):
        abort(400, description="image data is required")

    filename = _save_data_url_image(image_data, prefix=f"annotation-{session.code}-")
    url = url_for("serve_user_image", filename=filename)
    return jsonify({"url": url, "filename": filename})


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
