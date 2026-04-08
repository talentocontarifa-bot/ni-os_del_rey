import { db, storage, collection, addDoc, ref, uploadBytesResumable, getDownloadURL, onSnapshot } from './firebase-config.js';

document.addEventListener('DOMContentLoaded', () => {
    // Navigation Logic
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            views.forEach(view => view.classList.remove('active'));
            const targetId = item.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');
        });
    });

    // Photo Upload Preview Logic
    const photoPreview = document.getElementById('photo-preview');
    const photoInput = document.getElementById('kid-photo');

    photoPreview.addEventListener('click', () => {
        photoInput.click();
    });

    photoInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = function(e) {
                photoPreview.style.backgroundImage = `url(${e.target.result})`;
                photoPreview.innerHTML = ''; // remove icon and text
            }
            reader.readAsDataURL(e.target.files[0]);
        }
    });

    // Forms and Modals
    const form = document.getElementById('registro-form');
    const modal = document.getElementById('id-card-modal');
    const closeBtn = document.querySelector('.close-modal');
    const idCardPreview = document.getElementById('id-card-preview');
    const directoryList = document.querySelector('.directory-list');

    // === 1. LÓGICA DE REGISTRO (CON FIREBASE) ===
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
        submitBtn.disabled = true;

        try {
            // Recolectar datos
            const fullName = form.querySelector('input[placeholder="Ej. Juan Pérez"]').value;
            const birthDate = form.querySelector('input[type="date"]').value;
            const gender = form.querySelector('input[name="gender"]:checked').value;
            const tutorName = form.querySelector('input[placeholder="Ej. María López"]').value || "";
            const phone = form.querySelector('input[type="tel"]').value || "";
            const allergies = form.querySelectorAll('textarea')[0].value || "";
            const notes = form.querySelectorAll('textarea')[1].value || "";

            let photoUrl = null;
            const file = photoInput.files[0];

            // Subir imagen a Firebase Storage si existe
            if (file) {
                const fileRef = ref(storage, `niños/${Date.now()}_${file.name}`);
                const snapshot = await uploadBytesResumable(fileRef, file);
                photoUrl = await getDownloadURL(snapshot.ref);
            }

            // Guardar documento en Firestore
            await addDoc(collection(db, "ninos"), {
                nombreCompleto: fullName,
                fechaNacimiento: birthDate,
                genero: gender,
                tutor: tutorName,
                telefono: phone,
                alergias: allergies,
                notasEspeciales: notes,
                foto: photoUrl, // Null o URL de Firebase
                fechaRegistro: new Date()
            });

            alert(`¡Registro insertado en Firebase con éxito para ${fullName}!`);
            
            // Limpiar formulario local
            form.reset();
            photoPreview.style.backgroundImage = 'none';
            photoPreview.innerHTML = '<i class="fa-solid fa-camera"></i><span>Agregar Foto</span>';

        } catch (error) {
            console.error("Error guardando documento Firebase: ", error);
            alert("Error al guardar: ¿Ya pusiste tus llaves de Firebase en firebase-config.js?");
        } finally {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    });

    // === 2. LÓGICA DE LECTURA (DIRECTORIO EN TIEMPO REAL CON FIREBASE) ===
    let isFirstLoad = true;
    
    onSnapshot(collection(db, "ninos"), (snapshot) => {
        if (isFirstLoad && !snapshot.empty) {
            // Limpiar los divs estáticos de prueba de la maqueta
            directoryList.innerHTML = ''; 
            isFirstLoad = false;
        }

        snapshot.docChanges().forEach((change) => {
            if (change.type === "added" || change.type === "modified") {
                const child = change.doc.data();
                
                // Calcular edad aproximada (solo año)
                const birthYear = new Date(child.fechaNacimiento).getFullYear();
                const currentYear = new Date().getFullYear();
                let age = currentYear - birthYear;
                if(isNaN(age)) age = "?";
                
                let level = age < 6 ? "Kinder" : "Primaria";
                // Si no hay foto en Firebase, usamos Avatar de Dado (DiceBear)
                let avatarUrl = child.foto ? child.foto : `https://api.dicebear.com/7.x/fun-emoji/svg?seed=${child.nombreCompleto}`;
                let colorBar = child.genero === 'boy' ? '#81D4FA' : '#F48FB1';

                const cardHtml = `
                    <div class="kid-card sketchy-box" data-id="${change.doc.id}">
                        <div class="kid-card-color-bar" style="background-color: ${colorBar};"></div>
                        <img src="${avatarUrl}" alt="${child.nombreCompleto}" class="kid-avatar sketchy-box" style="object-fit:cover;">
                        <div class="kid-info">
                            <h4>${child.nombreCompleto}</h4>
                            <p><strong>${age}</strong> años <span class="dot"></span> Nivel: <strong>${level}</strong></p>
                        </div>
                        <button class="btn btn-sm btn-blue btn-tarjeta"><i class="fa-solid fa-scroll"></i> Tarjeta</button>
                    </div>
                `;

                if (change.type === "added") {
                    directoryList.insertAdjacentHTML('beforeend', cardHtml);
                } else {
                    const existingCard = directoryList.querySelector(`.kid-card[data-id="${change.doc.id}"]`);
                    if (existingCard) existingCard.outerHTML = cardHtml;
                }
            }
            if (change.type === "removed") {
                const existingCard = directoryList.querySelector(`.kid-card[data-id="${change.doc.id}"]`);
                if (existingCard) existingCard.remove();
            }
        });

        attachModalEvents();
    }, (error) => {
        console.warn("Firebase no conectado o sin llaves, mostrando directorio dummy.");
        attachModalEvents(); // Asegura que los botones del mockup funcionen
    });

    // === 3. LÓGICA DE TARJETAS (MODAL) ===
    function attachModalEvents() {
        document.querySelectorAll('.btn-tarjeta').forEach(btn => {
            // Evitar eventos duplicados reemplazando el botón
            const clone = btn.cloneNode(true);
            btn.parentNode.replaceChild(clone, btn);
            
            clone.addEventListener('click', (e) => {
                const card = e.target.closest('.kid-card');
                const name = card.querySelector('h4').textContent;
                const imgSrc = card.querySelector('.kid-avatar').src;
                const details = card.querySelector('p').innerHTML;

                idCardPreview.innerHTML = `
                    <h2>Iglesia Niños del Rey</h2>
                    <img src="${imgSrc}" alt="${name}">
                    <h3>${name}</h3>
                    <p>${details}</p>
                    <div style="margin-top: 15px; border-top: 2px dashed #ccc; padding-top:10px;">
                        <small>Contacto de Emergencia en reverso</small>
                    </div>
                `;
                modal.classList.add('active');
            });
        });
    }

    // Modal Close Triggers
    closeBtn.addEventListener('click', () => modal.classList.remove('active'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
});
