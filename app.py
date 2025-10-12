from flask import (
    Flask,
    abort,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    url_for,
)
import os
import re
import random
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
import io
import json
import tempfile
from datetime import datetime
from functools import lru_cache

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SEARCH_PLACEHOLDER = "Search by concept, keyword or tag"
DEFAULT_TITLE_NOTES = (
    "Class should be your CS class NOT your AS class — e.g. CS1\n"
    "Leave mark blank (Teachers use)"
)
REVIEW_STORAGE_DIR = os.path.join(BASE_DIR, 'review_logs')
# Create a Flask application instance
app = Flask(__name__)

# Helper functions should be defined before routes

QUESTION_BANKS = {
    "CSA2": {
        "label": "Computer Science A2",
        "json": "A2Questions.json",
        "search_placeholder": "Search A2 CS topics — e.g. recursion, enumerated, floating point",
        "search_examples": ["recursion", "enumerated", "floating point", "binary search"],
    },
    "CSAS": {
        "label": "Computer Science AS",
        "json": "ASQuestions.json",
        "search_placeholder": "Look up AS topics like - SQL, Logic Gate, 2D array",
        "search_examples": ["Logic Gate", "SQL", "Router", "2D array"],
    },
    "CSIG": {
        "label": "Computer Science IGCSE",
        "json": "IGTheory.json",
        "search_placeholder": "Look up IGCSE concepts — e.g. lossy, sensors, flowchart",
        "search_examples": ["lossy compression", "sensor", "flowchart", "binary"],
    },
    "PHAS": {
        "label": "Physics AS",
        "json": "ASPhysicsQB.json",
        "search_placeholder": "Search AS Physics — e.g. SHM, resistivity, acceleration",
        "search_examples": ["SHM", "resistivity", "acceleration", "electromagnetic"],
    },
    "PHIG": {
        "label": "Physics IGCSE",
        "json": "IGPQ.json",
        "search_placeholder": "Try GCSE ideas — e.g. momentum, refraction, graph",
        "search_examples": ["momentum", "refraction", "graph", "radiation"],
    },
    "PHA2": {
        "label": "Physics A2",
        "json": "A2Questions.json",
        "search_placeholder": "Search A2 Physics — e.g. capacitors, nuclei, simple harmonic",
        "search_examples": ["capacitor", "radioactive decay", "SHM", "magnetic flux"],
    },
}


def get_bank_config(bank_id):
    bank = QUESTION_BANKS.get(bank_id)
    if not bank:
        abort(404)

    base_dir = os.path.join(BASE_DIR, bank_id)
    if not os.path.isdir(base_dir):
        abort(404)

    config = {
        "id": bank_id,
        "label": bank["label"],
        "base_dir": base_dir,
        "json_path": os.path.join(base_dir, bank["json"]),
        "images_dir": os.path.join(base_dir, "images"),
        "notes_path": os.path.join(base_dir, "notes.json"),
    }
    if "search_placeholder" in bank:
        config["search_placeholder"] = bank["search_placeholder"]
    if "search_examples" in bank:
        config["search_examples"] = bank["search_examples"]

    return config



def _natural_key(value):
    if not value:
        return []
    if not isinstance(value, str):
        value = str(value)
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", value)]


@lru_cache(maxsize=None)
def get_question_lookup(bank_id):
    data = load_questions_data(bank_id)
    lookup = {}
    fallback_index = 0
    for topic, groups in data.items():
        for idx, group in enumerate(groups, start=1):
            group_key = group.get('group_id')
            if not group_key:
                fallback_index += 1
                group_key = f"{topic}_{idx}_{fallback_index}"
            for question in group.get('questions', []):
                qid = question.get('question_id')
                if qid and qid not in lookup:
                    lookup[qid] = group_key
    return lookup

@lru_cache(maxsize=None)
def load_questions_data(bank_id):
    config = get_bank_config(bank_id)
    try:
        with open(config["json_path"], "r") as file:
            payload = json.load(file)
    except FileNotFoundError:
        abort(404)
    if isinstance(payload, dict) and "topics" in payload:
        return payload["topics"]
    return payload


def _review_state_path(bank_id):
    return os.path.join(REVIEW_STORAGE_DIR, f"{bank_id}.json")


def _load_review_state(bank_id):
    path = _review_state_path(bank_id)
    if not os.path.exists(path):
        return {"bank_id": bank_id, "groups": {}, "updated_at": None}
    try:
        with open(path, "r") as file:
            data = json.load(file)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"bank_id": bank_id, "groups": {}, "updated_at": None}
    if not isinstance(data, dict):
        return {"bank_id": bank_id, "groups": {}, "updated_at": None}
    if "groups" not in data or not isinstance(data["groups"], dict):
        data["groups"] = {}
    return data


def _write_review_state(bank_id, groups):
    os.makedirs(REVIEW_STORAGE_DIR, exist_ok=True)
    path = _review_state_path(bank_id)
    payload = {
        "bank_id": bank_id,
        "updated_at": datetime.utcnow().isoformat() + "Z",
        "groups": groups,
    }
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w") as file:
        json.dump(payload, file, indent=2)
    os.replace(tmp_path, path)


