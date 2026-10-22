"""Turn dataset images into a JSON file for the local mode of validate.html (e.g. the pending label-audit items).

    python webapp/tools/make_validation_set.py --ids w000051 w002900 ...            # chosen ids
    python webapp/tools/make_validation_set.py --audit-pending                      # pending audit items
Output: runs/validation_set.json  (contains dataset images: keep private until the dataset is released)
"""
import argparse
import base64
import csv
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
REL = os.path.join(ROOT, 'release', 'kyrgyz_handwriting_v1.1')

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument('--ids', nargs='*', default=[])
ap.add_argument('--audit-pending', action='store_true')
ap.add_argument('--out', default=os.path.join(ROOT, 'runs', 'validation_set.json'))
args = ap.parse_args()
labels = {r['id']: r for r in csv.DictReader(open(os.path.join(REL, 'words', 'labels.csv'), encoding='utf-8'))}
ids, model = list(args.ids), {}
if args.audit_pending:
    for r in csv.DictReader(open(os.path.join(REL, 'metadata', 'label_audit_v1.0_reviewed.csv'), encoding='utf-8')):
        if r['review_status'] == 'pending review':
            ids.append(r['id'])
            model[r['id']] = r['recognised']
items = []
for i in ids:
    r = labels[i]
    png = base64.b64encode(open(os.path.join(REL, 'words', r['file']), 'rb').read()).decode()
    items.append(dict(id=i, png='data:image/png;base64,' + png, text=r['text'], prompt_text=r['text_punct'],
                      model_reading=model.get(i), source_file=r['source_file'], collection=r['collection']))
json.dump(items, open(args.out, 'w', encoding='utf-8'), ensure_ascii=False)
print(f'{len(items)} items -> {args.out}')
