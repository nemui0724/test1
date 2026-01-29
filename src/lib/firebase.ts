import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

let _analyticsPromise: Promise<import("firebase/analytics").Analytics | null> | null = null;

export function getAnalyticsClient() {
  if (_analyticsPromise) return _analyticsPromise;
  if (typeof window === "undefined") {
    _analyticsPromise = Promise.resolve(null);
    return _analyticsPromise;
  }
  _analyticsPromise = (async () => {
    const { isSupported, getAnalytics } = await import("firebase/analytics");
    const ok = await isSupported().catch(() => false);
    return ok ? getAnalytics(app) : null;
  })();
  return _analyticsPromise;
}
