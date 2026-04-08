document.addEventListener('DOMContentLoaded', () => {
    // Navigation Logic
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Remove active from all nav items
            navItems.forEach(nav => nav.classList.remove('active'));
            // Add active to clicked nav item
            item.classList.add('active');

            // Hide all views
            views.forEach(view => view.classList.remove('active'));
            // Show target view
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

    // Mock Form Submission
    const form = document.getElementById('registro-form');
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        
        // Grab Name
        const nameInput = form.querySelector('input[type="text"]').value;
        
        alert(`¡Registro guardado con éxito para ${nameInput}!\n\n(Esta es una maqueta, los datos no se enviaron a la base de datos real).`);
        
        // Optional: clear form
        form.reset();
        photoPreview.style.backgroundImage = 'none';
        photoPreview.innerHTML = '<i class="fa-solid fa-camera"></i><span>Agregar Foto</span>';
    });

    // ID Card Modal Logic
    const modal = document.getElementById('id-card-modal');
    const closeBtn = document.querySelector('.close-modal');
    const idCardPreview = document.getElementById('id-card-preview');

    // Attach click to all "Tarjeta" buttons in the directory
    document.querySelectorAll('.btn-blue').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Find parent card to extract info
            const card = e.target.closest('.kid-card');
            const name = card.querySelector('h4').textContent;
            const imgSrc = card.querySelector('.kid-avatar').src;
            const details = card.querySelector('p').innerHTML; // contains age and level

            // Generate content inside modal
            idCardPreview.innerHTML = `
                <h2>Iglesia Niños del Rey</h2>
                <img src="${imgSrc}" alt="${name}">
                <h3>${name}</h3>
                <p>${details}</p>
                <div style="margin-top: 15px; border-top: 2px dashed #ccc; padding-top:10px;">
                    <small>Contacto de Emergencia en reverso</small>
                </div>
            `;

            // Show modal
            modal.classList.add('active');
        });
    });

    closeBtn.addEventListener('click', () => {
        modal.classList.remove('active');
    });

    // Close modal when clicking outside content
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });
});
