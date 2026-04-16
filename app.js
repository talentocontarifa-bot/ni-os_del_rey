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
        // Solo alumnos pueden ser hermanos (según la lógica actual)
        if (kid.tipoPersona === 'maestro') return;

        const ageGrp = getAgeAndGroup(kid.fechaNacimiento).group;
        const opt = document.createElement('option');
        opt.value = key; // ID en firebase
        opt.textContent = `${kid.nombreCompleto} (${ageGrp}) - ${kid.idAuto || ''}`;
        
        if (currentlySelected.includes(key)) opt.selected = true;
        selectElem.appendChild(opt);
    });
}

function renderMaestrosDropdowns() {
    const selects = document.querySelectorAll('.master-select');
    if (!selects.length) return;

    // Preservar selecciones
    const selections = {};
    selects.forEach(s => selections[s.id] = s.value);

    // Populate
    selects.forEach(select => {
        const isAux = select.id.includes('aux');
        select.innerHTML = isAux ? '<option value="">-- Ninguno --</option>' : '<option value="">-- Seleccionar --</option>';
        
        Object.keys(kidsDataMap).forEach(key => {
            const person = kidsDataMap[key];
            if (person.tipoPersona === 'maestro') {
                const opt = document.createElement('option');
                opt.value = key;
                opt.textContent = person.nombreCompleto;
                select.appendChild(opt);
            }
        });
        
        // Restaurar
        if (selections[select.id]) {
            select.value = selections[select.id];
        }
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

    // Toggle de UI Alumno/Maestro
    const radiostipoPersona = document.querySelectorAll('input[name="tipoPersona"]');
    const secAlumno = document.getElementById('section-alumno');
    const secMaestro = document.getElementById('section-maestro');
    const titleRegistro = document.querySelector('.purple-header h2');

    radiostipoPersona.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if(e.target.value === 'maestro') {
                secAlumno.style.display = 'none';
                secMaestro.style.display = 'block';
                titleRegistro.innerHTML = '<i class="fa-solid fa-chalkboard-user"></i> Registro de Nuevo Maestro';
            } else {
                secAlumno.style.display = 'block';
                secMaestro.style.display = 'none';
                titleRegistro.innerHTML = '<i class="fa-solid fa-child-reaching"></i> Registro de Nuevo Niño';
            }
        });
    });

    // Toggle de Niveles Vida Discipular
    const radiosVd = document.querySelectorAll('input[name="vidadiscipular"]');
    const panelNivelesVd = document.getElementById('niveles-vd');
    radiosVd.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if(e.target.value === 'si') {
                panelNivelesVd.style.display = 'block';
            } else {
                panelNivelesVd.style.display = 'none';
                // Reset checks
                document.querySelectorAll('.vd-nivel').forEach(cb => cb.checked = false);
            }
        });
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
        submitBtn.disabled = true;

        try {
            const tipoPersona = form.querySelector('input[name="tipoPersona"]:checked').value;
            const fullName = document.getElementById('reg-nombre').value;
            const birthDate = document.getElementById('reg-fecha-nac').value;
            
            let dataToSave = {
                tipoPersona: tipoPersona,
                nombreCompleto: fullName,
                fechaNacimiento: birthDate,
            };

            if (tipoPersona === 'alumno') {
                const gender = form.querySelector('input[name="gender"]:checked').value;
                const tutorName = document.getElementById('reg-tutor').value || "";
                const phone = document.getElementById('reg-telefono-tutor').value || "";
                const allergies = document.getElementById('reg-alergias').value || "";
                const notes = document.getElementById('reg-notas').value || "";
                
                const selectHermanos = document.getElementById('select-hermanos');
                const vinculados = Array.from(selectHermanos.selectedOptions).map(opt => opt.value);
                
                dataToSave = { ...dataToSave, genero: gender, tutor: tutorName, telefono: phone, alergias: allergies, notasEspeciales: notes, hermanosVinculados: vinculados };
            } else {
                const celular = document.getElementById('reg-celular').value || "";
                const correo = document.getElementById('reg-correo').value || "";
                const estadoCivil = document.getElementById('reg-estadocivil').value;
                const bautizado = form.querySelector('input[name="bautizado"]:checked').value;
                const sanidad = form.querySelector('input[name="sanidad"]:checked').value;
                const vdData = form.querySelector('input[name="vidadiscipular"]:checked').value;
                
                let vdNiveles = [];
                if (vdData === 'si') {
                    vdNiveles = Array.from(document.querySelectorAll('.vd-nivel:checked')).map(cb => cb.value);
                }
                
                dataToSave = { ...dataToSave, celular, correo, estadoCivil, bautizado, sanidadInterior: sanidad, vidaDiscipular: vdData, vidaDiscipularNiveles: vdNiveles };
            }

            let photoUrl = null;
            const file = photoInput.files[0];

            if (file) {
                photoUrl = await compressImageToBase64(file);
            }

            let autoId = null;
            if(currentEditId && kidsDataMap[currentEditId]) {
                autoId = kidsDataMap[currentEditId].idAuto;
            }
            if(!autoId) {
                let maxNum = 0;
                Object.values(kidsDataMap).forEach(kid => {
                    if (kid.idAuto) {
                        const matchCounter = kid.idAuto.match(/\d+/);
                        if (matchCounter) {
                            const num = parseInt(matchCounter[0], 10);
                            if (!isNaN(num) && num > maxNum) {
                                maxNum = num;
                            }
                        }
                    }
                });
                autoId = 'NDR_' + String(maxNum + 1).padStart(2, '0');
            }
            dataToSave.idAuto = autoId;

            // Solo actualizar la foto si subieron nueva
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
        
        const avatar = data.foto || `https://api.dicebear.com/7.x/fun-emoji/svg?seed=${encodeURIComponent(data.nombreCompleto)}`;
        const baseHTML = `
            <div style="display:flex; gap:15px; align-items:center; margin-bottom:15px; border-bottom:3px solid #eee; padding-bottom:15px;">
                <img src="${avatar}" style="width:80px;height:80px;border-radius:50%;border:3px solid #333; object-fit:cover;">
                <div>
                    <h2 style="margin:0; font-family:'Fredoka One'; color:#3b82f6; font-size:1.6rem; line-height:1.1;">${data.nombreCompleto}</h2>
                    <p style="margin:5px 0 0 0; color:#666;">ID: ${data.idAuto || 'N/A'}</p>
                </div>
            </div>`;
            
        let bodyHTML = '';

        if (data.tipoPersona === 'maestro') {
            const { age } = getAgeAndGroup(data.fechaNacimiento);
            const vdText = data.vidaDiscipular === 'si' ? `Sí (Niveles: ${data.vidaDiscipularNiveles ? data.vidaDiscipularNiveles.join(', ') : 'Ninguno'})` : 'No';
            bodyHTML = `
            <div style="font-size:1.05rem; line-height:1.6;">
                <p><strong><i class="fa-solid fa-cake-candles" style="color:#ec4899; width:20px;"></i> Edad:</strong> ${age} años (Nace: ${data.fechaNacimiento || 'N/A'})</p>
                <p><strong><i class="fa-solid fa-phone" style="color:#10b981; width:20px;"></i> Celular:</strong> <a href="tel:${data.celular}" style="color:#10b981; text-decoration:none; font-weight:700;">${data.celular || 'No registrado'}</a></p>
                <p><strong><i class="fa-solid fa-envelope" style="color:#3b82f6; width:20px;"></i> Correo:</strong> ${data.correo || 'No registrado'}</p>
                <p><strong><i class="fa-solid fa-ring" style="color:#f59e0b; width:20px;"></i> Estado Civil:</strong> ${data.estadoCivil || 'N/A'}</p>
                <p><strong><i class="fa-solid fa-droplet" style="color:#38bdf8; width:20px;"></i> Bautizado:</strong> <span style="text-transform: capitalize;">${data.bautizado || 'N/A'}</span></p>
                <p><strong><i class="fa-solid fa-book-bible" style="color:#a855f7; width:20px;"></i> Vida Discipular:</strong> ${vdText}</p>
                <p><strong><i class="fa-solid fa-heart-circle-check" style="color:#f43f5e; width:20px;"></i> Sanidad Interior:</strong> <span style="text-transform: capitalize;">${data.sanidadInterior || 'N/A'}</span></p>
            </div>`;
        } else {
            const { age, group } = getAgeAndGroup(data.fechaNacimiento);
            bodyHTML = `
            <div style="font-size:1.05rem; line-height:1.6;">
                <p><strong><i class="fa-solid fa-users-rectangle" style="color:#4f46e5; width:20px;"></i> Grupo:</strong> ${group}</p>
                <p><strong><i class="fa-solid fa-cake-candles" style="color:#ec4899; width:20px;"></i> Edad:</strong> ${age} años (Nace: ${data.fechaNacimiento || 'N/A'})</p>
                <p><strong><i class="fa-solid fa-person-breastfeeding" style="color:#a855f7; width:20px;"></i> Tutor:</strong> ${data.tutor || 'No registrado'}</p>
                <p><strong><i class="fa-solid fa-phone" style="color:#10b981; width:20px;"></i> Teléfono:</strong> <a href="tel:${data.telefono}" style="color:#10b981; text-decoration:none; font-weight:700;">${data.telefono || 'No registrado'}</a></p>
                <p><strong><i class="fa-solid fa-triangle-exclamation" style="color:#ef4444; width:20px;"></i> Alergias:</strong> <span style="color:#ef4444;">${data.alergias || 'Ninguna declarada'}</span></p>
                <p><strong><i class="fa-solid fa-clipboard" style="color:#f59e0b; width:20px;"></i> Notas extra:</strong> ${data.notasEspeciales || 'Ninguna'}</p>
            </div>`;
        }

        document.getElementById('info-preview').innerHTML = baseHTML + bodyHTML;
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

        // Ajuste dinámico de fuente y foto para nombres largos
        const nameLen = data.nombreCompleto ? data.nombreCompleto.length : 0;
        let nameStyle = "";
        let photoSizeStyle = "";
        if (nameLen > 22) {
            nameStyle = "font-size: 1.2rem; line-height: 1; margin: 0;";
            photoSizeStyle = "width: 125px; height: 125px; margin-bottom: 4px;";
        } else if (nameLen > 14) {
            nameStyle = "font-size: 1.45rem; line-height: 1; margin: 0;";
            photoSizeStyle = "width: 140px; height: 140px; margin-bottom: 6px;";
        }

        let sisText = '';
        if (data.hermanosVinculados && data.hermanosVinculados.length > 0) {
            const nombresHerms = data.hermanosVinculados.map(hid => kidsDataMap[hid] ? kidsDataMap[hid].nombreCompleto.split(' ')[0] : '...').join(', ');
            sisText = `
                <div class="id-siblings-box">
                    <i class="fa-solid fa-children"></i> 
                    <span>Hermanos:<br/>${nombresHerms}</span>
                </div>
            `;
        }

        return `
            <div class="id-card">
                <img src="assets/Back_credencial.webp" class="id-card-bg">
                <div class="id-card-content" style="padding: 8px;">
                    <img src="logo.webp" class="id-logo" alt="Niños del Rey">
                    
                    <div class="id-photo-container" style="${photoSizeStyle}">
                        <img src="${avatar}" class="id-photo" alt="Foto">
                    </div>
                    
                    <h3 class="id-name" style="${nameStyle}"><span class="firstname">${first}</span> <span class="lastname">${last}</span></h3>
                    <p class="id-number">ID: ${data.idAuto || 'S/N'}</p>
                    <p class="id-age-gpo">${age} años &bull; ${group}</p>
                    
                    <div style="display:flex; justify-content:space-between; align-items:flex-end; width:100%; margin-top:auto;">
                        ${sisText ? `<div style="max-width:70%;">${sisText}</div>` : '<div style="max-width:70%;"></div>'}
                        <canvas id="qr-canvas-${docId}" style="width:45px; height:45px; border-radius:4px; border:1.5px solid #a855f7; display:block;"></canvas>
                    </div>
                </div>
            </div>
        `;
    }

    // Setup Download PDF logic: Regresamos a NATIVO (Print Dialog del SO)
    const btnDownloadPdf = document.getElementById('btn-download-pdf');
    if(btnDownloadPdf) {
        btnDownloadPdf.innerHTML = '<i class="fa-solid fa-print"></i> Imprimir Credencial';
        btnDownloadPdf.addEventListener('click', () => {
            const btn = document.getElementById('btn-download-pdf');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Abriendo Impresora...';
            btn.disabled = true;

            // Damos tiempecito para que el boton ponga su feedback visual
            setTimeout(() => {
                // LLAMADA NATIVA: Perfecta calidad, el navegador respeta SVG's, WebP originales y el contorno
                window.print();
                
                btn.innerHTML = originalText;
                btn.disabled = false;
            }, 300);
        });
    }

    // === 2. DIRECTORIO EN TIEMPO REAL (FIREBASE) ===
    const directoryList = document.querySelector('.directory-list');
    let isInitialLoadDone = false;
    // TABS DEL DIRECTORIO
    let currentDirTab = 'alumno';
    const tabAlumnos = document.getElementById('tab-alumnos');
    const tabMaestros = document.getElementById('tab-maestros');

    function applyDirectoryFilter() {
        const cards = directoryList.querySelectorAll('.kid-card');
        const searchTerm = document.getElementById('search-input').value.toLowerCase();
        
        cards.forEach(card => {
            const cardData = kidsDataMap[card.getAttribute('data-id')];
            if(!cardData) return;
            const type = cardData.tipoPersona || 'alumno'; // defaults to child
            const matchesTab = type === currentDirTab;
            const matchesSearch = cardData.nombreCompleto.toLowerCase().includes(searchTerm);
            
            card.style.display = (matchesTab && matchesSearch) ? 'block' : 'none';
        });
    }

    if (tabAlumnos && tabMaestros) {
        tabAlumnos.addEventListener('click', () => {
            currentDirTab = 'alumno';
            tabAlumnos.className = 'btn btn-blue';
            tabAlumnos.style.background = ''; tabAlumnos.style.color = '';
            tabMaestros.className = 'btn';
            tabMaestros.style.background = '#e2e8f0'; tabMaestros.style.color = '#475569';
            applyDirectoryFilter();
        });
        tabMaestros.addEventListener('click', () => {
            currentDirTab = 'maestro';
            tabMaestros.className = 'btn btn-blue';
            tabMaestros.style.background = ''; tabMaestros.style.color = '';
            tabAlumnos.className = 'btn';
            tabAlumnos.style.background = '#e2e8f0'; tabAlumnos.style.color = '#475569';
            applyDirectoryFilter();
        });
    }

    // Buscador
    document.getElementById('search-input').addEventListener('input', applyDirectoryFilter);

    onSnapshot(collection(db, "ninos"), (snapshot) => {
        if (!isInitialLoadDone && !snapshot.empty) {
            directoryList.innerHTML = ''; 
        }

        snapshot.docChanges().forEach((change) => {
            const childData = change.doc.data();
            kidsDataMap[change.doc.id] = childData; // Guardar copia local en memoria

            if (change.type === "added" || change.type === "modified") {
                const isMaestro = childData.tipoPersona === 'maestro';
                const { age, group } = getAgeAndGroup(childData.fechaNacimiento);
                
                let avatarUrl = childData.foto ? childData.foto : `https://api.dicebear.com/7.x/fun-emoji/svg?seed=${childData.nombreCompleto.replace(/ /g, '')}`;
                
                let bgColor = '#f9f6ea';
                if(isMaestro) {
                    bgColor = '#cbd5e1'; // Gris azulado para maestros
                } else {
                    if(group === 'Gpo 1') bgColor = '#f4b4b9'; // Pink
                    else if(group === 'Gpo 2') bgColor = '#b1d8a4'; // Green
                    else if(group === 'Gpo 3') bgColor = '#a2ccec'; // Blue
                    else bgColor = '#fde68a'; // Amarillo
                }
                
                let idText = childData.idAuto || 'NDR_??';
                let sisBroIcon = (!isMaestro && childData.hermanosVinculados && childData.hermanosVinculados.length > 0) ? '<i class="fa-solid fa-children" style="color:#222; margin-left:8px;" title="Tiene hermanos"></i>' : '';

                const extraInfoHtml = isMaestro 
                    ? `<p><strong>${age}</strong> años <span class="dot"></span> Rol: <strong>Maestro(a)</strong></p>` 
                    : `<p><strong>${age}</strong> años <span class="dot"></span> Clase: <strong>${group}</strong></p>`;

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
                                ${extraInfoHtml}
                            </div>
                            
                            <div class="actions-box" style="display:flex; gap:5px; flex-wrap:wrap; justify-content:center; margin-top:10px;">
                                <button class="btn btn-ficha" style="background:#bae6fd; color:#0369a1; padding:5px 8px; font-size:0.8rem; border:2px solid #0369a1; box-shadow:2px 2px 0px rgba(0,0,0,0.1);"><i class="fa-solid fa-eye"></i> Ficha</button>
                                ${!isMaestro ? `<button class="btn btn-tarjeta" style="background:#fcf9f2; color:#333; padding:5px 8px; font-size:0.8rem; border:2px solid #333; box-shadow:2px 2px 0px rgba(0,0,0,0.1);"><i class="fa-solid fa-id-badge"></i> Gafete</button>` : ''}
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

        // Apply visual filtering logic 
        applyDirectoryFilter();

        // Renderizar o refrescar el selector de familia y maestros
        renderSiblingsDropdown();
        renderMaestrosDropdowns();
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
                // Llenar los inputs con la información en memoria
                document.getElementById('reg-nombre').value = data.nombreCompleto || "";
                document.getElementById('reg-fecha-nac').value = data.fechaNacimiento || "";
                
                if (data.tipoPersona === 'maestro') {
                    // Cargar Master Data
                    form.querySelector('input[name="tipoPersona"][value="maestro"]').checked = true;
                    form.querySelector('input[name="tipoPersona"][value="maestro"]').dispatchEvent(new Event('change'));
                    
                    document.getElementById('reg-celular').value = data.celular || "";
                    document.getElementById('reg-correo').value = data.correo || "";
                    document.getElementById('reg-estadocivil').value = data.estadoCivil || "Soltero";
                    
                    if(data.bautizado) form.querySelector(`input[name="bautizado"][value="${data.bautizado}"]`).checked = true;
                    if(data.sanidadInterior) form.querySelector(`input[name="sanidad"][value="${data.sanidadInterior}"]`).checked = true;
                    
                    if(data.vidaDiscipular) {
                        const vdRadio = form.querySelector(`input[name="vidadiscipular"][value="${data.vidaDiscipular}"]`);
                        if(vdRadio) {
                            vdRadio.checked = true;
                            vdRadio.dispatchEvent(new Event('change'));
                        }
                    }
                    if(data.vidaDiscipularNiveles) {
                        Array.from(document.querySelectorAll('.vd-nivel')).forEach(cb => {
                            cb.checked = data.vidaDiscipularNiveles.includes(cb.value);
                        });
                    }
                    
                } else {
                    // Cargar Kid Data
                    form.querySelector('input[name="tipoPersona"][value="alumno"]').checked = true;
                    form.querySelector('input[name="tipoPersona"][value="alumno"]').dispatchEvent(new Event('change'));
                    
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

                    document.getElementById('reg-tutor').value = data.tutor || "";
                    document.getElementById('reg-telefono-tutor').value = data.telefono || "";
                    document.getElementById('reg-alergias').value = data.alergias || "";
                    document.getElementById('reg-notas').value = data.notasEspeciales || "";
                }

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

    // === 3. LÓGICA DE ROLES (CALENDARIO) ===
    let calendarDate = new Date();
    window.rolesMapData = {}; // Guardar roles indexados por fecha (YYYY-MM-DD)

    const btnNewRol = document.getElementById('btn-new-rol');
    const rolFormModal = document.getElementById('rol-form-modal');
    const btnCloseRolForm = document.querySelector('.close-rol-form');
    
    // Abrir form de roles
    btnNewRol.addEventListener('click', () => {
        document.getElementById('roles-form').reset();
        rolFormModal.classList.add('active');
    });

    btnCloseRolForm.addEventListener('click', () => rolFormModal.classList.remove('active'));
    rolFormModal.addEventListener('click', (e) => { if (e.target === rolFormModal) rolFormModal.classList.remove('active'); });

    // Guardado de form
    const rolesForm = document.getElementById('roles-form');
    if (rolesForm) {
        rolesForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = rolesForm.querySelector('button[type="submit"]');
            const originalText = submitBtn.innerHTML;
            submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
            submitBtn.disabled = true;

            try {
                const fechaSeleccionada = document.getElementById('rol-fecha').value;
                const dataToSave = {
                    fecha: fechaSeleccionada,
                    gpo1: {
                        titular: document.getElementById('gpo1-titular').value,
                        auxiliar: document.getElementById('gpo1-aux').value,
                        link: document.getElementById('gpo1-link').value
                    },
                    gpo2: {
                        titular: document.getElementById('gpo2-titular').value,
                        auxiliar: document.getElementById('gpo2-aux').value,
                        link: document.getElementById('gpo2-link').value
                    },
                    gpo3: {
                        titular: document.getElementById('gpo3-titular').value,
                        auxiliar: document.getElementById('gpo3-aux').value,
                        link: document.getElementById('gpo3-link').value
                    },
                    fechaRegistro: new Date().toISOString()
                };

                const existingRol = window.rolesMapData[fechaSeleccionada];
                if (existingRol && existingRol.id) {
                    await updateDoc(doc(db, "roles_semanales", existingRol.id), dataToSave);
                } else {
                    await addDoc(collection(db, "roles_semanales"), dataToSave);
                }

                alert("Roles guardados exitosamente.");
                rolesForm.reset();
                rolFormModal.classList.remove('active');
                document.getElementById('rol-detail-modal').classList.remove('active'); // en caso de que viniera de editar
            } catch (error) {
                console.error("Error guardando rol", error);
            } finally {
                submitBtn.innerHTML = originalText;
                submitBtn.disabled = false;
            }
        });
    }

    // Modal de Detalles del Rol
    const rolDetailModal = document.getElementById('rol-detail-modal');
    document.querySelector('.close-rol-detail').addEventListener('click', () => rolDetailModal.classList.remove('active'));
    rolDetailModal.addEventListener('click', (e) => { if (e.target === rolDetailModal) rolDetailModal.classList.remove('active'); });

    document.getElementById('btn-edit-rol-modal').addEventListener('click', () => {
        const currentFecha = document.getElementById('btn-edit-rol-modal').dataset.fecha;
        if(currentFecha && window.rolesMapData[currentFecha]) {
            const data = window.rolesMapData[currentFecha];
            document.getElementById('rol-fecha').value = data.fecha;
            
            document.getElementById('gpo1-titular').value = data.gpo1.titular || "";
            document.getElementById('gpo1-aux').value = data.gpo1.auxiliar || "";
            document.getElementById('gpo1-link').value = data.gpo1.link || "";

            document.getElementById('gpo2-titular').value = data.gpo2.titular || "";
            document.getElementById('gpo2-aux').value = data.gpo2.auxiliar || "";
            document.getElementById('gpo2-link').value = data.gpo2.link || "";

            document.getElementById('gpo3-titular').value = data.gpo3.titular || "";
            document.getElementById('gpo3-aux').value = data.gpo3.auxiliar || "";
            document.getElementById('gpo3-link').value = data.gpo3.link || "";

            rolDetailModal.classList.remove('active');
            rolFormModal.classList.add('active');
        }
    });

    // Escucha en Tiempo Real - Actualiza Calendario
    const rolesCalendar = document.getElementById('roles-calendar');
    if (rolesCalendar) {
        onSnapshot(collection(db, "roles_semanales"), (snapshot) => {
            window.rolesMapData = {};
            snapshot.forEach(doc => {
                const data = doc.data();
                window.rolesMapData[data.fecha] = { id: doc.id, ...data };
            });
            renderCalendar();
        });
    }

    function renderCalendar() {
        const calendarGrid = document.getElementById('roles-calendar');
        if (!calendarGrid) return;
        
        const year = calendarDate.getFullYear();
        const month = calendarDate.getMonth(); // 0-11
        
        // Mes Titulo
        const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
        document.getElementById('cal-month-title').innerText = `${monthNames[month]} ${year}`;

        // Header Semanas
        calendarGrid.innerHTML = `
            <div class="cal-header-day">Do</div>
            <div class="cal-header-day">Lu</div>
            <div class="cal-header-day">Ma</div>
            <div class="cal-header-day">Mi</div>
            <div class="cal-header-day">Ju</div>
            <div class="cal-header-day">Vi</div>
            <div class="cal-header-day">Sa</div>
        `;

        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        // Padding vacios inicio
        for (let i = 0; i < firstDay; i++) {
            calendarGrid.insertAdjacentHTML('beforeend', `<div class="cal-day empty"></div>`);
        }

        // Dias del mes
        for (let i = 1; i <= daysInMonth; i++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            const isSunday = new Date(year, month, i).getDay() === 0;
            const rolData = window.rolesMapData[dateStr];
            
            let dayHtml = document.createElement('div');
            dayHtml.className = `cal-day ${rolData ? 'has-rol' : ''}`;
            dayHtml.innerHTML = `<span style="border-radius:50%; width:28px; height:28px; text-align:center; line-height:28px; ${isSunday && !rolData ? 'background:#fee2e2; color:#ef4444;' : ''}">${i}</span>`;
            
            if (rolData) {
                dayHtml.addEventListener('click', () => showRolDetail(dateStr));
            } else if (isSunday) {
                // Dominicales vacios
                dayHtml.style.cursor = 'pointer';
                dayHtml.title = "Haz clic para añadir rol a este domingo";
                dayHtml.addEventListener('click', () => {
                    document.getElementById('roles-form').reset();
                    document.getElementById('rol-fecha').value = dateStr;
                    rolFormModal.classList.add('active');
                });
            }

            calendarGrid.appendChild(dayHtml);
        }
    }

    function showRolDetail(fechaStr) {
        const rol = window.rolesMapData[fechaStr];
        if (!rol) return;

        const formatRef = (id) => kidsDataMap[id] ? kidsDataMap[id].nombreCompleto : 'Sin Asignar';
        const renderGpoRow = (label, gpoData, color) => {
            if (!gpoData || !gpoData.titular) return '';
            const auxName = gpoData.auxiliar ? formatRef(gpoData.auxiliar) : '';
            return `
                <div style="border-bottom: 2px dashed #cbd5e1; padding-bottom: 15px; margin-bottom: 15px;">
                    <strong style="color: ${color}; font-size:1.2rem; font-family: var(--font-heading);"><i class="fa-solid fa-users"></i> ${label}</strong>
                    <div style="margin-top: 10px; font-family: var(--font-body); font-size:1.1rem;"><strong><i class="fa-solid fa-chalkboard-user"></i> Titular:</strong> ${formatRef(gpoData.titular)}</div>
                    ${auxName ? `<div style="font-family: var(--font-body); font-size:1.1rem; margin-top:5px;"><strong><i class="fa-solid fa-user-plus"></i> Auxiliar:</strong> ${auxName}</div>` : ''}
                    ${gpoData.link ? `<div style="font-family: var(--font-body); margin-top:10px;"><a href="${gpoData.link}" target="_blank" class="btn btn-sm" style="background:#f1f5f9; color:#0f172a; width:100%; text-align:center;"><i class="fa-solid fa-cloud-arrow-down"></i> Descargar Clase</a></div>` : ''}
                </div>
            `;
        };

        const fechaObj = new Date(fechaStr + "T00:00:00");
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        
        const html = `
            <h2 style="margin-top:0; border-bottom: 4px solid var(--border-color); padding-bottom: 15px; font-family: var(--font-heading); color: var(--primary-purple); text-transform:capitalize;">
                <i class="fa-regular fa-calendar-check" style="color:var(--primary-orange);"></i> ${fechaObj.toLocaleDateString('es-ES', options)}
            </h2>
            <div style="display:flex; flex-direction:column; gap: 5px; margin-top:15px;">
                ${renderGpoRow('Grupo 1 (0-2 años)', rol.gpo1, '#ec4899')}
                ${renderGpoRow('Grupo 2 (3-8 años)', rol.gpo2, '#10b981')}
                ${renderGpoRow('Grupo 3 (9-11 años)', rol.gpo3, '#3b82f6')}
            </div>
        `;

        document.getElementById('btn-edit-rol-modal').dataset.fecha = fechaStr;
        document.getElementById('rol-detail-content').innerHTML = html;
        rolDetailModal.classList.add('active');
    }

    // Controles mes anterior / siguiente
    document.getElementById('cal-prev-month').addEventListener('click', () => {
        calendarDate.setMonth(calendarDate.getMonth() - 1);
        renderCalendar();
    });
    document.getElementById('cal-next-month').addEventListener('click', () => {
        calendarDate.setMonth(calendarDate.getMonth() + 1);
        renderCalendar();
    });

});