@app.route('/bank/<bank_id>/images/<path:filename>')
def serve_bank_image(bank_id, filename):
    config = get_bank_config(bank_id)
    return send_from_directory(config['images_dir'], filename)


@app.route('/practice')
def practice_root():
    default_bank = next(iter(QUESTION_BANKS.keys()))
    return redirect(url_for('practice_home', bank_id=default_bank))


@app.route('/practice/<bank_id>')
def practice_home(bank_id):
    questions_data = load_questions_data(bank_id)
    config = get_bank_config(bank_id)
    topics = sorted(questions_data.keys())
    available = [
        {'id': key, 'label': info['label']}
        for key, info in QUESTION_BANKS.items()
    ]
    return render_template(
        'practice.html',
        bank_id=bank_id,
        bank_label=config['label'],
        topics=topics,
        available_banks=available,
    )


@app.route('/practice/<bank_id>/session')
def practice_session(bank_id):
    questions_data = load_questions_data(bank_id)
    topic = request.args.get('topic')
    count = int(request.args.get('count', 10))

    question_pool = []

    def extend_unique(target_list, items):
        seen = set()
        for item in target_list:
            if item:
                seen.add(item)
        for item in items or []:
            if item and item not in seen:
                target_list.append(item)
                seen.add(item)

    for topic_name, groups in questions_data.items():
        if topic and topic != topic_name:
            continue
        for group in groups:
            questions = group.get('questions', []) or []
            if not questions:
                continue

            question_ids = []
            q_images = []
            answer_images = []
            total_points = 0

            for question in questions:
                qid = question.get('question_id')
                if qid:
                    question_ids.append(qid)
                total_points += get_question_points(question)
                extend_unique(q_images, question.get('images', []))
                extend_unique(answer_images, question.get('answer_images', []))

            if not q_images and not answer_images:
                continue

            primary_id = (
                group.get('group_id')
                or (question_ids[0] if question_ids else None)
                or f"{topic_name}_group_{len(question_pool) + 1}"
            )

            question_pool.append({
                'id': primary_id,
                'group_id': group.get('group_id'),
                'question_ids': question_ids,
                'topic': topic_name,
                'question_images': q_images,
                'answer_images': answer_images,
                'points': total_points,
            })

    random.shuffle(question_pool)
    return jsonify(question_pool[:count])

def get_question_points(question):
    if 'points' in question:
        return question['points']
    elif 'parts' in question:
        return sum(part.get('points', 0) for part in question['parts'])
    else:
        return 0

def calculate_topic_points(topic_data):
    """
    Calculate the total points available for a given topic
    """
    total_points = 0
    for group in topic_data:
        for question in group['questions']:
            total_points += get_question_points(question)
    return total_points

def get_question_id(question):
    if 'question_id' in question:
        return question['question_id']
    elif 'questions' in question and len(question['questions']) > 0:
        return question['questions'][0]['question_id']
    else:
        raise ValueError(f"Unable to find question ID in question object: {question}")

def build_template_context(bank_id, questions_data=None, additional_data=None):
    """Construct shared template data for a specific bank."""
    bank_config = get_bank_config(bank_id)
    if questions_data is None:
        questions_data = load_questions_data(bank_id)

    topic_points = {
        topic: calculate_topic_points(questions_data[topic])
        for topic in questions_data.keys()
    }

    available = [
        {'id': key, 'label': info['label']} for key, info in QUESTION_BANKS.items()
    ]
    available.sort(key=lambda item: item['label'])

    placeholder = bank_config.get('search_placeholder', DEFAULT_SEARCH_PLACEHOLDER)
    suggestions = bank_config.get('search_examples', [])

    data = {
        'bank_id': bank_id,
        'bank_label': bank_config['label'],
        'topics': list(questions_data.keys()),
        'topic_points': topic_points,
        'available_banks': available,
        'search_placeholder': placeholder,
        'search_suggestions': suggestions,
        'default_title_notes': DEFAULT_TITLE_NOTES,
    }

    if additional_data:
        data.update(additional_data)

    return data

# Routes
@app.route('/')
def index():
    landing_options = [
        {'id': bank_id, 'label': config['label']}
        for bank_id, config in QUESTION_BANKS.items()
    ]
    landing_options.sort(key=lambda item: item['label'])
    return render_template('landing.html', banks=landing_options)


def _build_base_additional(bank_id):
    questions_endpoint = url_for('get_questions', bank_id=bank_id, topic='__topic__')
    questions_base = questions_endpoint.rsplit('/', 1)[0] + '/'
    return {
        'image_base_url': url_for('serve_bank_image', bank_id=bank_id, filename='').rstrip('/'),
        'generate_pdf_url': url_for('generate_pdf', bank_id=bank_id),
        'search_url': url_for('search_questions', bank_id=bank_id),
        'notes_url': url_for('submit_note', bank_id=bank_id),
        'questions_api_base': questions_base,
        'review_data_url': url_for('review_data', bank_id=bank_id),
        'review_url': url_for('review_page', bank_id=bank_id),
        'review_status_url': url_for('review_status', bank_id=bank_id),
    }


