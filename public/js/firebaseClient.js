import { initializeApp } from 'firebase/app';
import {
  getDatabase,
  ref,
  set,
  get,
  onValue,
  remove,
  onDisconnect,
  push,
  update,
  off,
} from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyCkp2BFQv07PZeFYWiPGAkvOkFcca9SLsU",
  authDomain: "voxel-island-37b21.firebaseapp.com",
  databaseURL: "https://voxel-island-37b21-default-rtdb.firebaseio.com",
  projectId: "voxel-island-37b21",
  storageBucket: "voxel-island-37b21.firebasestorage.app",
  messagingSenderId: "998417717594",
  appId: "1:998417717594:web:6ed66369c9824188457b63",
  measurementId: "G-EJSP0Z18EC"
};

let db = null;
try {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
} catch (err) {
  console.warn('Firebase initialization fallback (using local simulation):', err);
}

export { db, ref, set, get, onValue, remove, onDisconnect, push, update, off };
