# Kyrgyz handwriting recognition — web app (GitHub Pages)

A static website with four pages:

* **`index.html` — Recognize.** Write a Kyrgyz word on the canvas (pen / brush / ink) or upload a photo
  (optional crop), or click one of 12 **example photos**; a CTC recogniser runs **in the browser**
  (onnxruntime-web) and a 100k-word Kyrgyz word list re-scores its candidates. The **word-list correction
  switch** shows the model's own reading instead (no letter substitution, no corpus words). Nothing
  leaves the device.
* **`page.html` — Page.** A photo of a handwritten page (or several lines written on a large canvas) is
  straightened, ruled lines and specks are removed, text lines are traced (they may curve), each line is cut
  into words at the wide gaps, and every word is read by the same recogniser. Shows the boxes on the page,
  an editable transcript and, on click, the alternatives for a word. Runs in the browser, nothing is uploaded.
* **`collect.html` — Contribute.** Consent form in **Kyrgyz, Russian and English** (switch at the top,
  or link directly with `collect.html?lang=ky|ru|en`), then one prompt at a time from the "most confused words"
  list (`prompts/collection_prompts.json`). Each sample is stored in **Firebase Firestore**: the rendered
  PNG, raw strokes (x, y, t, pressure, width), brush style, prompt, what was written and the model's
  reading. Without a Firebase config it runs in **demo mode** (local JSON download, nothing uploaded).
* **`validate.html` — Validate.** Anyone signed in with Google can review collected samples (no approval step).
  Every sample needs **at least 2 agreeing votes**; the queue serves samples waiting for a second vote first,
  then disputed ones, then new ones (model/label disagreements first). Validators see how many votes a sample
  has, not what they were. Keys: **1** correct, **2** wrong label
  (type the correct text), **3** illegible, **4** not Kyrgyz / scribble, **5** personal information, **S** skip;
  stroke replay with **R**. Reviews are stored as `reviews/{submission}_{validator}`. It also works on a
  **local JSON file** (a demo-mode download from `collect.html` or a file from `tools/make_validation_set.py`)
  and then downloads the reviews as JSON.

## Accuracy

Model: CNN-BiLSTM-CTC (4.4 M parameters, `model/kyrgyz_ctc_lstm.onnx`, 17.5 MB), trained on the
Kyrgyz Handwritten Words dataset v1.1, + lexicon re-scoring (`model/lexicon.tsv`, 100,571 words, word
probabilities mixing the general corpus with in-domain frequencies; words from the training labels that
may be personal names — capitalised and absent from the public corpus — are left out of the published list).

| on the dataset's test split (918 images) | CER | words correct |
|---|---|---|
| this web app (one model + word list) | 4.3 % | 87.9 % |
| model alone (greedy) | 6.3 % | 77.3 % |
| full offline system (6 CTC models + TrOCR + corpus; too big for a browser) | 2.85 % | 91.7 % |

Full pages (`page.html`; Python reference `page_htr.py` + `page_seg2.py` in the research project): on 9
photographed essay pages that could be aligned with their transcripts (887 words) **22.9 % word errors,
5.8 % character errors**. This is optimistic: the essays' words also occur in the training data. Most errors
come from words that touch, or whose tails run into the next line. The JavaScript segmentation gives the
same lines and words as the Python reference on the same image.

Canvas writing (mouse/finger) looks different from the pen-on-paper photos the model was trained on,
so expect lower accuracy on drawn words until canvas data from `collect.html` is added to training.

Verification done before release: ONNX vs PyTorch outputs (max diff 1e-5); JavaScript preprocessing vs
the Python mirror (`tools/web_pipeline.py`, ≤ 2 grey levels); decoder.js vs the Python mirror (15/15
identical); end-to-end in headless Microsoft Edge (model loading, recognition of dataset images, all
brushes; `tests/collect_flow.html`: consent → draw → submit in demo mode). The Firebase upload path
needs your project and was not tested here. The image-based browser test is kept out of this public
repository because it uses images from the not-yet-released dataset.

## Run locally

```
cd webapp
python -m http.server 8000      # then open http://localhost:8000
```
(Opening the HTML files directly from disk does not work: the model is loaded with `fetch`.)

## Deploy on GitHub Pages

1. Create a repository and copy the **contents** of `webapp/` to its root (or to a `docs/` folder).
   `tests/` is optional. All files are below GitHub's 100 MB limit (largest: the 17.5 MB model).
2. Commit and push. In the repository: **Settings → Pages → Build and deployment → Deploy from a branch**,
   branch `main`, folder `/ (root)` (or `/docs`).
3. The site appears at `https://<user>.github.io/<repo>/` after a minute. `.nojekyll` is included so
   GitHub serves all files as they are.