@app.route('/bank/<bank_id>')
def bank_home(bank_id):
    questions_data = load_questions_data(bank_id)
    context = build_template_context(bank_id, questions_data, additional_data=_build_base_additional(bank_id))
    return render_template('index.html', **context)


def _collect_review_groups(bank_id, questions_data=None):
    if questions_data is None:
        questions_data = load_questions_data(bank_id)

    review_groups = []
    for topic_name, groups in questions_data.items():
        for group_index, group in enumerate(groups):
            normalized_questions = []
            for question in group.get('questions', []):
                normalized_questions.append({
                    'question_id': question.get('question_id'),
                    'question_text': question.get('question_text', ''),
                    'images': question.get('images', []),
                    'answer_images': question.get('answer_images', []),
                    'points': get_question_points(question),
                })

            review_groups.append({
                'topic': topic_name,
                'group_index': group_index,
                'group_id': group.get('group_id'),
                'tags': group.get('tags', []),
                'questions': normalized_questions,
            })

    review_groups.sort(key=lambda item: (_natural_key(item['topic']), item['group_index']))
    return review_groups


@app.route('/bank/<bank_id>/review')
def review_page(bank_id):
    questions_data = load_questions_data(bank_id)
    base_extra = _build_base_additional(bank_id)
    context = build_template_context(
        bank_id,
        questions_data,
        additional_data={
            **base_extra,
            'review_group_count': len(_collect_review_groups(bank_id, questions_data)),
        },
    )
    return render_template('review.html', **context)


@app.route('/bank/<bank_id>/review/data')
def review_data(bank_id):
    groups = _collect_review_groups(bank_id)
    return jsonify({'bank_id': bank_id, 'groups': groups})


@app.route('/bank/<bank_id>/review/status', methods=['GET', 'POST'])
def review_status(bank_id):
    if request.method == 'GET':
        state = _load_review_state(bank_id)
        return jsonify({
            'bank_id': bank_id,
            'entries': state.get('groups', {}),
            'updated_at': state.get('updated_at'),
        })

    payload = request.get_json(silent=True) or {}
    key = payload.get('key')
    if not key:
        return jsonify({'success': False, 'error': 'Missing entry key.'}), 400

    status = payload.get('status')
    notes = payload.get('notes') or ''
    topic = payload.get('topic') or ''
    group_id = payload.get('group_id') or None
    label = payload.get('label') or group_id or ''

    group_index = payload.get('group_index')
    try:
        group_index = int(group_index) if group_index is not None else None
    except (TypeError, ValueError):
        group_index = None

    state = _load_review_state(bank_id)
    groups = state.get('groups', {})

    if status is None and not notes:
        groups.pop(key, None)
    else:
        groups[key] = {
            'topic': topic,
            'group_index': group_index,
            'group_id': group_id,
            'label': label,
            'status': status,
            'notes': notes,
            'updated_at': datetime.utcnow().isoformat() + 'Z',
        }

    _write_review_state(bank_id, groups)

    return jsonify({'success': True, 'entries': groups})


# Define the route for generating a PDF based on selected topics and points
@app.route('/bank/<bank_id>/generate_pdf', methods=['POST'])
def generate_pdf(bank_id):
    questions_data = load_questions_data(bank_id)
    base_extra = _build_base_additional(bank_id)
    template_data = build_template_context(bank_id, questions_data, additional_data=base_extra)
    bank_config = get_bank_config(bank_id)
    is_async = request.headers.get('X-Requested-With', '').lower() == 'xmlhttprequest'

    def respond_error(message, status_code=400):
        if is_async:
            return jsonify({'success': False, 'error': message}), status_code
        template_data['error'] = message
        return render_template('index.html', **template_data), status_code

    selected_topics = [topic for topic in request.form.getlist('topics') if topic in questions_data]
    if not selected_topics:
        return respond_error("Please select at least one topic.")

    try:
        target_points = int(request.form.get('points', 0))
    except (TypeError, ValueError):
        return respond_error("Please enter a valid number of points.")

    is_custom = request.form.get('custom_selection') == 'true'

    if is_custom:
        selected_questions = []
        total_points = 0
        selected_question_ids = request.form.getlist('selected_questions')

        for selection in selected_question_ids:
            try:
                topic, group_index = selection.split('|')
                group_index = int(group_index)
            except (ValueError, AttributeError):
                return respond_error("Invalid question selection received.")

            if topic not in questions_data:
                return respond_error("A selected topic is not available in this bank.")

            groups = questions_data[topic]
            if group_index < 0 or group_index >= len(groups):
                return respond_error("A selected question group could not be found.")

            group = groups[group_index]
            for question in group['questions']:
                selected_questions.append(question)
                total_points += get_question_points(question)
    else:
        exclude_unrelated = request.form.get('exclude_unrelated') == 'on'
        selected_questions = generate_questions(
            questions_data,
            selected_topics,
            target_points,
            exclude_unrelated,
        )
        total_points = sum(
            get_question_points(q if isinstance(q, dict) else q['question'])
            for q in selected_questions
        )

    if not selected_questions:
        return respond_error("No questions could be selected. Please check your criteria.")

    normalized_questions = []
    for q in selected_questions:
        if isinstance(q, dict) and 'question' not in q:
            normalized_questions.append({
                'question': q,
                'images': q.get('images', []),
                'answer_images': q.get('answer_images', []),
                'points': get_question_points(q),
                'question_id': q.get('question_id', ''),
            })
        else:
            normalized_questions.append(q)

    title_page_enabled = request.form.get('title_page_enabled')
    title_page_options = None
    if title_page_enabled:
        breakdown = collect_mark_breakdown(normalized_questions, bank_id)
        notes_text = request.form.get('title_page_notes', '') or ''
        notes_text = notes_text.strip() or DEFAULT_TITLE_NOTES
        title_page_options = {
            'title': (request.form.get('title_page_title') or bank_config['label']).strip() or bank_config['label'],
            'subtitle': (request.form.get('title_page_subtitle') or '').strip(),
            'date': (request.form.get('title_page_date') or '').strip(),
            'notes': notes_text,
            'total_points': total_points,
            'breakdown': breakdown,
        }

    question_pdf_url, answer_pdf_url, warning_message = generate_pdfs(
        normalized_questions, bank_config, title_page_options=title_page_options
    )

    if is_async:
        return jsonify({
            'success': True,
            'question_pdf_url': question_pdf_url,
            'answer_pdf_url': answer_pdf_url,
            'warning_message': warning_message,
            'total_points': total_points,
        })

    template_data.update({
        'question_pdf_url': question_pdf_url,
        'answer_pdf_url': answer_pdf_url,
        'warning_message': warning_message,
        'total_points': total_points,
    })

    return render_template('index.html', **template_data)

