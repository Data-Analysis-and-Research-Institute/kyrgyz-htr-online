"""Build the browser lexicon + decoder settings and report the expected accuracy of the web recogniser.

Mirrors webapp/js/decoder.js: candidates = greedy + prefix beam + lexicon words within edit distance 2
of the 3 best readings; score = CTC log-lik + nu * log P(word) + beta * length (unknown word: gamma).
P(word) = a * P_train + b * P_literary + (1 - a - b) * P_corpus  (domain mix, as in ctc_ensemble.py).

Usage (from the project root):
    python webapp/tools/build_web_assets.py [--min-count 10]
"""
import argparse
import csv
import json
import math
import os
import sys
from collections import Counter

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, ROOT)
import ctc_ensemble as E  # noqa: E402
import kyrgyz_ctc as C  # noqa: E402
import postcorrect as pc  # noqa: E402

WEB = os.path.join(ROOT, 'webapp')
MIX_A, MIX_B = 0.05, 0.10  # train-label / literary weights tuned for the v1.1 ensemble


def read_counts(path, min_count):
    out = {}
    for line in open(path, encoding='utf-8'):
        w, k = line.rstrip('\n').split('\t')
        if int(k) >= min_count:
            out[w.upper()] = int(k)
    return out


def build_lexicon(min_count, train_texts):
    corp = read_counts(os.path.join(ROOT, 'corpus', 'kyrgyz_words.tsv'), min_count)
    lit = read_counts(os.path.join(ROOT, 'corpus', 'kyrgyz_words_literary.tsv'), 2)
    train = Counter(w for t in train_texts for w in pc.TOKEN_RE.findall(t))
    tc, tl, tt = sum(corp.values()), sum(lit.values()), sum(train.values())
    # The lexicon is published: drop training-label words that may be personal names, i.e. words that are
    # not in the corpus and were written capitalised (names / surnames in application letters), plus the
    # dataset's PII review candidates. Public names that occur in the news corpus are unaffected.
    raw = [r['text'] for r in csv.DictReader(open(os.path.join(ROOT, 'release', 'kyrgyz_handwriting_v1.1', 'words',
                                                                 'labels.csv'), encoding='utf-8')) if r['split'] == 'train']
    capitalised = {w.upper() for t in raw for w in pc.TOKEN_RE.findall(t) if w[:1].isupper()}
    pii = {w.upper() for r in csv.DictReader(open(os.path.join(ROOT, 'release', 'kyrgyz_handwriting_v1.1', 'metadata',
                                                               'pii_review_candidates.csv'), encoding='utf-8'))
           for w in pc.TOKEN_RE.findall(r['text'])}
    private = {w for w in train if w not in corp and w not in lit and (w in capitalised or w in pii)}
    print(f'lexicon: {len(private)} possible personal names from the training labels left out')
    logp = {}
    for w in (set(corp) | set(lit) | set(train)) - private:
        p = ((1 - MIX_A - MIX_B) * ((corp[w] + 0.5) / tc if w in corp else 0)
             + MIX_B * ((lit[w] + 0.5) / tl if w in lit else 0)
             + MIX_A * ((train[w] + 0.5) / tt if w in train else 0))
        logp[w] = round(math.log(p), 2)
    return logp


def features(lp, chars, lex_index, logp):
    """Candidates and their CTC log-likelihoods for one image (log-probs lp: (T, C))."""
    cs = C.Charset(chars)
    cands = list(dict.fromkeys([E.greedy(lp, chars)] + E.prefix_beam(lp, chars)))
    cands = [c for c in cands if c]
    sc = E.ctc_scores([lp[None]], cands, cs) if cands else np.zeros(0)
    top = [cands[k] for k in np.argsort(-sc)[:3]]
    var = set()
    for t in top:
        for m in pc.TOKEN_RE.finditer(t):
            for w in lex_index.candidates(m.group(1)):
                var.add(t[:m.start()] + w + t[m.end():])
    var -= set(cands)
    allc = cands + sorted(var)
    allsc = np.concatenate([sc, E.ctc_scores([lp[None]], sorted(var), cs)]) if var else sc
    keep = allsc > -1e3
    allc = [c for c, k in zip(allc, keep) if k]
    toks = [pc.TOKEN_RE.findall(c) for c in allc]
    known = np.array([sum(logp[w] for w in t if w in logp) for t in toks])
    unknown = np.array([sum(w not in logp for w in t) for t in toks], float)
    return dict(cands=allc, ctc=allsc[keep], known=known, unknown=unknown, length=np.array([len(c) for c in allc], float))


