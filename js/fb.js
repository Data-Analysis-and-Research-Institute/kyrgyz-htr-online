/* Firebase helpers shared by the collection, validation and admin pages.
 * Everyone signs in with Google. The user's name and e-mail go to profiles/{uid} only (readable by admins, never
 * exported with the dataset); samples and votes carry the uid. */
export const FB_VERSION = '10.12.2';
const CDN = `https://www.gstatic.com/firebasejs/${FB_VERSION}`;
let loading = null;

/* Load the SDK once (call early, so the sign-in popup can open straight from the click) */
export function loadFirebase() {
  if (!window.FIREBASE_CONFIG) return Promise.resolve(null);
  loading = loading || Promise.all([import(`${CDN}/firebase-app.js`), import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`)]).then(([app, auth, fs]) => {
    const a = app.initializeApp(window.FIREBASE_CONFIG);
    return { app: a, authMod: auth, auth: auth.getAuth(a), fs, db: fs.getFirestore(a) };
  });
  return loading;
}

/* The signed-in user from an earlier visit (or null), without a popup */
export async function currentUser() {
  const f = await loadFirebase();
  if (!f) return null;
  await f.auth.authStateReady();
  return f.auth.currentUser;
}

/* Sign in with Google (popup unless already signed in) and refresh the private profile.
   Returns {db, fs, auth, user, uid} or null without a Firebase config. */
export async function signIn() {
  const f = await loadFirebase();
  if (!f) return null;
  await f.auth.authStateReady();
  let user = f.auth.currentUser;
  if (!user || user.isAnonymous) user = (await f.authMod.signInWithPopup(f.auth, new f.authMod.GoogleAuthProvider())).user;
  await f.fs.setDoc(f.fs.doc(f.db, 'profiles', user.uid),
    { email: user.email || '', name: user.displayName || '', last_seen: f.fs.serverTimestamp() }, { merge: true });
  return { ...f, user, uid: user.uid };
}

export async function signOut() {
  const f = await loadFirebase();
  if (f) await f.authMod.signOut(f.auth);
}