# Define a route to serve the generated PDFs
@app.route('/view_pdf/<filename>')
def view_pdf(filename):
    return send_from_directory(tempfile.gettempdir(), filename)

def is_unrelated(question):
    """Check if a question has the unrelated tag"""
    if 'tags' in question:
        return 'unrelated' in [tag.lower() for tag in question['tags']]
    return False
import random  # already imported at top

def _max_fitting_prefix(questions, remaining, get_points):
    """
    Return (prefix_list, prefix_points), keeping original order.
    Takes the longest prefix that fits within 'remaining'.
    """
    total = 0
    out = []
    for q in questions:
        p = get_points(q)
        if total + p > remaining:
            break
        out.append(q)
        total += p
    return out, total  # may be ([], 0) if even the first part doesn't fit


def generate_questions(questions_data, topics, points, exclude_unrelated, seed=None):
    """
    Random across topics and groups, but PRESERVE order of parts inside a group.
    If a whole group doesn't fit, take the longest PREFIX that fits (never b without a).
    """
    rng = random.Random(seed) if seed is not None else random

    selected_questions = []
    current_points = 0

    # Build pools: per-topic list of groups (each group is the original-ordered list of parts)
    topic_pools = {t: [] for t in topics if t in questions_data}
    for t in topics:
        if t not in questions_data:
            continue
        for group in questions_data[t]:
            if exclude_unrelated:
                filtered = [q for q in group['questions'] if not is_unrelated(q)]
                if filtered:
                    topic_pools[t].append(filtered)   # keep original order inside group
            else:
                topic_pools[t].append(group['questions'])

    # Shuffle groups within each topic (but DO NOT touch order of parts inside a group)
    for t in topic_pools.keys():
        rng.shuffle(topic_pools[t])

    # Shuffle topic order and pick a random start (removes first-topic bias)
    topic_order = list(topics)
    rng.shuffle(topic_order)
    start_idx = rng.randrange(len(topic_order)) if topic_order else 0

    def remaining():
        return points - current_points

    # Round-robin over topics until we hit the target or no progress can be made
    while current_points < points and any(topic_pools.get(t) for t in topic_order):
        made_progress = False

        for k in range(len(topic_order)):
            if current_points >= points:
                break

            t = topic_order[(start_idx + k) % len(topic_order)]
            if t not in topic_pools or not topic_pools[t]:
                continue

            # Take one group (groups already randomized for this topic)
            group = topic_pools[t].pop()  # keep parts in original order
            group_total = sum(get_question_points(q) for q in group)

            if group_total <= remaining():
                # Whole group fits -> append all parts in order
                selected_questions.extend(group)
                current_points += group_total
                made_progress = True
            else:
                # Only a prefix can fit -> take longest prefix (a, a+b, a+b+c, ...)
                prefix, pref_pts = _max_fitting_prefix(group, remaining(), get_question_points)
                if pref_pts > 0:
                    selected_questions.extend(prefix)
                    current_points += pref_pts
                    made_progress = True
                # If even the first part doesn't fit, skip this group and continue

        # Next pass starts from next topic to avoid favoring the same topic repeatedly
        start_idx = (start_idx + 1) % len(topic_order)

        if not made_progress:
            # No topic could add anything more without exceeding the target
            break

    return selected_questions