def pick(F, nu, beta, gamma):
    return [f['cands'][int(np.argmax(f['ctc'] + nu * (f['known'] + gamma * f['unknown']) + beta * f['length']))]
            if f['cands'] else '' for f in F]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--min-count', type=int, default=10)
    ap.add_argument('--model', default=os.path.join(ROOT, 'runs', 'ctc_v11', 'ft_s3.pt'))
    args = ap.parse_args()
    import web_pipeline as WP
    C.OUT_DIR = os.path.join(ROOT, 'runs', 'ctc_v11')
    model, cs = C.load_ctc(args.model)
    d = C.load_cache()
    texts, split = list(d['texts']), d['split']
    rows = [r for r in csv.DictReader(open(os.path.join(ROOT, 'release', 'kyrgyz_handwriting_v1.1', 'words', 'labels.csv'),
                                           encoding='utf-8')) if r['split'] in ('train', 'val', 'test')]
    train_texts = [t for t, s in zip(texts, split) if s == 0]
    logp = build_lexicon(args.min_count, train_texts)
    lex_index = pc.Lexicon.__new__(pc.Lexicon)  # SymSpell index over exactly the web lexicon
    lex_index.count, lex_index.total, lex_index.max_dist = {w: 1 for w in logp}, len(logp), 2
    from collections import defaultdict
    lex_index.index = defaultdict(list)
    for w in logp:
        for dl in pc.Lexicon._deletes(w, 2):
            lex_index.index[dl].append(w)

    # browser preprocessing -> model log-probs
    out = {}
    for sp, code in (('val', 1), ('test', 2)):
        idx = np.nonzero(split == code)[0]
        imgs = [(WP.preprocess(WP.load_rgba(os.path.join(ROOT, 'release', 'kyrgyz_handwriting_v1.1', 'words',
                                                           rows[i]['file']))) * 255).astype(np.uint8) for i in idx]
        lps = E.log_probs(model, imgs, E.TTA[:1], bs=1)  # one image at a time, like the browser (no padding)
        F = [features(lp[0], cs.chars, lex_index, logp) for lp in lps]
        out[sp] = (F, [texts[i] for i in idx], [E.greedy(lp[0], cs.chars) for lp in lps])
        print(f'{sp}: features for {len(F)} images', flush=True)

    grid = [(nu, beta, g) for nu in (0.25, 0.5, 0.75, 1.0, 1.5) for beta in (0, 0.5, 1, 2, 3) for g in (-8, -10, -12, -15, -20)]
    Fv, tv, _ = out['val']
    best = min(grid, key=lambda g: E.cer_of(pick(Fv, *g), tv))
    for sp in ('val', 'test'):
        F, t, gr = out[sp]
        p = pick(F, *best)
        print(f'{sp}: greedy CER {E.cer_of(gr, t):.2f}% words {np.mean([a == b for a, b in zip(gr, t)]) * 100:.1f}%  |  '
              f'+ lexicon CER {E.cer_of(p, t):.2f}% words {np.mean([a == b for a, b in zip(p, t)]) * 100:.1f}%')
    nu, beta, gamma = best
    print(f'lexicon words: {len(logp)} (corpus count >= {args.min_count}); tuned nu={nu} beta={beta} gamma={gamma}')

    os.makedirs(os.path.join(WEB, 'model'), exist_ok=True)
    lex_path = os.path.join(WEB, 'model', 'lexicon.tsv')
    with open(lex_path, 'w', encoding='utf-8', newline='\n') as f:
        for w, v in sorted(logp.items(), key=lambda kv: -kv[1]):
            f.write(f'{w}\t{v}\n')
    F, t, gr = out['test']
    p = pick(F, *best)
    json.dump(dict(nu=nu, beta=beta, gamma=gamma, lexicon_min_count=args.min_count, lexicon_words=len(logp),
                   domain_mix=dict(train=MIX_A, literary=MIX_B),
                   test=dict(greedy_cer=E.cer_of(gr, t), cer=E.cer_of(p, t),
                             word_acc=float(np.mean([a == b for a, b in zip(p, t)]) * 100))),
              open(os.path.join(WEB, 'model', 'decoder_config.json'), 'w'), indent=1)
    print(f'written {lex_path} ({os.path.getsize(lex_path) / 1e6:.1f} MB) and decoder_config.json')
    # a few log-prob arrays for testing decoder.js against this mirror
    np.savez(os.path.join(ROOT, 'runs', 'web_decoder_testcases.npz'),
             **{f'lp{k}': E.log_probs(model, [(WP.preprocess(WP.load_rgba(os.path.join(
                 ROOT, 'release', 'kyrgyz_handwriting_v1.1', 'words', rows[i]['file']))) * 255).astype(np.uint8)],
                 E.TTA[:1])[0][0] for k, i in enumerate(np.nonzero(split == 2)[0][:15])},
             expected=np.array(pick(F[:15], *best)))


if __name__ == '__main__':
    main()
    sys.stdout.flush()
    os._exit(0)