## Set up Firebase (data collection)

1. <https://console.firebase.google.com> → **Add project** (the free *Spark* plan is enough:
   only Firestore and Authentication are used, images are stored inside Firestore documents).
2. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable.**
3. **Authentication → Settings → Authorized domains → Add domain:** `<user>.github.io`.
4. **Build → Firestore Database → Create database** (production mode, a region near your contributors).
5. **Firestore → Rules:** paste `firebase/firestore.rules` and publish. Contributors can only *create*
   their own consent record and samples; nobody can read data from the browser.
6. **Project settings → Your apps → Add app → Web** → copy the `firebaseConfig` object into
   `js/firebase-config.js` (`window.FIREBASE_CONFIG = {...}`). These keys are not secret; access is
   controlled by the rules above.
7. Fill in `js/firebase-config.js → COLLECTION_SETTINGS`: contact e-mail, licence, consent version.
8. Recommended against abuse: enable **App Check** (reCAPTCHA) for Firestore and set a **budget alert**.

### Validators (`validate.html`)

1. **Authentication → Sign-in method → Google → Enable** (anonymous sign-in stays on for contributors).
2. Publish the current `firebase/firestore.rules`: any Google-signed-in user may read samples and votes and
   cast one vote per sample (`reviews/{submission}_{uid}`); anonymous contributor accounts cannot read anything.
3. `tools/export_firebase.py` turns the votes into `review_status` / `final_text` in `labels.csv`:
   `accepted` (≥ 2 agreeing *correct* votes, or ≥ 2 *wrong label* votes with the same corrected text, and a
   majority), `rejected` (≥ 2 *illegible / not Kyrgyz*), `disputed` (≥ 2 votes, no agreement — stays in the
   queue), `pending` (1 vote), `unreviewed`, and `excluded_pii` (a single *personal information* flag is enough,
   and the sample leaves the queue). Train only on `accepted`.

To review samples offline: `python webapp/tools/make_validation_set.py --help` builds a local JSON queue
(open it in `validate.html` → *Open a local JSON file*). Such files may contain dataset images: keep them private.

Export the collected data (admin side, needs a service-account key — never commit it):
```
pip install firebase-admin
python webapp/tools/export_firebase.py --key service-account.json --out collected/
```
This writes `images/*.png`, `strokes/*.json`, `labels.csv` and `writers.csv`. Split by **writer** when
training (all samples of a writer in the same split).

## Before collecting real data — TODO

* The Kyrgyz and Russian consent texts in `collect.html` are translations of the English text: have them
  reviewed by native speakers and by your institution's ethics process.
* Licence of the collected data: MIT; contact: ruslan.isaev@alatoo.edu.kg (both in `js/firebase-config.js`).
* Firebase project `kyrgyz-htr-data-collection` is configured in `js/firebase-config.js`; complete steps 2–5
  and 8 of the Firebase setup above (Anonymous sign-in, authorized domain, Firestore + rules, App Check).
* Validation: enable the Google sign-in provider and publish the updated rules.
* Decide whether contributors' optional answers (age range, writing hand, first language) are needed.

## Files

```
index.html, page.html, collect.html, validate.html, css/style.css
js/preprocess.js     image -> 64-px ink map (port of the training preprocessing)
js/decoder.js        CTC greedy / prefix beam / forward algorithm + lexicon re-scoring
js/recognizer.js     onnxruntime-web session, ties preprocessing + model + decoder together
js/brush.js          canvas brush engine: pen, calligraphic brush (bold, sharp edges), ink with diffusion
js/app.js            recognition page;  js/collect.js  collection page (Firebase or demo mode)
js/page.js           page segmentation (deskew, line paths, words);  js/page-app.js  page UI
js/validate.js       validation page (Firebase or local file)
js/firebase-config.js  your Firebase config + collection settings
model/               ONNX model, charset, decoder settings, lexicon
prompts/             collection prompts (from make_collection_list.py)
firebase/firestore.rules
tools/               web_pipeline.py (Python mirror), build_web_assets.py (need the full research project to run),
                     export_firebase.py (standalone; merges validator reviews), make_validation_set.py
examples/            12 example photos of handwritten words (examples.json: file, expected text, print/cursive)
tests/               headless browser tests: collection flow (demo mode), examples + word-list switch
                     (the validation and page tests use unreleased images and are kept out of this repository)
```
Rebuild the model assets after retraining: export the ONNX model (see the project notes) and run
`python webapp/tools/build_web_assets.py --min-count 30` from the project root.

## Licence

MIT — see `LICENSE`. This covers the code, the model files and the data collected with this site.
