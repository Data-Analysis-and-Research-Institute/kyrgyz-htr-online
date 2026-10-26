// In-memory stand-in for firebase-auth. State: globalThis.__MOCK = {user, popupUser, popups}.
const M = () => globalThis.__MOCK;
const auth = {
  get currentUser() { return M().user; },
  authStateReady: async () => {},
};
export function getAuth() { return auth; }
export class GoogleAuthProvider {}
export async function signInWithPopup() {
  M().popups = (M().popups || 0) + 1;
  M().user = M().popupUser;
  return { user: M().user };
}
export async function signOut() { M().user = null; }