def collect_mark_breakdown(normalized_questions, bank_id):
    lookup = get_question_lookup(bank_id)
    totals = {}
    order = []
    fallback_counter = 0

    for item in normalized_questions:
        question = item['question']
        qid = question.get('question_id')
        group_key = lookup.get(qid)
        if not group_key:
            fallback_counter += 1
            group_key = f"auto_{fallback_counter}"
        if group_key not in totals:
            label = f"Q {len(order) + 1}"
            totals[group_key] = {'label': label, 'total': 0}
            order.append(group_key)
        totals[group_key]['total'] += get_question_points(question)

    return [totals[key] for key in order]


# def generate_questions(topics, points, exclude_unrelated):
#     selected_questions = []
#     current_points = 0
#     topic_pools = {topic: [] for topic in topics}
    
#     # Step 1: Group the questions by group_id for each topic
#     for topic in topics:
#         for group in questions_data[topic]:
#             if exclude_unrelated:
#                 filtered_questions = [q for q in group['questions'] if not is_unrelated(q)]
#                 if filtered_questions:
#                     topic_pools[topic].append(filtered_questions)
#             else:
#                 topic_pools[topic].append(group['questions'])

#     # Step 2: Shuffle the groups within each topic (but not the questions inside the group)
#     for topic in topic_pools:
#         random.shuffle(topic_pools[topic])  # Shuffle the question groups for each topic

#     # Step 3: Distribute questions in a round-robin fashion until the required points are met
#     while current_points < points and any(topic_pools.values()):
#         for topic in topics:
#             if topic_pools[topic]:
#                 question_group = topic_pools[topic].pop(0)  # Get the next group from the shuffled list
#                 group_points = sum(get_question_points(question) for question in question_group)

#                 # Add the whole group if it doesn't exceed the required points
#                 if current_points + group_points <= points:
#                     selected_questions.extend(question_group)
#                     current_points += group_points
#                 else:
#                     # If adding the whole group exceeds the points, add individual questions (in original order)
#                     for question in question_group:
#                         question_points = get_question_points(question)
#                         if current_points + question_points <= points:
#                             selected_questions.append(question)
#                             current_points += question_points
#                         if current_points >= points:
#                             break

#                 if current_points >= points:
#                     break

#     return selected_questions

# Added to allow user to submit problems!


def load_notes(bank_config):
    try:
        if os.path.exists(bank_config['notes_path']):
            with open(bank_config['notes_path'], 'r') as file:
                return json.load(file)
    except Exception as e:
        print(f"Error loading notes for {bank_config['id']}: {e}")
    return []


def save_notes(bank_config, notes):
    try:
        os.makedirs(os.path.dirname(bank_config['notes_path']), exist_ok=True)
        with open(bank_config['notes_path'], 'w') as file:
            json.dump(notes, file, indent=4)
    except Exception as e:
        print(f"Error saving notes for {bank_config['id']}: {e}")


@app.route('/bank/<bank_id>/submit_note', methods=['POST'])
def submit_note(bank_id):
    note = request.form.get('note')
    if note:
        bank_config = get_bank_config(bank_id)
        notes = load_notes(bank_config)
        notes.append(note)
        save_notes(bank_config, notes)
        return jsonify({'status': 'success', 'message': 'Note added successfully!'}), 200
    return jsonify({'status': 'error', 'message': 'Failed to add note.'}), 400

# Add new route to get questions for a specific topic
@app.route('/bank/<bank_id>/get_questions/<topic>')
def get_questions(bank_id, topic):
    questions_data = load_questions_data(bank_id)
    if topic in questions_data:
        formatted_groups = []
        for group_index, group in enumerate(questions_data[topic]):
            group_questions = []
            group_total_points = 0
            
            # Get group tags if they exist
            group_tags = group.get('tags', [])
            group_tag_text = f" - [{', '.join(group_tags)}]" if group_tags else ""
            
            for question in group['questions']:
                points = get_question_points(question)
                group_total_points += points
                
                # Get question tags if they exist
                question_tags = question.get('tags', [])
                question_tag_text = f" - [{', '.join(question_tags)}]" if question_tags else ""
                
                group_questions.append({
                    'question': f"Q{question.get('question_id', '')} ({points} points){question_tag_text}",
                    'points': points,
                     'question_id': question.get('question_id', ''),
                    'tags': question_tags,
                    'images': question.get('images', []),
                    'answer_images': question.get('answer_images', [])
                })
            
            formatted_groups.append({
                'group_id': group.get('group_id', f'Group {group_index + 1}'),
                'questions': group_questions,
                'total_points': group_total_points,
                'tags': group_tags,
                'tag_text': group_tag_text
            })
        return jsonify(formatted_groups)
    return jsonify([])


