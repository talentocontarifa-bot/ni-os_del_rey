import { db, storage, collection, addDoc, doc, updateDoc, ref, uploadBytesResumable, getDownloadURL, onSnapshot } from './firebase-config.js';

let currentEditId = null; // Variable global para rastrear si estamos editando
let kidsDataMap = {};     // Diccionario en memoria para acceder fácil a los datos de cada niño

// Función Auxiliar Global
function getAgeAndGroup(birthDateStr) {
    if(!birthDateStr) return { age: "?", group: "Sin Grupo" };
    
    const birthDate = new Date(birthDateStr);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    // Ajuste estricto
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    
    let group = "Mayores";
    if (age >= 0 && age <= 2) group = "Gpo 1";
    else if (age >= 3 && age <= 8) group = "Gpo 2";
    else if (age >= 9 && age <= 11) group = "Gpo 3";
    
    return { age, group };
}

// Renderiza dinámicamente la lista de hermanos en el select
function renderSiblingsDropdown() {
    const selectElem = document.getElementById('select-hermanos');
    if(!selectElem) return;

    // Preservar la selección actual si estamos escribiendo
    const currentlySelected = Array.from(selectElem.selectedOptions).map(o => o.value);
    selectElem.innerHTML = '';
    
    Object.keys(kidsDataMap).forEach(key => {
        // Un niño no puede ser hermano de sí mismo
        if (currentEditId === key) return;
        
        const kid = kidsDataMap[key];
        const ageGrp = getAgeAndGroup(kid.fechaNacimiento).group;
        const opt = document.createElement('option');
        opt.value = key; // ID en firebase
        opt.textContent = `${kid.nombreCompleto} (${ageGrp}) - ${kid.idAuto || ''}`;
        
        if (currentlySelected.includes(key)) opt.selected = true;
        selectElem.appendChild(opt);
    });
}

