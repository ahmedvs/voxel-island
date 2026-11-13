// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
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

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { app, db };
