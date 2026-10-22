/* ==========================================================================
   MÍTAGO - PRODUCTORA ARTÍSTICA & CMS PANEL ADMIN
   App logic, admin authentication, dynamic project rendering & projectInfo editor.
   ========================================================================== */

let currentProjectData = null;
let currentProjectFolder = 'Dawn_of_a_new_age';

document.addEventListener('DOMContentLoaded', () => {
    setupStarfieldCanvas();
    loadProducerHubData();
});

// --- Canvas Background Animation ---
function setupStarfieldCanvas() {
    const canvas = document.getElementById('starfield');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let width = canvas.width = window.innerWidth;
    let height = canvas.height = window.innerHeight;

    window.addEventListener('resize', () => {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    });

    const stars = Array.from({ length: 120 }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 1.5 + 0.5,
        alpha: Math.random(),
        speed: Math.random() * 0.015 + 0.005
    }));

    function animate() {
        ctx.clearRect(0, 0, width, height);

        stars.forEach(star => {
            star.alpha += star.speed;
            if (star.alpha > 1 || star.alpha < 0) {
                star.speed = -star.speed;
            }

            ctx.beginPath();
            ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, star.alpha)})`;
            ctx.shadowBlur = 4;
            ctx.shadowColor = '#00f2fe';
            ctx.fill();
        });

        requestAnimationFrame(animate);
    }
    animate();
}

// --- Load Initial Producer Landing Page Data ---
async function loadProducerHubData() {
    try {
        const response = await fetch(`projects/${currentProjectFolder}/projectInfo.json?v=` + Date.now());
        if (!response.ok) return;
        currentProjectData = await response.json();

        // Update hub card preview
        if (currentProjectData) {
            const titleElem = document.getElementById('hubProjectTitle');
            const descElem = document.getElementById('hubProjectDesc');
            const coverElem = document.getElementById('hubProjectCover');

            if (titleElem && currentProjectData.album_title) titleElem.textContent = currentProjectData.album_title;
            if (descElem && currentProjectData.project_info) descElem.textContent = currentProjectData.project_info;
            if (coverElem && currentProjectData.project_cover) coverElem.src = `projects/${currentProjectFolder}/${currentProjectData.project_cover}`;
        }
    } catch (err) {
        console.error("Error loading project data for hub:", err);
    }
}

// --- Modal Utilities ---
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
}

function openLoginModal() {
    openModal('adminLoginModal');
}

// --- Admin Login Handling ---
function handleLoginSubmit(event) {
    event.preventDefault();
    const user = document.getElementById('adminUser').value.trim();
    const pass = document.getElementById('adminPass').value.trim();
    const errorMsg = document.getElementById('loginErrorMsg');

    // Default admin credentials
    if (user === 'admin' && pass === 'admin') {
        if (errorMsg) errorMsg.style.display = 'none';
        closeModal('adminLoginModal');
        openAdminEditor(currentProjectFolder);
        showToast('Sesión iniciada correctamente', 'success');
    } else {
        if (errorMsg) {
            errorMsg.style.display = 'block';
            errorMsg.textContent = 'Usuario o contraseña incorrectos.';
        }
    }
}

// --- Open Admin Editor for Selected Project ---
async function openAdminEditor(projectFolder) {
    currentProjectFolder = projectFolder || 'Dawn_of_a_new_age';
    openModal('adminPanelModal');

    showToast('Cargando datos del proyecto...', 'info');
    await fetchProjectDataForAdmin();
    populateAdminForm();
}

async function fetchProjectDataForAdmin() {
    try {
        const response = await fetch(`projects/${currentProjectFolder}/projectInfo.json?v=` + Date.now());
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        currentProjectData = await response.json();
    } catch (err) {
        console.error("Error fetching project data:", err);
        showToast("Error al cargar projectInfo.json", "error");
    }
}

function switchAdminProject(val) {
    openAdminEditor(val);
}

// --- Admin Tabs System ---
function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    const activeBtn = document.querySelector(`.tab-btn[onclick*="${tabId}"]`);
    const activeTab = document.getElementById(tabId);

    if (activeBtn) activeBtn.classList.add('active');
    if (activeTab) activeTab.classList.add('active');
}

// --- Image File Upload Handler ---
async function handleImageUpload(targetFieldId, defaultFilename, fileInputElem, previewImgId) {
    if (!fileInputElem || !fileInputElem.files || !fileInputElem.files[0]) return;

    const file = fileInputElem.files[0];
    const formData = new FormData();
    formData.append('image_file', file);
    formData.append('target_filename', defaultFilename || 'project_cover.jpg');
    formData.append('project_folder', currentProjectFolder);

    showToast(`Subiendo ${defaultFilename}...`, 'info');

    try {
        const response = await fetch(`php/upload_image.php`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result && result.success) {
            setValue(targetFieldId, result.filePath);

            // Update preview image
            const previewImg = document.getElementById(previewImgId);
            if (previewImg) {
                previewImg.src = `projects/${currentProjectFolder}/${result.filePath}?v=${Date.now()}`;
                previewImg.style.display = 'block';
            }

            showToast(`¡Imagen ${defaultFilename} subida correctamente!`, 'success');
        } else {
            showToast(result.error || 'Error al subir la imagen', 'error');
        }
    } catch (err) {
        console.error("Error uploading image:", err);
        showToast('Error de conexión al subir la imagen', 'error');
    }
}

// --- Populate Form Fields from currentProjectData ---
function populateAdminForm() {
    if (!currentProjectData) return;

    // Tab 1: General & Artist
    const projectCover = currentProjectData.project_cover || 'assets/project_cover.jpg';
    const artistCover = currentProjectData.artist_cover || 'assets/mitago.png';

    setValue('field_project', currentProjectData.project || '');
    setValue('field_project_info', currentProjectData.project_info || '');
    setValue('field_project_cover', projectCover);
    setValue('field_artist_name', currentProjectData.artist_name || '');
    setValue('field_artist_cover', artistCover);

    // Update previews
    const prevProj = document.getElementById('preview_project_cover');
    if (prevProj && projectCover) {
        prevProj.src = `projects/${currentProjectFolder}/${projectCover}?v=${Date.now()}`;
        prevProj.style.display = 'block';
    }

    const prevArtist = document.getElementById('preview_artist_cover');
    if (prevArtist && artistCover) {
        prevArtist.src = `projects/${currentProjectFolder}/${artistCover}?v=${Date.now()}`;
        prevArtist.style.display = 'block';
    }

    // Tab 2: Artist Socials
    renderArtistSocialsEditor(currentProjectData.artist_social || []);

    // Tab 3: Album Details
    setValue('field_album_title', currentProjectData.album_title || '');
    setValue('field_album_subtitle', currentProjectData.album_subtitle || '');
    setValue('field_album_description', currentProjectData.album_description || '');
    setValue('field_album_cover', currentProjectData.album_cover || '');

    // Tab 4: Album Socials
    renderAlbumSocialsEditor(currentProjectData.album_social || []);

    // Tab 5: Tracks
    renderTracksEditor(currentProjectData.tracks || []);

    // Tab 6: Discography
    renderDiscographyEditor(currentProjectData.other_albums || []);
}

function setValue(id, val) {
    const elem = document.getElementById(id);
    if (elem) elem.value = val;
}

function getValue(id) {
    const elem = document.getElementById(id);
    return elem ? elem.value.trim() : '';
}

// --- Dynamic Repeater Renderers ---

// 1. Artist Socials Repeater
function renderArtistSocialsEditor(socials) {
    const list = document.getElementById('artistSocialsList');
    if (!list) return;
    list.innerHTML = '';

    socials.forEach((s, idx) => {
        const item = document.createElement('div');
        item.className = 'repeater-item';
        item.innerHTML = `
            <div class="repeater-item-row">
                <div class="form-group" style="margin:0;">
                    <label>Nombre (ej: Instagram)</label>
                    <input type="text" class="form-control artist-social-name" value="${s.name || ''}">
                </div>
                <div class="form-group" style="margin:0;">
                    <label>URL Enlace</label>
                    <input type="text" class="form-control artist-social-url" value="${s.url || ''}">
                </div>
                <div class="form-group" style="margin:0;">
                    <label>Ícono (FontAwesome Class)</label>
                    <input type="text" class="form-control artist-social-icon" value="${s.icon || 'fa-brands fa-instagram'}">
                </div>
                <div style="display:flex; align-items:flex-end;">
                    <button type="button" class="btn-remove-item" onclick="this.closest('.repeater-item').remove()">
                        <i class="fa-solid fa-trash"></i> Eliminar
                    </button>
                </div>
            </div>
        `;
        list.appendChild(item);
    });
}

function addArtistSocialItem() {
    renderArtistSocialsEditor([
        ...collectArtistSocialsFromDOM(),
        { name: 'Nueva Red', url: 'https://', icon: 'fa-brands fa-globe' }
    ]);
}

function collectArtistSocialsFromDOM() {
    const items = document.querySelectorAll('#artistSocialsList .repeater-item');
    const result = [];
    items.forEach(item => {
        result.push({
            name: item.querySelector('.artist-social-name').value.trim(),
            url: item.querySelector('.artist-social-url').value.trim(),
            icon: item.querySelector('.artist-social-icon').value.trim()
        });
    });
    return result;
}

// 2. Album Socials / Platforms Repeater
function renderAlbumSocialsEditor(socials) {
    const list = document.getElementById('albumSocialsList');
    if (!list) return;
    list.innerHTML = '';

    socials.forEach((s, idx) => {
        const item = document.createElement('div');
        item.className = 'repeater-item';
        item.innerHTML = `
            <div class="repeater-item-row">
                <div class="form-group" style="margin:0;">
                    <label>Plataforma (ej: Spotify)</label>
                    <input type="text" class="form-control album-social-name" value="${s.name || ''}">
                </div>
                <div class="form-group" style="margin:0;">
                    <label>URL Enlace</label>
                    <input type="text" class="form-control album-social-url" value="${s.url || ''}">
                </div>
                <div class="form-group" style="margin:0;">
                    <label>Ícono (FontAwesome Class)</label>
                    <input type="text" class="form-control album-social-icon" value="${s.icon || 'fa-brands fa-spotify'}">
                </div>
                <div style="display:flex; align-items:flex-end;">
                    <button type="button" class="btn-remove-item" onclick="this.closest('.repeater-item').remove()">
                        <i class="fa-solid fa-trash"></i> Eliminar
                    </button>
                </div>
            </div>
        `;
        list.appendChild(item);
    });
}

function addAlbumSocialItem() {
    renderAlbumSocialsEditor([
        ...collectAlbumSocialsFromDOM(),
        { name: 'Nueva Plataforma', url: 'https://', icon: 'fa-brands fa-spotify' }
    ]);
}

function collectAlbumSocialsFromDOM() {
    const items = document.querySelectorAll('#albumSocialsList .repeater-item');
    const result = [];
    items.forEach(item => {
        result.push({
            name: item.querySelector('.album-social-name').value.trim(),
            url: item.querySelector('.album-social-url').value.trim(),
            icon: item.querySelector('.album-social-icon').value.trim()
        });
    });
    return result;
}

// 3. Tracklist Manager Repeater
function renderTracksEditor(tracks) {
    const list = document.getElementById('tracksList');
    if (!list) return;
    list.innerHTML = '';

    tracks.forEach((t, idx) => {
        const item = document.createElement('div');
        item.className = 'repeater-item track-repeater-item';
        item.dataset.index = idx;
        item.innerHTML = `
            <div class="track-item-card">
                <div class="track-move-btns">
                    <button type="button" class="btn-move" onclick="moveTrack(${idx}, -1)" title="Subir"><i class="fa-solid fa-arrow-up"></i></button>
                    <button type="button" class="btn-move" onclick="moveTrack(${idx}, 1)" title="Bajar"><i class="fa-solid fa-arrow-down"></i></button>
                </div>
                
                <div class="form-group" style="margin:0;">
                    <label>Título de la Canción</label>
                    <input type="text" class="form-control track-title" value="${t.track_title || t.title || ''}">
                </div>

                <div class="form-group" style="margin:0;">
                    <label>Artista</label>
                    <input type="text" class="form-control track-artist" value="${t.track_artist || t.artist || ''}">
                </div>

                <div class="form-group" style="margin:0;">
                    <label>Ruta Audio (ej: songs/01.mp3)</label>
                    <input type="text" class="form-control track-src" value="${t.track_src || t.src || ''}">
                </div>

                <div class="form-group" style="margin:0;">
                    <label>Portada Canción</label>
                    <input type="text" class="form-control track-cover" value="${t.track_cover || t.cover || 'assets/track1.png'}">
                </div>

                <div style="display:flex; align-items:flex-end; justify-content:flex-end;">
                    <button type="button" class="btn-remove-item" onclick="this.closest('.repeater-item').remove(); reindexTrackIDs();">
                        <i class="fa-solid fa-trash"></i> Eliminar
                    </button>
                </div>
            </div>
        `;
        list.appendChild(item);
    });
}

function addTrackItem() {
    const currentTracks = collectTracksFromDOM();
    const newTrack = {
        track_id: currentTracks.length,
        track_filename: '00 New Track.mp3',
        track_src: 'songs/00 New Track.mp3',
        track_title: 'Nueva Canción',
        track_artist: getValue('field_artist_name') || 'Mítago',
        track_cover: 'assets/track1.png'
    };
    renderTracksEditor([...currentTracks, newTrack]);
}

function moveTrack(index, direction) {
    const tracks = collectTracksFromDOM();
    const targetIndex = index + direction;

    if (targetIndex < 0 || targetIndex >= tracks.length) return;

    // Swap
    const temp = tracks[index];
    tracks[index] = tracks[targetIndex];
    tracks[targetIndex] = temp;

    // Reassign IDs
    tracks.forEach((t, i) => t.track_id = i);

    renderTracksEditor(tracks);
}

function collectTracksFromDOM() {
    const items = document.querySelectorAll('#tracksList .track-repeater-item');
    const result = [];
    items.forEach((item, idx) => {
        const srcVal = item.querySelector('.track-src').value.trim();
        const filename = srcVal.split('/').pop() || '';

        result.push({
            track_id: idx,
            track_filename: filename,
            track_src: srcVal,
            track_title: item.querySelector('.track-title').value.trim(),
            track_artist: item.querySelector('.track-artist').value.trim(),
            track_cover: item.querySelector('.track-cover').value.trim()
        });
    });
    return result;
}

// 4. Discography / Other Albums Repeater
function renderDiscographyEditor(albums) {
    const list = document.getElementById('discographyList');
    if (!list) return;
    list.innerHTML = '';

    albums.forEach((a, idx) => {
        const item = document.createElement('div');
        item.className = 'repeater-item';
        item.innerHTML = `
            <div class="repeater-item-row">
                <div class="form-group" style="margin:0;">
                    <label>Título del Lanzamiento</label>
                    <input type="text" class="form-control disco-title" value="${a.album_title || a.title || ''}">
                </div>
                <div class="form-group" style="margin:0;">
                    <label>Información / Año (ej: EP • 2025)</label>
                    <input type="text" class="form-control disco-info" value="${a.album_info || a.info || ''}">
                </div>
                <div class="form-group" style="margin:0;">
                    <label>Ruta Portada</label>
                    <input type="text" class="form-control disco-cover" value="${a.album_cover || a.cover || ''}">
                </div>
                <div class="form-group" style="margin:0;">
                    <label>Enlace / Landing Page</label>
                    <input type="text" class="form-control disco-link" value="${a.landing_page || ''}">
                </div>
                <div style="display:flex; align-items:flex-end;">
                    <button type="button" class="btn-remove-item" onclick="this.closest('.repeater-item').remove()">
                        <i class="fa-solid fa-trash"></i> Eliminar
                    </button>
                </div>
            </div>
        `;
        list.appendChild(item);
    });
}

function addDiscographyItem() {
    renderDiscographyEditor([
        ...collectDiscographyFromDOM(),
        { album_title: 'Próximamente', album_info: 'Single • 2026', album_cover: 'assets/proximamente.png', landing_page: '#' }
    ]);
}

function collectDiscographyFromDOM() {
    const items = document.querySelectorAll('#discographyList .repeater-item');
    const result = [];
    items.forEach(item => {
        result.push({
            album_title: item.querySelector('.disco-title').value.trim(),
            album_cover: item.querySelector('.disco-cover').value.trim(),
            album_info: item.querySelector('.disco-info').value.trim(),
            landing_page: item.querySelector('.disco-link').value.trim()
        });
    });
    return result;
}

// --- Collect All Data & Save to PHP Backend ---
async function saveCurrentProjectData() {
    try {
        const payload = {
            project_folder: currentProjectFolder,
            project: getValue('field_project'),
            project_info: getValue('field_project_info'),
            project_cover: getValue('field_project_cover'),
            artist_name: getValue('field_artist_name'),
            artist_cover: getValue('field_artist_cover'),
            artist_social: collectArtistSocialsFromDOM(),
            album_title: getValue('field_album_title'),
            album_subtitle: getValue('field_album_subtitle'),
            album_description: getValue('field_album_description'),
            album_cover: getValue('field_album_cover'),
            album_social: collectAlbumSocialsFromDOM(),
            tracks: collectTracksFromDOM(),
            other_albums: collectDiscographyFromDOM()
        };

        showToast('Guardando cambios en projectInfo.json...', 'info');

        const response = await fetch(`php/save_project_info.php`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8'
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result && result.success) {
            currentProjectData = payload;
            showToast('¡projectInfo.json guardado con éxito!', 'success');
            loadProducerHubData(); // Refresh hub display
        } else {
            showToast(result.error || 'Error al guardar el archivo', 'error');
        }
    } catch (err) {
        console.error("Error saving album info:", err);
        showToast('Error de conexión con el servidor backend', 'error');
    }
}

// --- Toast Notification Banner ---
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-circle-exclamation';

    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// --- Contact Form Handler ---
function handleContactSubmit(event) {
    event.preventDefault();
    const name = document.getElementById('contactName').value.trim();
    const msgBox = document.getElementById('contactFormMsg');

    if (msgBox) {
        msgBox.className = 'contact-msg-box success';
        msgBox.innerHTML = `<i class="fa-solid fa-circle-check"></i> ¡Gracias, <strong>${name}</strong>! Tu mensaje ha sido enviado con éxito. Te responderemos pronto.`;
    }

    showToast('Mensaje de contacto enviado', 'success');
    document.getElementById('contactForm').reset();
}
