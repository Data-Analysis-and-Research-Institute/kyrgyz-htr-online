/* Data-collection settings. Paste your Firebase web-app config below (Firebase console ->
 * Project settings -> Your apps -> Web app -> "SDK setup and configuration" -> Config).
 * While FIREBASE_CONFIG is null the collection page runs in DEMO MODE: nothing is uploaded and
 * contributors can download their samples as a JSON file instead. See webapp/README.md. */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyB0UcIwQ_5EgdX1EFVGT-X94yit_2yWpMk",
  authDomain: "kyrgyz-htr-data-collection.firebaseapp.com",
  projectId: "kyrgyz-htr-data-collection",
  storageBucket: "kyrgyz-htr-data-collection.firebasestorage.app",
  messagingSenderId: "542004171067",
  appId: "1:542004171067:web:b12af5720439c9876a671e"
  // measurementId / Analytics deliberately not used: the consent text promises no IP-based identity
};
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
  contactEmail: 'ruslan.isaev@alatoo.edu.kg',  // contact for questions / withdrawal requests
  licence: 'MIT',                             // licence the collected data will be released under
  project: 'Kyrgyz Handwritten Words (Burul Shambetova et al.)',
};