function updateBatchPrintButton() {
    const selectedCount = document.querySelectorAll('.kid-selector:checked').length;
    const btn = document.getElementById('btn-print-batch');
    const span = document.getElementById('print-batch-count');
    if(btn) {
        if(selectedCount > 0) {
            btn.style.display = 'inline-flex';
            if(span) span.textContent = selectedCount;
        } else {
            btn.style.display = 'none';
        }
    }
}

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

    // Función para "despedazar" y comprimir imagen a Base64
    function compressImageToBase64(file, maxWidth = 300, maxHeight = 300) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    if (width > maxWidth || height > maxHeight) {
                        const ratio = Math.min(maxWidth / width, maxHeight / height);
                        width = width * ratio;
                        height = height * ratio;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    // Comprimir como JPEG al 70% de calidad
                    resolve(canvas.toDataURL('image/jpeg', 0.7));
                };
                img.onerror = (e) => reject(e);
            };
            reader.onerror = (e) => reject(e);
        });
    }

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
            
            const selectHermanos = document.getElementById('select-hermanos');
            const vinculados = Array.from(selectHermanos.selectedOptions).map(opt => opt.value);

            let photoUrl = null;
            const file = photoInput.files[0];

            // "Despedazar la imagen": Comprimirla a Base64 sin usar Firebase Storage (Evita problemas de CORS)
            if (file) {
                photoUrl = await compressImageToBase64(file);
            }

            // Autogenerar ID si no tiene (Formato secuencial NDR_01, NDR_02...)
            let autoId = null;
            if(currentEditId && kidsDataMap[currentEditId]) {
                autoId = kidsDataMap[currentEditId].idAuto;
            }
            if(!autoId) {
                let maxNum = 0;
                Object.values(kidsDataMap).forEach(kid => {
                    if (kid.idAuto) {
                        // Extraemos el número final sea NDR_05 o NDR-05
                        const matchCounter = kid.idAuto.match(/\d+/);
                        if (matchCounter) {
                            const num = parseInt(matchCounter[0], 10);
                            if (!isNaN(num) && num > maxNum) {
                                maxNum = num;
                            }
                        }
                    }
                });
                // PadStart asegura que empiece con 0 si es menor a 10 (ej. "01", "02")
                autoId = 'NDR_' + String(maxNum + 1).padStart(2, '0');
            }

            // Armamos el diccionario de actualización
            const dataToSave = {
                idAuto: autoId,
                nombreCompleto: fullName,
                fechaNacimiento: birthDate,
                genero: gender,
                tutor: tutorName,
                telefono: phone,
                alergias: allergies,
                notasEspeciales: notes,
                hermanosVinculados: vinculados
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

    // Helper Global para UI Id-Card identica a Maqueta
    function generateIdCardHTML(data) {
        const { age, group } = getAgeAndGroup(data.fechaNacimiento);
        const avatar = data.foto || `https://api.dicebear.com/7.x/fun-emoji/svg?seed=${encodeURIComponent(data.nombreCompleto)}`;
        
        // Split name (First Name in Pink, Last Name in Blue)
        const parts = (data.nombreCompleto || 'Desconocido').split(' ');
        const first = parts.shift() || '';
        const last = parts.join(' ') || '';

        let sisText = '';
        if (data.hermanosVinculados && data.hermanosVinculados.length > 0) {
            const nombresHerms = data.hermanosVinculados.map(hid => kidsDataMap[hid] ? kidsDataMap[hid].nombreCompleto : 'Cargando...').join(', ');
            sisText = `
                <div class="id-siblings-box">
                    <i class="fa-solid fa-children"></i> 
                    <span>Hermano(s) de:<br/>${nombresHerms}</span>
                </div>
            `;
        }

        return `
            <div class="id-card">
                <div class="id-card-content">
                    <img src="logo.webp" class="id-logo" alt="Niños del Rey">
                    <p class="id-church-name">Iglesia Castillo del Rey Cancún</p>
                    
                    <div class="id-photo-container">
                        <img src="${avatar}" class="id-photo" alt="Foto">
                    </div>
                    
                    <h3 class="id-name"><span class="firstname">${first}</span> <span class="lastname">${last}</span></h3>
                    <p class="id-number">ID: ${data.idAuto || 'S/N'}</p>
                    <p class="id-age-gpo">${age} años &bull; ${group}</p>
                    
                    ${sisText}
                </div>
            </div>
        `;
    }

    // Setup batch print logic
    const btnPrintBatch = document.getElementById('btn-print-batch');
    if(btnPrintBatch) {
        btnPrintBatch.addEventListener('click', () => {
            const selectedCheckboxes = document.querySelectorAll('.kid-selector:checked');
            if(selectedCheckboxes.length === 0) return;
            
            const container = document.getElementById('print-batch-container');
            if(!container) return;
            container.innerHTML = ''; // Clear
            
            selectedCheckboxes.forEach(cb => {
                const kid = kidsDataMap[cb.dataset.id];
                if(kid) {
                    container.innerHTML += generateIdCardHTML(kid);
                }
            });
            
            document.getElementById('id-card-modal').classList.remove('active');
            window.print();
        });
    }

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
                
                let bgColor = '#f9f6ea';
                if(group === 'Gpo 1') bgColor = '#f4b4b9'; // Pink
                else if(group === 'Gpo 2') bgColor = '#b1d8a4'; // Green
                else if(group === 'Gpo 3') bgColor = '#a2ccec'; // Blue
                else bgColor = '#fde68a'; // Amarillo
                
                let idText = childData.idAuto || 'NDR_??';
                let sisBroIcon = (childData.hermanosVinculados && childData.hermanosVinculados.length > 0) ? '<i class="fa-solid fa-children" style="color:#222; margin-left:8px;" title="Tiene hermanos"></i>' : '';

                const cardHtml = `
                    <div class="kid-card" data-id="${change.doc.id}" style="background-color: ${bgColor};">
                        <input type="checkbox" class="kid-selector" data-id="${change.doc.id}" style="margin: 10px;">
                        <div class="card-corner corner-tl"></div>
                        <div class="card-corner corner-tr"></div>
                        <div class="card-corner corner-bl"></div>
                        <div class="card-corner corner-br"></div>
                        
                        <div class="kid-card-inner">
                            <img src="${avatarUrl}" alt="${childData.nombreCompleto}" class="kid-avatar">
                            
                            <div class="kid-info">
                                <h4>${childData.nombreCompleto} ${sisBroIcon}</h4>
                                <p style="font-size:0.9rem; color:#444;">ID: <strong>${idText}</strong></p>
                                <p><strong>${age}</strong> años <span class="dot"></span> Clase: <strong>${group}</strong></p>
                            </div>
                            
                            <div class="actions-box">
                                <button class="btn btn-blue btn-tarjeta" style="background:#fcf9f2; color:#333;"><i class="fa-solid fa-scroll"></i> Tarjeta</button>
                                <button class="btn btn-orange btn-editar" style="background:#fde68a; color:#333;"><i class="fa-solid fa-pencil"></i> Editar</button>
                            </div>
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

        // Renderizar o refrescar el selector de familia
        renderSiblingsDropdown();
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
                
                idCardPreview.innerHTML = generateIdCardHTML(data);
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
                
                // Mapear género y check de hermanos
                if(data.genero === "boy" || data.genero === "girl") {
                    form.querySelector(`input[name="gender"][value="${data.genero}"]`).checked = true;
                }
                
                // Actualizar hermanos visualmente en el DOM (re render excluye a el mismo)
                renderSiblingsDropdown();
                const hermanitosArr = data.hermanosVinculados || [];
                Array.from(document.getElementById('select-hermanos').options).forEach(opt => {
                    opt.selected = hermanitosArr.includes(opt.value);
                });

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
