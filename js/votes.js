/* Validation votes -> decision. Mirrored in tools/export_firebase.py (final_label).
 * A sample is decided by >= 2 agreeing votes that are also a majority; one personal-information flag excludes it. */
export const norm = (t) => (t || '').toUpperCase().replace(/[^\p{L}\p{N}\- ]/gu, '').trim();

/* revs: [{verdict, corrected_text}], text: the writer's label.
   Returns {status, final}: status in unreviewed | excluded_pii | pending | accepted | rejected | disputed */
export function decide(revs, text = '') {
  const n = revs.length, c = (v) => revs.filter((r) => r.verdict === v).length;
  if (!n) return { status: 'unreviewed', final: '' };
  if (c('personal_info')) return { status: 'excluded_pii', final: '' };
  if (n < 2) return { status: 'pending', final: '' };
  if (c('correct') >= 2 && c('correct') > n / 2) return { status: 'accepted', final: text };
  const fixes = {};
  for (const r of revs) if (r.verdict === 'wrong_label') { const k = norm(r.corrected_text); fixes[k] = (fixes[k] || 0) + 1; }
  for (const [k, m] of Object.entries(fixes)) {
    if (m >= 2 && m > n / 2) return { status: 'accepted', final: revs.find((r) => r.verdict === 'wrong_label' && norm(r.corrected_text) === k).corrected_text };
  }
  const bad = c('illegible') + c('not_kyrgyz');
  if (bad >= 2 && bad > n / 2) return { status: 'rejected', final: '' };
  return { status: 'disputed', final: '' };
}

export const voteStatus = (revs) => decide(revs).status;

/* Did this vote agree with the decision? (null while undecided) */
export function agreed(vote, d, text) {
  if (d.status === 'accepted') {
    return norm(d.final) === norm(text) ? vote.verdict === 'correct'
      : vote.verdict === 'wrong_label' && norm(vote.corrected_text) === norm(d.final);
  }
  if (d.status === 'rejected') return vote.verdict === 'illegible' || vote.verdict === 'not_kyrgyz';
  if (d.status === 'excluded_pii') return vote.verdict === 'personal_info';
  return null;
}
