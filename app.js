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

// Función obsoleta (se elimina la impresión masiva para sustituirla por descarga individual)
function updateBatchPrintButton() {}

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

    // Helper Global para Ficha Técnica
    function showFichaForKid(id) {
        const data = kidsDataMap[id];
        if(!data) return;
        
        const { age, group } = getAgeAndGroup(data.fechaNacimiento);
        const avatar = data.foto || `https://api.dicebear.com/7.x/fun-emoji/svg?seed=${encodeURIComponent(data.nombreCompleto)}`;
        
        document.getElementById('info-preview').innerHTML = `
            <div style="display:flex; gap:15px; align-items:center; margin-bottom:15px; border-bottom:3px solid #eee; padding-bottom:15px;">
                <img src="${avatar}" style="width:80px;height:80px;border-radius:50%;border:3px solid #333; object-fit:cover;">
                <div>
                    <h2 style="margin:0; font-family:'Fredoka One'; color:#3b82f6; font-size:1.6rem; line-height:1.1;">${data.nombreCompleto}</h2>
                    <p style="margin:5px 0 0 0; color:#666;">ID: ${data.idAuto || 'N/A'} <span style="margin-left:5px; background:#fde68a; padding:3px 10px; border-radius:12px; font-weight:700; font-size:0.8rem; border:2px solid #333; color:#333;">${group}</span></p>
                </div>
            </div>
            <div style="font-size:1.05rem; line-height:1.6;">
                <p><strong><i class="fa-solid fa-cake-candles" style="color:#ec4899; width:20px;"></i> Edad:</strong> ${age} años (Nace: ${data.fechaNacimiento || 'N/A'})</p>
                <p><strong><i class="fa-solid fa-person-breastfeeding" style="color:#a855f7; width:20px;"></i> Tutor:</strong> ${data.tutor || 'No registrado'}</p>
                <p><strong><i class="fa-solid fa-phone" style="color:#10b981; width:20px;"></i> Teléfono:</strong> <a href="tel:${data.telefono}" style="color:#10b981; text-decoration:none; font-weight:700;">${data.telefono || 'No registrado'}</a></p>
                <p><strong><i class="fa-solid fa-triangle-exclamation" style="color:#ef4444; width:20px;"></i> Alergias:</strong> <span style="color:#ef4444;">${data.alergias || 'Ninguna declarada'}</span></p>
                <p><strong><i class="fa-solid fa-clipboard" style="color:#f59e0b; width:20px;"></i> Notas extra:</strong> ${data.notasEspeciales || 'Ninguna'}</p>
            </div>
        `;
        document.getElementById('info-modal').classList.add('active');
    }

    // Helper Global para UI Id-Card identica a Maqueta
    function generateIdCardHTML(data, docId) {
        const { age, group } = getAgeAndGroup(data.fechaNacimiento);
        const avatar = data.foto || `https://api.dicebear.com/7.x/fun-emoji/svg?seed=${encodeURIComponent(data.nombreCompleto)}`;
        
        // Generar QR en base al URL local (Vercel automatico) apuntando a data id
        const baseUrl = window.location.origin + window.location.pathname;
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(baseUrl + '?kid=' + docId)}`;

        
        // Split name (First Name in Pink, Last Name in Blue)
        const parts = (data.nombreCompleto || 'Desconocido').split(' ');
        const first = parts.shift() || '';
        const last = parts.join(' ') || '';

        let sisText = '';
        if (data.hermanosVinculados && data.hermanosVinculados.length > 0) {
            const nombresHerms = data.hermanosVinculados.map(hid => kidsDataMap[hid] ? kidsDataMap[hid].nombreCompleto : '...').join(', ');
            sisText = `
                <div class="id-siblings-box">
                    <i class="fa-solid fa-children"></i> 
                    <span>Hermanos:<br/>${nombresHerms}</span>
                </div>
            `;
        }

        return `
            <div class="id-card">
                <div class="id-card-content" style="padding: 8px;">
                    <img src="logo.webp" class="id-logo" alt="Niños del Rey" style="height: 48px; margin-bottom: 2px;">
                    
                    <div class="id-photo-container" style="width:85px; height:85px; margin-bottom:8px;">
                        <img src="${avatar}" class="id-photo" alt="Foto">
                    </div>
                    
                    <h3 class="id-name" style="font-size:1.15rem; margin-top:2px; margin-bottom:2px;"><span class="firstname">${first}</span> <span class="lastname">${last}</span></h3>
                    <p class="id-number" style="font-size:0.75rem; margin-top: 2px;">ID: ${data.idAuto || 'S/N'}</p>
                    <p class="id-age-gpo" style="font-size:0.85rem; margin-bottom: 3px;">${age} años &bull; ${group}</p>
                    
                    <div style="display:flex; justify-content:space-between; align-items:flex-end; width:100%; margin-top:auto;">
                        ${sisText ? `<div style="max-width:70%;">${sisText}</div>` : '<div style="max-width:70%;"></div>'}
                        <canvas id="qr-canvas-${docId}" style="width:45px; height:45px; border-radius:4px; border:1.5px solid #a855f7; display:block;"></canvas>
                    </div>
                </div>
            </div>
        `;
    }

    // Setup Download PDF logic using html2pdf
    const btnDownloadPdf = document.getElementById('btn-download-pdf');
    if(btnDownloadPdf) {
        btnDownloadPdf.addEventListener('click', () => {
            const cardElement = document.querySelector('#id-card-preview .id-card');
            if(!cardElement) return;

            const nameElement = cardElement.querySelector('.firstname');
            const docName = nameElement ? nameElement.innerText.replace(/[^a-z0-9_]/gi, '') : 'Credencial';
            
            const opt = {
                margin:       0,
                filename:     `Credencial_NDR_${docName}.pdf`,
                image:        { type: 'jpeg', quality: 1 },
                html2canvas:  { scale: 4, useCORS: true },
                jsPDF:        { unit: 'px', format: [280, 372], orientation: 'portrait', hotfixes: ["px_scaling"] }
            };
            
            // LA SOLUCION SUPREMA: Mover la tarjeta temporalmente al 1er plano del navegador
            // Esto anula todas las restricciones celulares (overflow, paddings, bounds).
            const parent = cardElement.parentNode;
            const nextSibling = cardElement.nextSibling;
            
            // 1) Guardar estado original
            const origPosition = cardElement.style.position;
            const origTop = cardElement.style.top;
            const origLeft = cardElement.style.left;
            const origZIndex = cardElement.style.zIndex;
            
            // 2) Preparar para la foto pura (0,0)
            window.scrollTo(0, 0);
            cardElement.style.position = 'absolute';
            cardElement.style.top = '0';
            cardElement.style.left = '0';
            cardElement.style.zIndex = '999999';
            document.body.appendChild(cardElement);

            // 3) Generar PDF y retornar elemento a la normalidad
            html2pdf().set(opt).from(cardElement).save().then(() => {
                // Devolver todo como estaba
                cardElement.style.position = origPosition;
                cardElement.style.top = origTop;
                cardElement.style.left = origLeft;
                cardElement.style.zIndex = origZIndex;
                
                if (nextSibling) {
                    parent.insertBefore(cardElement, nextSibling);
                } else {
                    parent.appendChild(cardElement);
                }
            });
        });
    }

    // === 2. DIRECTORIO EN TIEMPO REAL (FIREBASE) ===
    const directoryList = document.querySelector('.directory-list');
    let isInitialLoadDone = false;
    
    onSnapshot(collection(db, "ninos"), (snapshot) => {
        if (!isInitialLoadDone && !snapshot.empty) {
            directoryList.innerHTML = ''; 
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
                            
                            <div class="actions-box" style="display:flex; gap:5px; flex-wrap:wrap; justify-content:center; margin-top:10px;">
                                <button class="btn btn-ficha" style="background:#bae6fd; color:#0369a1; padding:5px 8px; font-size:0.8rem; border:2px solid #0369a1; box-shadow:2px 2px 0px rgba(0,0,0,0.1);"><i class="fa-solid fa-eye"></i> Ficha</button>
                                <button class="btn btn-tarjeta" style="background:#fcf9f2; color:#333; padding:5px 8px; font-size:0.8rem; border:2px solid #333; box-shadow:2px 2px 0px rgba(0,0,0,0.1);"><i class="fa-solid fa-id-badge"></i> Gafete</button>
                                <button class="btn btn-editar" style="background:#fde68a; color:#333; padding:5px 8px; font-size:0.8rem; border:2px solid #333; box-shadow:2px 2px 0px rgba(0,0,0,0.1);"><i class="fa-solid fa-pencil"></i> Editar</button>
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

        // Revisar si hay Link de codigo QR entrante (Una sola vez en la carga)
        const urlParams = new URLSearchParams(window.location.search);
        const kidIdFromUrl = urlParams.get('kid');
        if(!isInitialLoadDone && kidIdFromUrl && kidsDataMap[kidIdFromUrl]) {
            showFichaForKid(kidIdFromUrl);
        }
        
        isInitialLoadDone = true;

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
        
        // Listener para las checkboxes
        document.querySelectorAll('.kid-selector').forEach(cb => {
            cb.addEventListener('change', updateBatchPrintButton);
        });

        // RE-ATAR EVENTOS DE TARJETA (MODAL GAFETE)
        document.querySelectorAll('.btn-tarjeta').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const card = e.target.closest('.kid-card');
                const id = card.getAttribute('data-id');
                const data = kidsDataMap[id];
                
                if(!data) return;
                
                idCardPreview.innerHTML = generateIdCardHTML(data, id);
                
                // Generar código QR offline/local para evadir bloqueadores
                setTimeout(() => {
                    new QRious({
                        element: document.getElementById(`qr-canvas-${id}`),
                        value: `${window.location.origin}/?kid=${id}`,
                        size: 200,
                        level: 'M'
                    });
                }, 50);

                modal.classList.add('active');
            });
        });

        // ATAR EVENTOS A "Ficha Completa" (NUEVO MODAL INFO)
        document.querySelectorAll('.btn-ficha').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const card = e.target.closest('.kid-card');
                const id = card.getAttribute('data-id');
                showFichaForKid(id);
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

    // Cerrar el Modal del Gafete
    document.querySelector('.close-modal').addEventListener('click', () => modal.classList.remove('active'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });

    // Cerrar el Modal de la Ficha
    const infoModal = document.getElementById('info-modal');
    document.querySelector('.close-modal-info').addEventListener('click', () => infoModal.classList.remove('active'));
    infoModal.addEventListener('click', (e) => { if (e.target === infoModal) infoModal.classList.remove('active'); });

});
