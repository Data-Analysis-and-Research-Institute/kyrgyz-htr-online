"""Export collected handwriting from Firestore into dataset format.

Needs the Firebase Admin SDK and a service-account key (Firebase console -> Project settings ->
Service accounts -> Generate new private key; keep it secret, never commit it):
    pip install firebase-admin
    python webapp/tools/export_firebase.py --key path/to/service-account.json --out collected/

Output:
    collected/images/<doc_id>.png      the rendered word (white background, cropped to the ink)
    collected/strokes/<doc_id>.json    raw strokes: [[x, y, t_ms, pressure, width], ...] per stroke + brush
    collected/labels.csv               id, file, text, prompt_id, ..., review_status, final_text, n_reviews, verdicts
    collected/writers.csv              pseudonymous writer id (Firebase uid) + optional answers from the consent form
The `profiles` collection (Google name + e-mail) is deliberately NOT exported: it must never be released.
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
    """Status from validator votes (one vote per validator; a decision needs >= 2 agreeing votes that are
    also a majority). Mirrored in js/validate.js (voteStatus).
    unreviewed    no vote yet
    excluded_pii  any vote flagged personal information (privacy first: one flag is enough)
    pending       one vote so far
    accepted      >= 2 'correct' votes, or >= 2 'wrong_label' votes agreeing on the corrected text
    rejected      >= 2 'illegible' / 'not_kyrgyz' votes
    disputed      >= 2 votes but no agreement yet (stays in the validation queue for more votes)"""
    v = Counter(r.get('verdict') for r in revs)
    fixes = Counter(norm(r.get('corrected_text')) for r in revs if r.get('verdict') == 'wrong_label')
    n = len(revs)
    base = dict(n_reviews=n, verdicts=';'.join(f'{k}:{c}' for k, c in sorted(v.items())))
    if not revs:
        return dict(base, review_status='unreviewed', final_text='')
    if v['personal_info']:
        return dict(base, review_status='excluded_pii', final_text='')
    if n < 2:
        return dict(base, review_status='pending', final_text='')
    if v['correct'] >= 2 and v['correct'] > n / 2:
        return dict(base, review_status='accepted', final_text=row.get('text', ''))
    if fixes:
        key, k = fixes.most_common(1)[0]
        if k >= 2 and k > n / 2:
            fixed = next(r['corrected_text'] for r in revs if norm(r.get('corrected_text')) == key)
            return dict(base, review_status='accepted', final_text=fixed)
    bad = v['illegible'] + v['not_kyrgyz']
    if bad >= 2 and bad > n / 2:
        return dict(base, review_status='rejected', final_text='')
    return dict(base, review_status='disputed', final_text='')


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
                         pointer=s.get('pointer_type', ''), input_device=s.get('input_device', ''),
                         model_reading=s.get('model_reading') or '',
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
