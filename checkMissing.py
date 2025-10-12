import json
from pathlib import Path

BASE = Path("")  # adjust if you run from elsewhere
BANKS = {
    "CSA2": "A2Questions.json",
    "CSAS": "ASQuestions.json",
    "CSIG": "IGTheory.json",
    "PHAS": "ASPhysicsQB.json",
    "PHIG": "IGPQ.json",
    "PHA2": "A2Questions.json",
}

missing = []

for bank, json_file in BANKS.items():
    json_path = BASE / bank / json_file
    data = json.loads(json_path.read_text())
    for topic, groups in data.get("topics", {}).items():
        for group in groups:
            for question in group.get("questions", []):
                qid = question.get("question_id", "UNKNOWN")
                for label, key in (("question", "images"), ("answer", "answer_images")):
                    for rel in question.get(key, []):
                        path = (BASE / bank / rel).resolve()
                        if not path.exists():
                            missing.append((bank, qid, label, rel))

if missing:
    print("Missing/broken image references:")
    for bank, qid, label, rel in missing:
        print(f"  {bank}: {qid} ({label}) -> {rel}")
else:
    print("All referenced images are present.")
