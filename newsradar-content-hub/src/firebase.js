// firebase.js — Hub React (modular SDK v9+)
import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDJNH8pMnnbeIKq1JDT_J0FxgDgJyNw3PA",
  authDomain:        "newsradar-d433a.firebaseapp.com",
  projectId:         "newsradar-d433a",
  storageBucket:     "newsradar-d433a.firebasestorage.app",
  messagingSenderId: "596790701253",
  appId:             "1:596790701253:web:ee379604de30fab0d454ac"
}

const app = initializeApp(FIREBASE_CONFIG)
export const auth = getAuth(app)
export const db   = getFirestore(app)
export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

export async function caricaDatiUtente(uid) {
  try {
    const snap = await getDoc(doc(db, 'users', uid))
    if (snap.exists()) return snap.data()
    return null
  } catch (e) { console.warn('[Hub Firebase] carica:', e.message); return null }
}

export async function salvaDatiUtente(uid, dati) {
  try {
    await setDoc(doc(db, 'users', uid), { ...dati, hub_updatedAt: serverTimestamp() }, { merge: true })
  } catch (e) { console.warn('[Hub Firebase] salva:', e.message) }
}

export { onAuthStateChanged, signInWithPopup, signOut }