@app.route('/bank/<bank_id>/search_questions')
def search_questions(bank_id):
    term = request.args.get('q', '').strip().lower()
    if not term or len(term) < 2:
        return jsonify([])

    results = []

    questions_data = load_questions_data(bank_id)

    for topic, groups in questions_data.items():
        for group_index, group in enumerate(groups):
            group_title = group.get('group_id', f'Group {group_index + 1}')
            group_tags = [tag.lower() for tag in group.get('tags', [])]

            group_match = term in group_title.lower() or any(
                term in tag for tag in group_tags
            )

            question_match = None
            summary_text = ''

            for question in group.get('questions', []):
                searchable_fields = [
                    question.get('question_id', ''),
                    question.get('question_text', ''),
                    ' '.join(question.get('tags', [])),
                ]
                lowered = ' '.join(field.lower() for field in searchable_fields)
                if term in lowered:
                    question_match = question
                    summary_text = question.get('question_text', '')
                    break

            if group_match and not summary_text:
                first_question = group.get('questions', [{}])[0]
                summary_text = first_question.get('question_text', '')

            if group_match or question_match:
                if not summary_text and group.get('questions'):
                    summary_text = group['questions'][0].get('question_text', '')

                if summary_text:
                    summary = summary_text.strip()
                    if len(summary) > 160:
                        summary = summary[:157].rstrip() + '...'
                else:
                    summary = 'No question text available.'

                results.append({
                    'topic': topic,
                    'group_index': group_index,
                    'group_title': f"{group_title} ({sum(get_question_points(q) for q in group.get('questions', []))} pts)",
                    'summary': summary,
                })

    # Limit the number of returned results to keep UI responsive
    return jsonify(results[:25])

# Add this helper function to handle image paths consistently
def get_full_image_path(image_path, bank_config):
    """Convert relative image path to full path for a specific bank."""
    if not image_path:
        return None

    normalized = image_path.lstrip('/')
    candidates = [
        os.path.join(bank_config['base_dir'], normalized),
        os.path.join(bank_config['images_dir'], normalized),
    ]

    if normalized.startswith('images/'):
        candidates.append(os.path.join(bank_config['images_dir'], normalized[len('images/'):]))

    bank_prefix = f"{bank_config['id'].rstrip('/')}/"
    if normalized.startswith(bank_prefix):
        candidates.append(os.path.join(bank_config['base_dir'], normalized[len(bank_prefix):]))

    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate

    # Fallback to base dir join even if it may not exist yet
    return os.path.join(bank_config['base_dir'], normalized)




def format_points(value):
    if value is None:
        return ''
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return str(value)
    if numeric.is_integer():
        return str(int(round(numeric)))
    return str(numeric)


def draw_marks_table(canvas_obj, breakdown, margin=60, bottom_margin=120):
    if not breakdown:
        return

    width, height = letter
    max_columns = 8
    header_height = 24
    body_height = 32
    table_width = width - margin * 2
    rows = [breakdown[i : i + max_columns] for i in range(0, len(breakdown), max_columns)]

    y = bottom_margin + len(rows) * (header_height + body_height)
    for row in rows:
        columns = len(row) or 1
        cell_width = table_width / columns
        y -= header_height
        for idx, entry in enumerate(row):
            x = margin + idx * cell_width
            canvas_obj.rect(x, y, cell_width, header_height, stroke=1, fill=0)
            label = entry.get('label', '')
            total = entry.get('total')
            display = label
            total_str = format_points(total)
            if total_str:
                display = f"{label} ({total_str})"
            canvas_obj.setFont('Helvetica', 10)
            canvas_obj.drawCentredString(x + cell_width / 2, y + header_height / 2 - 3, display)

        body_y = y - body_height
        for idx in range(columns):
            x = margin + idx * cell_width
            canvas_obj.rect(x, body_y, cell_width, body_height, stroke=1, fill=0)
        y = body_y


def draw_title_page(canvas_obj, bank_config, options):
    width, height = letter
    margin = 72
    y = height - 90

    title = (options.get('title') or bank_config['label']).strip()
    canvas_obj.setFont('Helvetica-Bold', 26)
    canvas_obj.drawCentredString(width / 2, y, title)
    y -= 38

    subtitle = (options.get('subtitle') or '').strip()
    if subtitle:
        canvas_obj.setFont('Helvetica', 20)
        canvas_obj.drawCentredString(width / 2, y, subtitle)
        y -= 32

    date_text = (options.get('date') or '').strip()
    if date_text:
        canvas_obj.setFont('Helvetica', 14)
        canvas_obj.drawCentredString(width / 2, y, date_text)
        y -= 28

    y -= 10
    canvas_obj.setFont('Helvetica-Bold', 16)

    def draw_line(label, line_length=260, extra_text=''):
        nonlocal y
        canvas_obj.drawString(margin, y, label)
        line_start = margin + 65
        line_end = min(line_start + line_length, width - margin)
        canvas_obj.line(line_start, y - 6, line_end, y - 6)
        if extra_text:
            canvas_obj.drawString(line_end + 10, y, extra_text)
        y -= 32

    def draw_line_smaller(label, line_length=60, extra_text=''):
        nonlocal y
        canvas_obj.drawString(margin, y, label)
        line_start = margin + 65
        line_end = min(line_start + line_length, width - margin)
        canvas_obj.line(line_start, y - 6, line_end, y - 6)
        if extra_text:
            canvas_obj.drawString(line_end + 10, y, extra_text)
        y -= 32

    draw_line('Name:')
    draw_line_smaller('Class:')
    total_points = options.get('total_points')
    extra = f"/ {format_points(total_points)}" if total_points else ''
    draw_line_smaller('Mark:', extra_text=extra)

    notes = (options.get('notes') or DEFAULT_TITLE_NOTES).splitlines()
    if notes:
        canvas_obj.setFont('Helvetica', 12)
        for note_line in notes:
            canvas_obj.drawCentredString(width / 2, y, note_line.strip())
            y -= 18
        y -= 6

    breakdown = options.get('breakdown') or []
    if breakdown:
        draw_marks_table(canvas_obj, breakdown, margin=margin, bottom_margin=120)


