"""Export collected handwriting from Firestore into dataset format.

Needs the Firebase Admin SDK and a service-account key (Firebase console -> Project settings ->
Service accounts -> Generate new private key; keep it secret, never commit it):
    pip install firebase-admin
    python webapp/tools/export_firebase.py --key path/to/service-account.json --out collected/

Output:
    collected/images/<doc_id>.png      the rendered word (white background, cropped to the ink)
    collected/strokes/<doc_id>.json    raw strokes: [[x, y, t_ms, pressure, width], ...] per stroke + brush
    collected/labels.csv               id, file, text, prompt_id, ..., review_status, final_text, n_reviews, verdicts
    collected/writers.csv              anonymous writer id + optional answers from the consent form
Split by writer (not by image) when you train: samples of one writer must stay in one split.
"""
import argparse
import base64
import csv
import json
import os
import re
from collections import Counter, defaultdict


def norm(t):
    return re.sub(r'[^\w\- ]', '', (t or '').upper()).strip()


def final_label(row, revs):
    """Status from validator reviews:
    excluded_pii  any reviewer flagged personal information
    accepted      >= 2 'correct' reviews (or 1 'correct' and the model read the same text), or
                  >= 2 'wrong_label' reviews that agree on the corrected text
    rejected      majority 'illegible' / 'not_kyrgyz'
    needs_review  reviewers disagree;  unreviewed  no review yet"""
    v = Counter(r.get('verdict') for r in revs)
    fixes = Counter(norm(r.get('corrected_text')) for r in revs if r.get('verdict') == 'wrong_label')
    base = dict(n_reviews=len(revs), verdicts=';'.join(f'{k}:{n}' for k, n in sorted(v.items())))
    if not revs:
        return dict(base, review_status='unreviewed', final_text='')
    if v['personal_info']:
        return dict(base, review_status='excluded_pii', final_text='')
    model_agrees = norm(row.get('model_reading')) == norm(row.get('text'))
    if v['correct'] >= 2 or (v['correct'] == 1 and len(revs) == 1 and model_agrees):
        return dict(base, review_status='accepted', final_text=row.get('text', ''))
    if fixes and fixes.most_common(1)[0][1] >= 2:
        fixed = next(r['corrected_text'] for r in revs if norm(r.get('corrected_text')) == fixes.most_common(1)[0][0])
        return dict(base, review_status='accepted', final_text=fixed)
    if v['illegible'] + v['not_kyrgyz'] > len(revs) / 2:
        return dict(base, review_status='rejected', final_text='')
    return dict(base, review_status='needs_review', final_text='')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--key', required=True, help='service-account JSON file')
    ap.add_argument('--out', default='collected')
    args = ap.parse_args()
    import firebase_admin
    from firebase_admin import credentials, firestore
    firebase_admin.initialize_app(credentials.Certificate(args.key))
    db = firestore.client()
    for d in ('images', 'strokes'):
        os.makedirs(os.path.join(args.out, d), exist_ok=True)

    rows = []
    for doc in db.collection('submissions').stream():
        s = doc.to_dict()
        png = s.get('png', '')
        if not png.startswith('data:image/png;base64,'):
            continue
        with open(os.path.join(args.out, 'images', doc.id + '.png'), 'wb') as f:
            f.write(base64.b64decode(png.split(',', 1)[1]))
        with open(os.path.join(args.out, 'strokes', doc.id + '.json'), 'w', encoding='utf-8') as f:
            f.write(s.get('strokes', '{}'))
        brush = s.get('brush') or {}
        created = s.get('created_at')
        rows.append(dict(id=doc.id, file=f'images/{doc.id}.png', text=s.get('text', ''),
                         prompt_id=s.get('prompt_id', ''), prompt_text=s.get('prompt_text', ''),
                         text_changed=s.get('text_changed', False), writer_id=s.get('writer_id', ''),
                         session_id=s.get('session_id', ''), category=s.get('category', ''),
                         brush=brush.get('preset', ''), brush_color=brush.get('color', ''),
                         pointer=s.get('pointer_type', ''), model_reading=s.get('model_reading') or '',
                         model_prob=s.get('model_prob') or '', width=s.get('image_w', ''), height=s.get('image_h', ''),
                         created_at=created.isoformat() if hasattr(created, 'isoformat') else str(created or '')))
    # merge validator reviews (reviews/{submission}_{validator}) into a final status and label
    reviews = defaultdict(list)
    for d in db.collection('reviews').stream():
        r = d.to_dict()
        reviews[r.get('submission_id')].append(r)
    for row in rows:
        row.update(final_label(row, reviews.get(row['id'], [])))
    rows.sort(key=lambda r: r['created_at'])
    with open(os.path.join(args.out, 'labels.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]) if rows else ['id'])
        w.writeheader()
        w.writerows(rows)

    writers = [dict(writer_id=d.id, **{k: v for k, v in d.to_dict().items() if k != 'agreed_at'})
               for d in db.collection('consents').stream()]
    with open(os.path.join(args.out, 'writers.csv'), 'w', newline='', encoding='utf-8') as f:
        keys = sorted({k for r in writers for k in r}) or ['writer_id']
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        w.writerows(writers)
    print(f'exported {len(rows)} samples from {len({r["writer_id"] for r in rows})} writers to {args.out}')


if __name__ == '__main__':
    main()
