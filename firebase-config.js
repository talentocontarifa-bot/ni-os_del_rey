// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, onSnapshot, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// Tu configuración de Firebase irá aquí
// Necesitarás reemplazar esto con las credenciales de tu proyecto final.
const firebaseConfig = {
    apiKey: "AIzaSyDrQ3VCBaEmEAbrUk1JVIJuQN7qo12sQSY",
    authDomain: "desarrollopersonal-75769.firebaseapp.com",
    projectId: "desarrollopersonal-75769",
    storageBucket: "desarrollopersonal-75769.firebasestorage.app",
    messagingSenderId: "855094842857",
    appId: "1:855094842857:web:1340fb0500afd16f45e778",
    measurementId: "G-G6E682K70P"
};

// Inicializar Apps
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app);

export { db, storage, auth, collection, addDoc, getDocs, onSnapshot, doc, updateDoc, ref, uploadBytesResumable, getDownloadURL };