def generate_pdfs(questions, bank_config, title_page_options=None, is_custom=False):
    question_filename = f"question_paper_{bank_config['id']}.pdf"
    answer_filename = f"answer_key_{bank_config['id']}.pdf"
    question_pdf_path = os.path.join(tempfile.gettempdir(), question_filename)
    answer_pdf_path = os.path.join(tempfile.gettempdir(), answer_filename)

    p_questions = canvas.Canvas(question_pdf_path, pagesize=letter)
    p_answers = canvas.Canvas(answer_pdf_path, pagesize=letter)
    width, height = letter

    if title_page_options:
        draw_title_page(p_questions, bank_config, title_page_options)
        p_questions.showPage()

    group_lookup = get_question_lookup(bank_config['id'])
    group_labels = {}
    first_question_indices = {}
    fallback_counter = 0

    for idx, question_data in enumerate(questions):
        question = question_data['question']
        qid = question.get('question_id')
        group_key = group_lookup.get(qid)
        if not group_key:
            fallback_counter += 1
            group_key = f"auto_{fallback_counter}"
        if group_key not in group_labels:
            label = f"Question {len(group_labels) + 1}"
            group_labels[group_key] = label
            first_question_indices[idx] = label

    y_position_questions = height - 40
    y_position_answers = height - 40
    answer_counter = 1

    for idx, question_data in enumerate(questions):
        # Get the question object consistently whether it's random or custom
        question = question_data['question']
        
        label = first_question_indices.get(idx)

        image_entries = []
        total_height = 0
        for image_path in question.get('images', []):
            full_image_path = get_full_image_path(image_path, bank_config)
            if os.path.exists(full_image_path):
                try:
                    img = ImageReader(full_image_path)
                    img_width, img_height = img.getSize()

                    max_width = width - 80
                    max_height = height - 80
                    width_scale = max_width / img_width
                    height_scale = max_height / img_height
                    scale = min(width_scale * 0.9, height_scale * 0.9, 1.0)
                    scaled_width = img_width * scale
                    scaled_height = img_height * scale
                    total_height += scaled_height
                    image_entries.append((img, scaled_width, scaled_height))
                except Exception as e:
                    print(f"Error processing question image {image_path}: {str(e)}")

        if label:
            if total_height and y_position_questions - (20 + total_height) < 50:
                p_questions.showPage()
                y_position_questions = height - 40
            y_position_questions -= 10
            p_questions.setFont("Helvetica-Bold", 12)
            p_questions.drawString(40, y_position_questions, label)
            y_position_questions -= 10

        for img, scaled_width, scaled_height in image_entries:
            if y_position_questions - scaled_height - 20 < 50:
                p_questions.showPage()
                y_position_questions = height - 40
            p_questions.setFont("Helvetica", 12)
            p_questions.drawImage(img, 40, y_position_questions - scaled_height, 
                               width=scaled_width, height=scaled_height)
            y_position_questions -= scaled_height

        # Process answer images
        for answer_image_path in question.get('answer_images', []):
            full_answer_path = get_full_image_path(answer_image_path, bank_config)
            if os.path.exists(full_answer_path):
                try:
                    img = ImageReader(full_answer_path)
                    img_width, img_height = img.getSize()

                    max_width = width - 80
                    scale = min(max_width / img_width, 1.0)
                    scaled_width = img_width * scale
                    scaled_height = img_height * scale

                    if y_position_answers - scaled_height - 20 < 50:
                        p_answers.showPage()
                        y_position_answers = height - 40

                    if answer_image_path[-6] == 'a':
                        p_answers.setFont("Helvetica", 12)
                        p_answers.drawString(20, y_position_answers, 
                                          f"{answer_counter}   Paper Information:   {answer_image_path[-19:-4]}")
                        answer_counter += 1
                        y_position_answers -= 20

                    p_answers.drawImage(img, 40, y_position_answers - scaled_height, 
                                     width=scaled_width, height=scaled_height)
                    y_position_answers -= (scaled_height + 20)
                except Exception as e:
                    print(f"Error processing answer image {answer_image_path}: {str(e)}")

    p_questions.save()
    p_answers.save()

    return (url_for('view_pdf', filename=question_filename),
            url_for('view_pdf', filename=answer_filename),
            None)

# Run the Flask application if this script is executed directly
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=9875, debug=True)

# "I have a structured question paper from a computer science exam. I need a JSON output for each question from the paper with the following structure:

