import { db, storage, collection, addDoc, doc, updateDoc, ref, uploadBytesResumable, getDownloadURL, onSnapshot } from './firebase-config.js';

let currentEditId = null; // Variable global para rastrear si estamos editando
let kidsDataMap = {};     // Diccionario en memoria para acceder fácil a los datos de cada niño

document.addEventListener('DOMContentLoaded', () => {
    // === NAVEGACIÓN ===
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view');

    function switchView(targetId) {
        navItems.forEach(nav => {
            nav.classList.remove('active');
            if(nav.getAttribute('data-target') === targetId) nav.classList.add('active');
        });
        views.forEach(view => view.classList.remove('active'));
        document.getElementById(targetId).classList.add('active');
    }

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            switchView(item.getAttribute('data-target'));
        });
    });

    // === PREVISUALIZACIÓN DE FOTO ===
    const photoPreview = document.getElementById('photo-preview');
    const photoInput = document.getElementById('kid-photo');

    photoPreview.addEventListener('click', () => photoInput.click());

    photoInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = function(e) {
                photoPreview.style.backgroundImage = `url(${e.target.result})`;
                photoPreview.innerHTML = ''; 
            }
            reader.readAsDataURL(e.target.files[0]);
        }
    });

    // === FUNCIONES AUXILIARES (Cálculo de Edades y Grupos) ===
    function getAgeAndGroup(birthDateStr) {
        if(!birthDateStr) return { age: "?", group: "Sin Grupo" };
        
        const birthDate = new Date(birthDateStr);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        // Si el mes actual es menor al del cumple, o si es el mes pero el día no ha llegado, restamos un año
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        
        let group = "Mayores";
        if (age >= 0 && age <= 2) group = "Gpo 1";
        else if (age >= 3 && age <= 8) group = "Gpo 2";
        else if (age >= 9 && age <= 11) group = "Gpo 3";
        
        return { age, group };
    }

    // === 1. LÓGICA DE REGISTRO Y EDICIÓN (FIREBASE) ===
    const form = document.getElementById('registro-form');
    // Botón cancelar
    form.querySelector('.btn-orange').addEventListener('click', () => {
        form.reset();
        photoPreview.style.backgroundImage = 'none';
        photoPreview.innerHTML = '<i class="fa-solid fa-camera"></i><span>Agregar Foto</span>';
        currentEditId = null;
        form.querySelector('button[type="submit"]').innerHTML = 'Guardar Registro';
        document.querySelector('.purple-header h2').innerHTML = '<i class="fa-solid fa-child-reaching"></i> Registro de Nuevo Niño';
    });

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

            // Si hay un archivo nuevo seleccionado, subimos
            if (file) {
                const fileRef = ref(storage, `niños/${Date.now()}_${file.name}`);
                const snapshot = await uploadBytesResumable(fileRef, file);
                photoUrl = await getDownloadURL(snapshot.ref);
            }

            // Armamos el diccionario de actualización
            const dataToSave = {
                nombreCompleto: fullName,
                fechaNacimiento: birthDate,
                genero: gender,
                tutor: tutorName,
                telefono: phone,
                alergias: allergies,
                notasEspeciales: notes
            };

            // Solo actualizar/sobreescribir la url de la foto si subieron una foto nueva
            if(photoUrl) {
                dataToSave.foto = photoUrl;
            }

            if (currentEditId) {
                // MODO EDICIÓN
                dataToSave.fechaActualizacion = new Date();
                await updateDoc(doc(db, "ninos", currentEditId), dataToSave);
                alert(`¡Registro de ${fullName} actualizado con éxito!`);
            } else {
                // MODO NUEVO
                dataToSave.fechaRegistro = new Date();
                await addDoc(collection(db, "ninos"), dataToSave);
                alert(`¡Registro de ${fullName} guardado en la base de datos!`);
            }
            
            // Limpiar y resetear el formulario para volver a la normalidad
            form.querySelector('.btn-orange').click(); 

        } catch (error) {
            console.error("Error guardando documento Firebase: ", error);
            alert("Hubo un error al guardar o actualizar los datos.");
        } finally {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    });

    // === 2. DIRECTORIO EN TIEMPO REAL (FIREBASE) ===
    const directoryList = document.querySelector('.directory-list');
    let isFirstLoad = true;
    
    onSnapshot(collection(db, "ninos"), (snapshot) => {
        if (isFirstLoad && !snapshot.empty) {
            directoryList.innerHTML = ''; 
            isFirstLoad = false;
        }

        snapshot.docChanges().forEach((change) => {
            const childData = change.doc.data();
            kidsDataMap[change.doc.id] = childData; // Guardar copia local en memoria

            if (change.type === "added" || change.type === "modified") {
                const { age, group } = getAgeAndGroup(childData.fechaNacimiento);
                
                let avatarUrl = childData.foto ? childData.foto : `https://api.dicebear.com/7.x/fun-emoji/svg?seed=${childData.nombreCompleto.replace(/ /g, '')}`;
                let colorBar = childData.genero === 'boy' ? '#81D4FA' : '#F48FB1';

                const cardHtml = `
                    <div class="kid-card sketchy-box" data-id="${change.doc.id}">
                        <div class="kid-card-color-bar" style="background-color: ${colorBar};"></div>
                        <img src="${avatarUrl}" alt="${childData.nombreCompleto}" class="kid-avatar sketchy-box" style="object-fit:cover;">
                        <div class="kid-info">
                            <h4>${childData.nombreCompleto}</h4>
                            <p><strong>${age}</strong> años <span class="dot"></span> Clase: <strong>${group}</strong></p>
                        </div>
                        <div style="display:flex; flex-direction: column; gap: 5px;">
                            <button class="btn btn-sm btn-blue btn-tarjeta" style="width: 100%;"><i class="fa-solid fa-scroll"></i> Tarjeta</button>
                            <button class="btn btn-sm btn-orange btn-editar" style="width: 100%; background: #FFCC80; border-color: #EF6C00; color: #E65100; font-size:0.9rem;"><i class="fa-solid fa-pencil"></i> Editar</button>
                        </div>
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
                delete kidsDataMap[change.doc.id];
                const existingCard = directoryList.querySelector(`.kid-card[data-id="${change.doc.id}"]`);
                if (existingCard) existingCard.remove();
            }
        });

        attachCardEvents();
    }, (error) => {
        console.warn("Base de datos sin conexión activa, mostrando dummies.", error);
    });

    // === 3. EVENTOS DE LOS BOTONES DE LAS TARJETAS ===
    const modal = document.getElementById('id-card-modal');
    const idCardPreview = document.getElementById('id-card-preview');

    function attachCardEvents() {
        // Remover eventos previos (usando cloneNode) para no duplicar clicks cada que Firebase avisa
        document.querySelectorAll('.kid-card .btn').forEach(btn => {
            const clone = btn.cloneNode(true);
            btn.parentNode.replaceChild(clone, btn);
        });

        // RE-ATAR EVENTOS DE TARJETA (MODAL)
        document.querySelectorAll('.btn-tarjeta').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const card = e.target.closest('.kid-card');
                const id = card.getAttribute('data-id');
                const data = kidsDataMap[id];
                
                if(!data) return;
                const { age, group } = getAgeAndGroup(data.fechaNacimiento);
                const avatar = data.foto || `https://api.dicebear.com/7.x/fun-emoji/svg?seed=${data.nombreCompleto.replace(/ /g, '')}`;

                idCardPreview.innerHTML = `
                    <h2>Iglesia Niños del Rey</h2>
                    <img src="${avatar}" alt="${data.nombreCompleto}">
                    <h3>${data.nombreCompleto}</h3>
                    <p><strong>${age}</strong> años <span class="dot"></span> <strong>${group}</strong></p>
                    ${data.alergias ? `<p style="color:red; font-size:1rem; margin-top:5px;"><i class="fa-solid fa-triangle-exclamation"></i> Alergias: ${data.alergias}</p>` : ''}
                    <div style="margin-top: 15px; border-top: 2px dashed #ccc; padding-top:10px;">
                        <small>Contacto de Emergencia en reverso</small>
                    </div>
                `;
                modal.classList.add('active');
            });
        });

        // ATAR EVENTOS AL BOTÓN DE EDITAR
        document.querySelectorAll('.btn-editar').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const card = e.target.closest('.kid-card');
                const id = card.getAttribute('data-id');
                const data = kidsDataMap[id];
                
                if(!data) return;

                // Cambiar al modo de edición 
                currentEditId = id;
                document.querySelector('.purple-header h2').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Editando Registro';
                form.querySelector('button[type="submit"]').innerHTML = 'Actualizar Registro';

                // Llenar los inputs con la información en memoria
                form.querySelector('input[placeholder="Ej. Juan Pérez"]').value = data.nombreCompleto || "";
                form.querySelector('input[type="date"]').value = data.fechaNacimiento || "";
                
                // Mapear género a botones radiales
                if(data.genero === "boy" || data.genero === "girl") {
                    form.querySelector(`input[name="gender"][value="${data.genero}"]`).checked = true;
                }

                form.querySelector('input[placeholder="Ej. María López"]').value = data.tutor || "";
                form.querySelector('input[type="tel"]').value = data.telefono || "";
                form.querySelectorAll('textarea')[0].value = data.alergias || "";
                form.querySelectorAll('textarea')[1].value = data.notasEspeciales || "";

                // Previsualizar la foto actual si existe
                if(data.foto) {
                    photoPreview.style.backgroundImage = `url(${data.foto})`;
                    photoPreview.innerHTML = '';
                } else {
                    photoPreview.style.backgroundImage = 'none';
                    photoPreview.innerHTML = '<i class="fa-solid fa-camera"></i><span>Agregar Foto</span>';
                }

                // Finalmente ir a la vista del formulario
                switchView('view-registro');
                // Scroll arriba
                document.querySelector('.main-content').scrollTop = 0;
            });
        });
    }

    // Cerrar el Modal de la Identidad
    document.querySelector('.close-modal').addEventListener('click', () => modal.classList.remove('active'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
});
