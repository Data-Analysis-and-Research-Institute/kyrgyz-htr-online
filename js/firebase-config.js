/* Data-collection settings. Paste your Firebase web-app config below (Firebase console ->
 * Project settings -> Your apps -> Web app -> "SDK setup and configuration" -> Config).
 * While FIREBASE_CONFIG is null the collection page runs in DEMO MODE: nothing is uploaded and
 * contributors can download their samples as a JSON file instead. See webapp/README.md. */
window.FIREBASE_CONFIG = null;
/* example:
window.FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  appId: "1:1234567890:web:abcdef"
};
*/

window.COLLECTION_SETTINGS = {
  consentVersion: '2026-10-v1',      // bump when the consent text changes
  sessionTarget: 40,                 // suggested words per session
  contactEmail: 'risaev@paragoniu.edu.kh',    // contact for questions / withdrawal requests
  licence: 'TODO: e.g. CC BY-NC-SA 4.0',      // TODO: licence the collected data will be released under
  project: 'Kyrgyz Handwritten Words (Burul Shambetova et al.)',
};