# Each question belongs to a specific topic (e.g., 'Data Representation', 'Networking', etc.).
# Each question should be assigned to a unique group ID based on the topic, the exam session (e.g., 'Summer 2023'), and the paper component (e.g., 31).
# Each question should contain:
# A unique question_id based on its topic and position within the paper.
# A question_text field with the full text of the question.
# An images field, containing the path to an image file for the question in the format: images/questions23/{question_id}.png.
# An answer_images field containing the path to the corresponding answer image in the format: images/answers23/{question_id}A.png.
# A points field indicating the marks for the question.
# A paper field with the name of the exam session (e.g., 'Summer 2023').
# A component field that specifies the paper number (e.g., 31).
# A difficulty field indicating the difficulty level (e.g., 'easy', 'medium', 'hard').
# A tags field with keywords to describe the question (e.g., 'Part A', 'Networking').
# Make sure each topic is represented in the topics dictionary, and every question is properly grouped under its topic. Each topic may have multiple questions, and each question may contain sub-questions."

# Sample JSON Structure for Each Question:

# json
# Copy code
# {
#     "subject": "Computer Science",
#     "topics": {
#         "Data Representation": [
#             {
#                 "group_id": "DR_S23_32_1",
#                 "tags": ["Data Representation", "Summer 2023", "Medium"],
#                 "questions": [
#                     {
#                         "question_id": "DR_S23_32_1a",
#                         "question_text": "Write the normalised floating‑point representation of the binary number 0101010.111 using a system with 10 bits for the mantissa and 6 bits for the exponent.",
#                         "images": ["images/questions23/DR_S23_32_1a.png"],
#                         "answer_images": ["images/answers23/DR_S23_32_1aA.png"],
#                         "points": 2,
#                         "paper": "Summer 2023",
#                         "component": 32,
#                         "difficulty": "medium",
#                         "tags": ["Part A", "Data Representation"]
#                     },
#                     {
#                         "question_id": "DR_S23_32_1b",
#                         "question_text": "Describe the reason why the normalised form of the binary number 0101011.111001 cannot be represented accurately using this system.",
#                         "images": ["images/questions23/DR_S23_32_1b.png"],
#                         "answer_images": ["images/answers23/DR_S23_32_1bA.png"],
#                         "points": 3,
#                         "paper": "Summer 2023",
#                         "component": 32,
#                         "difficulty": "medium",
#                         "tags": ["Part B", "Data Representation"]
#                     }
#                 ]
#             }
#         ]
#     }
# }
# Instructions:

# The JSON file should include all topics and questions from the exam paper, following this structure.
# Replace {question_id} with a unique identifier for each question.
# Use the paths images/questions23/{question_id}.png for question images and images/answers23/{question_id}A.png for answer images.
# Include all relevant fields such as difficulty, points, paper, component, and tags.
# Goal: Provide JSON output for all questions, ensuring the structure is adhered to. Each question should be placed in its corresponding topic with a unique ID and paths to images. Each JSON object should include all details as specified."

# perfect extraction

# "I need you to extract all questions from the provided exam paper into a structured JSON format. 
# Ensure no questions or parts are skipped. The structure should follow my previous request: each question should
#  include all parts, points, and difficulty levels accurately, with the correct images paths. 
# Do not miss any question or make up any content. If any part of a question is missed or not included correctly, 
# redo the extraction fully."

# Extract all questions from the provided exam paper into a structured JSON format. Ensure each question includes all parts, points, and difficulty levels accurately, with the correct image paths for both questions and answers.

# Each question belongs to a specific topic (e.g., 'Data Representation', 'Networking').
# Each question should be assigned to a unique group ID based on the topic, the exam session (e.g., 'Summer 2021'), and the paper component (e.g., 11).
# Each question should contain:
# A unique question_id based on its topic and position within the paper.
# A question_text field with the full text of the question.
# An images field, containing the path to an image file for the question in the format: images/questions21/{question_id}.png.
# An answer_images field containing the path to the corresponding answer image in the format: images/answers21/{question_id}A.png.
# A points field indicating the marks for the question.
# A paper field with the name of the exam session (e.g., 'Summer 2021').
# A component field that specifies the paper number (e.g., 11).
# A difficulty field indicating the difficulty level (e.g., 'easy', 'medium', 'hard').
# A tags field with keywords to describe the question (e.g., 'Part A', 'Networking').
# Include all question sub-parts such as 1ai and 1aii, ensuring none are skipped.
# Make sure each sub-question has its own unique question_id and follows the above structure.



# The extraction labour needed to extract the questions as images from the original PDF needs to be automated. 
#  I have tried using Python to do this, but it seems too complex for regular expression to do.  Every question starts with a 
#  number, e.g. 1 2 3  .  Then each question may or may not have several parts, e.g. (a) (b) (c), then each part may or may not
#  have several or no subparts, e.g. (i) (ii) (iii). I want each individual question to be a separate image. 
#  Usually, a question will begin with an intro, and then part (a) will start or may not.  Imagine question 2 has 3 parts (a) (b), (c) 
#  and (a) and (b) has 2 subparts (i) and (ii).  2(a)(i) would be one image then 2(a)(ii) another and 2(b)(i) would be one 
#  image and so on...Some questions span multiple pages.  The pdf also has some tables or diagrams that are part of the questions.  
#  All I simply want to do is extract these questions and parts as separate images.  Any ideas on how to automate this?
