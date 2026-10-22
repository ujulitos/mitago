/* ==========================================================================
   MÍTAGO - I CAME FROM THE STARS - APPLICATION SCRIPT
   - Dynamic Playlist loading from songs.json (generated via PHP from songs/ directory)
   - Real HTML5 Audio Player Integration
   - Playlist Fixed Height & Smooth Custom Scrollbar
   - Dynamic Starfield Canvas Background Animation
   - Interactive UI Modals & Ticket Booking
   ========================================================================== */

// --- Application State & Audio Player ---
let albumInfo = null;
let tracks = [];
let currentTrackIndex = 0;
let isPlaying = false;
let isRepeat = false; // Repeat 1 track
let isLoop = false; // Repeat all (Loop playlist)
let isShuffle = false;
let isMuted = false;
let previousVolume = 0.8;

const audioPlayer = new Audio();

// --- Service Worker & PWA Install Handling ---
let deferredPrompt = null;

function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone ||
        document.referrer.includes('android-app://');
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js')
                .then((registration) => {
                    console.log('[PWA] Service Worker registrado con éxito. Scope:', registration.scope);
                })
                .catch((error) => {
                    console.error('[PWA] Error al registrar Service Worker:', error);
                });
        });
    }
}

function setupPwaInstallPrompt() {
    const btnPwaInstall = document.getElementById('btnPwaInstall');
    const pwaFloatingBtn = document.getElementById('pwaFloatingBtn');

    // If app is already installed in standalone mode, hide install triggers
    if (isStandalone()) {
        if (btnPwaInstall) btnPwaInstall.style.display = 'none';
        if (pwaFloatingBtn) pwaFloatingBtn.style.display = 'none';
        return;
    }

    // Capture native install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if (btnPwaInstall) btnPwaInstall.style.display = 'inline-flex';
        if (pwaFloatingBtn) pwaFloatingBtn.style.display = 'flex';
    });

    // Header Install button action
    if (btnPwaInstall) {
        btnPwaInstall.addEventListener('click', () => triggerPwaInstall());
    }

    // Floating discrete button action (bottom right corner)
    if (pwaFloatingBtn) {
        pwaFloatingBtn.addEventListener('click', () => triggerPwaInstall());
    }

    window.addEventListener('appinstalled', () => {
        console.log('[PWA] Aplicación instalada correctamente.');
        if (btnPwaInstall) btnPwaInstall.style.display = 'none';
        if (pwaFloatingBtn) pwaFloatingBtn.style.display = 'none';
        deferredPrompt = null;
    });
}

async function triggerPwaInstall() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const {
            outcome
        } = await deferredPrompt.userChoice;
        console.log(`[PWA] Respuesta del usuario a la instalación: ${outcome}`);
        deferredPrompt = null;
        const btnPwaInstall = document.getElementById('btnPwaInstall');
        const pwaFloatingBtn = document.getElementById('pwaFloatingBtn');
        if (outcome === 'accepted') {
            if (btnPwaInstall) btnPwaInstall.style.display = 'none';
            if (pwaFloatingBtn) pwaFloatingBtn.style.display = 'none';
        }
    } else {
        // Fallback for browsers/devices where beforeinstallprompt didn't fire (e.g. iOS Safari)
        openPwaGuideModal();
    }
}

function openPwaGuideModal() {
    const modal = document.getElementById('pwaGuideModal');
    const container = document.getElementById('pwaGuideSteps');
    if (!modal || !container) return;

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    if (isIOS || isSafari) {
        container.innerHTML = `
            <div class="pwa-guide-step-item">
                <div class="pwa-step-num">1</div>
                <div class="pwa-step-text">Toca el botón <strong>Compartir</strong> <i class="fa-solid fa-arrow-up-from-bracket"></i> en la barra de tu navegador.</div>
            </div>
            <div class="pwa-guide-step-item">
                <div class="pwa-step-num">2</div>
                <div class="pwa-step-text">Desplázate hacia abajo y selecciona <strong>"Agregar al inicio"</strong> <i class="fa-solid fa-plus-square"></i>.</div>
            </div>
            <div class="pwa-guide-step-item">
                <div class="pwa-step-num">3</div>
                <div class="pwa-step-text">Haz clic en <strong>"Agregar"</strong> en la esquina superior derecha para confirmar.</div>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="pwa-guide-step-item">
                <div class="pwa-step-num">1</div>
                <div class="pwa-step-text">Abre el menú de opciones de tu navegador (<i class="fa-solid fa-ellipsis-vertical"></i> o icono de tres puntos).</div>
            </div>
            <div class="pwa-guide-step-item">
                <div class="pwa-step-num">2</div>
                <div class="pwa-step-text">Selecciona la opción <strong>"Instalar Mítago"</strong> o <strong>"Agregar a la pantalla principal"</strong>.</div>
            </div>
            <div class="pwa-guide-step-item">
                <div class="pwa-step-num">3</div>
                <div class="pwa-step-text">Confirma la instalación para disfrutar de Mítago como app nativa sin conexión.</div>
            </div>
        `;
    }

    modal.classList.add('active');
}

function closePwaGuideModal() {
    const modal = document.getElementById('pwaGuideModal');
    if (modal) modal.classList.remove('active');
}

// NO_RESPONSIVO: Scaled Viewport for Desktop Window Resizing (Non-Responsive Zoom Fit)
function handleDesktopScaling() { // NO_RESPONSIVO
    const TARGET_WIDTH = 1360;
    const currentWidth = window.innerWidth;
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if (!isMobileDevice && currentWidth < TARGET_WIDTH) {
        const scale = currentWidth / TARGET_WIDTH;
        // document.documentElement.style.transform = `scale(${scale})`;
        // document.documentElement.style.transformOrigin = 'top left';
        // document.documentElement.style.width = `${TARGET_WIDTH}px`;
    } else {
        document.documentElement.style.transform = '';
        document.documentElement.style.transformOrigin = '';
        document.documentElement.style.width = '';
    }
}

window.addEventListener('resize', handleDesktopScaling); // NO_RESPONSIVO

// --- Initialization ---
function initApp() {
    handleDesktopScaling(); // NO_RESPONSIVO: Quitar esta línea al revertir a la versión responsiva
    registerServiceWorker();
    setupPwaInstallPrompt();
    setupStarfieldCanvas();
    setupEventListeners();
    setupAudioPlayerEvents();
    loadAlbumInfo();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

// --- Fetch & Load Album Info from projectInfo.json ---
async function loadAlbumInfo() {
    try {
        const response = await fetch('projectInfo.json?v=' + Date.now());
        if (response.ok) {
            const fetchedData = await response.json();
            if (fetchedData) {
                albumInfo = fetchedData;
                tracks = Array.isArray(fetchedData.tracks) ? fetchedData.tracks : [];
                renderAlbumDetails();
                renderAlbumSocials();
                renderArtistSocials();
                renderOtherAlbums();
                if (tracks.length > 0) {
                    renderTracklist();
                    setTrack(0, false);
                }
            }
        }
    } catch (err) {
        console.error("[PWA] Error al cargar projectInfo.json:", err);
    }
}

// --- Render Album & Project Info ---
function renderAlbumDetails() {
    if (!albumInfo) return;

    // Page Title
    if (albumInfo.artist_name && (albumInfo.album_title || albumInfo.project)) {
        document.title = `${albumInfo.artist_name} - ${albumInfo.album_title || albumInfo.project}`;
    }

    // Hero Section Details
    const artistNameElem = document.getElementById('artistName');
    if (artistNameElem && albumInfo.artist_name) {
        artistNameElem.textContent = albumInfo.artist_name;
    }

    const albumTitleElem = document.getElementById('albumTitle');
    if (albumTitleElem && (albumInfo.album_title || albumInfo.project)) {
        albumTitleElem.textContent = albumInfo.album_title || albumInfo.project;
    }

    const albumSubtitleElem = document.getElementById('albumSubtitle');
    if (albumSubtitleElem && albumInfo.project_info) {
        albumSubtitleElem.textContent = albumInfo.project_info;
    }

    const albumDescElem = document.getElementById('albumDesc');
    if (albumDescElem && albumInfo.album_description) {
        albumDescElem.textContent = albumInfo.album_description;
    }

    // Background Image
    const bgImage = document.querySelector('.bg-image');
    if (bgImage && albumInfo.project_cover) {
        bgImage.src = albumInfo.project_cover + '?v=' + Date.now();
    }

    // Concept / Project Section
    const conceptTitleElem = document.getElementById('conceptTitle');
    if (conceptTitleElem && (albumInfo.project || albumInfo.album_title)) {
        conceptTitleElem.textContent = albumInfo.project || albumInfo.album_title;
    }

    const projectInfoDesc = document.getElementById('projectInfoDesc');
    if (projectInfoDesc && (albumInfo.album_description || albumInfo.project_info)) {
        projectInfoDesc.textContent = albumInfo.album_description || albumInfo.project_info;
    }

    const artistNameLabel = document.getElementById('artistNameLabel');
    if (artistNameLabel && albumInfo.artist_name) {
        artistNameLabel.textContent = albumInfo.artist_name;
    }

    const statTracksCount = document.getElementById('statTracksCount');
    if (statTracksCount && albumInfo.tracks) {
        statTracksCount.textContent = albumInfo.tracks.length.toString().padStart(2, '0');
    }

    const aboutCoverImg = document.getElementById('aboutCoverImg');
    if (aboutCoverImg && albumInfo.album_cover) {
        aboutCoverImg.src = albumInfo.album_cover;
    }
}

// --- Render Album Social Platforms Bar ---
function renderAlbumSocials() {
    const socialsContainer = document.getElementById('albumSocials');
    if (!socialsContainer || !albumInfo || !albumInfo.album_social) return;

    socialsContainer.innerHTML = '';
    albumInfo.album_social.forEach(social => {
        const a = document.createElement('a');
        a.href = social.url;
        a.target = '_blank';
        a.className = 'platform-icon';
        a.title = social.name;
        a.innerHTML = `<i class="${social.icon}"></i>`;
        socialsContainer.appendChild(a);
    });

    const streetTeamBtn = document.createElement('a');
    streetTeamBtn.href = '#newsletter';
    streetTeamBtn.className = 'platform-icon text-icon';
    streetTeamBtn.title = 'Street Team / Info';
    streetTeamBtn.innerHTML = '<span>stt</span>';
    socialsContainer.appendChild(streetTeamBtn);
}

// --- Render Artist Social Links ---
function renderArtistSocials() {
    const socialsContainer = document.getElementById('artistSocials');
    if (!socialsContainer || !albumInfo || !albumInfo.artist_social) return;

    socialsContainer.innerHTML = '';
    albumInfo.artist_social.forEach(social => {
        const a = document.createElement('a');
        a.href = social.url;
        a.target = '_blank';
        a.className = 'artist-social-link';
        a.title = social.name;
        a.innerHTML = `<i class="${social.icon}"></i> <span>${social.name}</span>`;
        socialsContainer.appendChild(a);
    });
}

// --- Render Other Albums (Discography) ---
function renderOtherAlbums() {
    const discoGrid = document.getElementById('discoGrid');
    if (!discoGrid) return;

    discoGrid.innerHTML = '';

    const albumsList = (albumInfo && albumInfo.other_albums && albumInfo.other_albums.length > 0) ?
        albumInfo.other_albums : [{
                album_title: 'Próximamente',
                album_cover: 'assets/proximamente.png',
                album_info: 'Próximo Lanzamiento',
                landing_page: '#'
            },
            {
                album_title: 'Próximamente',
                album_cover: 'assets/proximamente.png',
                album_info: 'Próximo Lanzamiento',
                landing_page: '#'
            }
        ];

    albumsList.forEach((album) => {
        const title = album.album_title || album.title || 'Próximamente';
        let cover = album.album_cover || album.cover || '';
        const info = album.album_info || album.info || '';
        const landingPage = album.landing_page || '#';

        const titleNormalized = title.toLowerCase().trim();
        const isUpcoming = titleNormalized.includes('próxim') || titleNormalized.includes('proxim') || !cover;

        if (isUpcoming) {
            cover = 'assets/proximamente.png';
        }

        const card = document.createElement('div');
        card.className = 'disco-card';
        card.innerHTML = `
            <div class="disco-img-wrap">
                <img src="${cover}" alt="${title}">
                <div class="disco-overlay">
                    ${isUpcoming || landingPage === '#'
                        ? `<span class="btn-disco-play disabled" style="opacity:0.7; cursor:default; background:rgba(0,0,0,0.6); pointer-events:none;"><i class="fa-solid fa-clock"></i> Próximamente</span>`
                        : `<a href="${landingPage}" target="_blank" class="btn-disco-play" style="text-decoration:none;"><i class="fa-solid fa-arrow-up-right-from-square"></i> Ver Landing Page</a>`
                    }
                </div>
            </div>
            <div class="disco-details">
                <h4>${title}</h4>
                <p>${info}</p>
            </div>
        `;
        discoGrid.appendChild(card);
    });
}

// --- Render Dynamic Playlist ---
function renderTracklist() {
    const listElement = document.getElementById('heroTrackList');
    if (!listElement) return;

    const tracksToRender = (Array.isArray(tracks) && tracks.length > 0) ? tracks : [];

    if (tracksToRender.length === 0) return;

    const fragment = document.createDocumentFragment();

    tracksToRender.forEach((track, index) => {
        if (!track) return;
        const title = track.track_title || track.title || 'Canción';
        const artist = track.track_artist || track.artist || (albumInfo ? albumInfo.artist_name : 'Mítago');
        const trackNum = String(index + 1).padStart(2, '0');

        const li = document.createElement('li');
        li.className = `track-item ${index === currentTrackIndex ? 'active' : ''}`;
        li.dataset.index = index;

        li.innerHTML = `
            <button type="button" class="btn-track-play" title="Reproducir"><i class="${index === currentTrackIndex && isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play'}"></i></button>
            <span class="track-number">${trackNum}</span>
            <div class="track-info">
                <span class="track-name">${title}</span>
                <span class="track-artist">${artist}</span>
            </div>
        `;

        li.addEventListener('click', (e) => {
            if (e.target.closest('.btn-track-options')) return;

            if (currentTrackIndex === index) {
                togglePlayPause();
            } else {
                playTrack(index);
            }
        });

        fragment.appendChild(li);
    });

    listElement.innerHTML = '';
    listElement.appendChild(fragment);
}

// --- Format Utilities ---
function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// --- Audio Player Event Setup ---
function setupAudioPlayerEvents() {
    audioPlayer.addEventListener('timeupdate', () => {
        if (!audioPlayer.duration) return;
        const curTime = audioPlayer.currentTime;
        const durTime = audioPlayer.duration;

        const curTimeElem = document.getElementById('currentTime');
        const totalTimeElem = document.getElementById('totalTime');
        const seekSlider = document.getElementById('seekSlider');
        const seekBarFill = document.getElementById('seekBarFill');

        if (curTimeElem) curTimeElem.textContent = formatTime(curTime);
        if (totalTimeElem) totalTimeElem.textContent = formatTime(durTime);

        const seekPercent = (curTime / durTime) * 100;
        if (seekSlider) seekSlider.value = seekPercent || 0;
        if (seekBarFill) seekBarFill.style.width = `${seekPercent || 0}%`;
    });

    audioPlayer.addEventListener('loadedmetadata', () => {
        const totalTimeElem = document.getElementById('totalTime');
        if (totalTimeElem) totalTimeElem.textContent = formatTime(audioPlayer.duration);
    });

    audioPlayer.addEventListener('ended', () => {
        if (isRepeat) {
            audioPlayer.currentTime = 0;
            audioPlayer.play();
        } else {
            nextTrack();
        }
    });

    audioPlayer.addEventListener('play', () => {
        isPlaying = true;
        updateUI();
    });

    audioPlayer.addEventListener('pause', () => {
        isPlaying = false;
        updateUI();
    });

    audioPlayer.addEventListener('error', (e) => {
        console.error("[AudioPlayer] Error en la reproducción del archivo de audio:", audioPlayer.error);
    });
}

// --- Track Control Logic ---
function setTrack(index, autoPlay = true) {
    if (!tracks.length || index < 0 || index >= tracks.length) return;

    currentTrackIndex = index;
    const track = tracks[currentTrackIndex];

    audioPlayer.src = track.track_src || track.src;
    audioPlayer.load();

    updateUI();

    if (autoPlay) {
        audioPlayer.play().then(() => {
            isPlaying = true;
            updateUI();
        }).catch(err => {
            console.warn("Playback prevented or interrupted:", err);
            isPlaying = false;
            updateUI();
        });
    }
}

function playTrack(index) {
    if (index !== undefined && index !== currentTrackIndex) {
        setTrack(index, true);
    } else {
        audioPlayer.play().then(() => {
            isPlaying = true;
            updateUI();
        }).catch(err => {
            console.warn("Playback error:", err);
        });
    }
}

function pauseTrack() {
    audioPlayer.pause();
    isPlaying = false;
    updateUI();
}

function togglePlayPause() {
    if (isPlaying) {
        pauseTrack();
    } else {
        playTrack(currentTrackIndex);
    }
}

function nextTrack() {
    if (!tracks.length) return;
    if (isShuffle) {
        currentTrackIndex = Math.floor(Math.random() * tracks.length);
    } else if (isLoop) {
        currentTrackIndex = (currentTrackIndex + 1) % tracks.length;
    } else {
        if (currentTrackIndex < tracks.length - 1) {
            currentTrackIndex++;
        } else {
            pauseTrack();
            return;
        }
    }
    setTrack(currentTrackIndex, true);
}

function prevTrack() {
    if (!tracks.length) return;
    if (audioPlayer.currentTime > 5) {
        audioPlayer.currentTime = 0;
    } else {
        currentTrackIndex = (currentTrackIndex - 1 + tracks.length) % tracks.length;
        setTrack(currentTrackIndex, true);
    }
}

// --- UI Sync & Update ---
function updateUI() {
    if (!tracks.length) return;
    const track = tracks[currentTrackIndex];

    // Update Track List Highlights & Play Icons
    const trackItems = document.querySelectorAll('.track-item');
    trackItems.forEach((item, idx) => {
        const playBtnIcon = item.querySelector('.btn-track-play i');
        if (idx === currentTrackIndex) {
            item.classList.add('active');
            if (playBtnIcon) {
                playBtnIcon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
            }
        } else {
            item.classList.remove('active');
            if (playBtnIcon) playBtnIcon.className = 'fa-solid fa-play';
        }
    });

    // Smooth scroll active item into view ONLY inside heroTrackList (never window)
    const activeItem = document.querySelector('.track-item.active');
    const trackListContainer = document.getElementById('heroTrackList');
    if (activeItem && trackListContainer) {
        const itemTop = activeItem.offsetTop;
        const itemBottom = itemTop + activeItem.offsetHeight;
        const containerScrollTop = trackListContainer.scrollTop;
        const containerHeight = trackListContainer.clientHeight;

        if (containerHeight > 0) {
            if (itemTop < containerScrollTop) {
                trackListContainer.scrollTo({
                    top: itemTop,
                    behavior: 'smooth'
                });
            } else if (itemBottom > containerScrollTop + containerHeight) {
                trackListContainer.scrollTo({
                    top: itemBottom - containerHeight,
                    behavior: 'smooth'
                });
            }
        }
    }

    // Update Bottom Player Info & Cover Artwork
    const playerTitle = document.getElementById('playerTitle');
    if (playerTitle) playerTitle.textContent = track.track_title || track.title;

    const playerArtist = document.getElementById('playerArtist');
    if (playerArtist) playerArtist.textContent = track.track_artist || track.artist || (albumInfo ? albumInfo.artist_name : "Mítago");

    const playerTrackNumber = document.getElementById('playerTrackNumber');
    if (playerTrackNumber) {
        const trackNum = track.track_id !== undefined ? track.track_id + 1 : currentTrackIndex + 1;
        playerTrackNumber.textContent = String(trackNum).padStart(2, '0');
    }

    // Play/Pause Main Icon
    const mainPlayIcon = document.getElementById('mainPlayIcon');
    if (mainPlayIcon) mainPlayIcon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
}

// --- Event Listeners Setup ---
function setupEventListeners() {
    // Bottom Sticky Player Main Controls
    const btnMainPlay = document.getElementById('btnMainPlay');
    if (btnMainPlay) btnMainPlay.addEventListener('click', togglePlayPause);

    const btnNext = document.getElementById('btnNext');
    if (btnNext) btnNext.addEventListener('click', nextTrack);

    const btnPrev = document.getElementById('btnPrev');
    if (btnPrev) btnPrev.addEventListener('click', prevTrack);

    // Repeat & Loop Toggles
    const btnRepeat = document.getElementById('btnRepeat');
    const btnLoop = document.getElementById('btnLoop');

    if (btnRepeat) {
        btnRepeat.addEventListener('click', () => {
            isRepeat = !isRepeat;
            if (isRepeat) isLoop = false;
            btnRepeat.classList.toggle('active', isRepeat);
            if (btnLoop) btnLoop.classList.toggle('active', isLoop);
        });
    }

    if (btnLoop) {
        btnLoop.addEventListener('click', () => {
            isLoop = !isLoop;
            if (isLoop) isRepeat = false;
            btnLoop.classList.toggle('active', isLoop);
            if (btnRepeat) btnRepeat.classList.toggle('active', isRepeat);
        });
    }

    // Shuffle Toggle
    const btnShuffle = document.getElementById('btnShuffle');
    if (btnShuffle) {
        btnShuffle.addEventListener('click', () => {
            isShuffle = !isShuffle;
            btnShuffle.classList.toggle('active', isShuffle);
        });
    }

    // Seek Slider Input
    const seekSlider = document.getElementById('seekSlider');
    if (seekSlider) {
        seekSlider.addEventListener('input', (e) => {
            if (!audioPlayer.duration) return;
            const percent = parseFloat(e.target.value);
            audioPlayer.currentTime = (percent / 100) * audioPlayer.duration;
        });
    }

    // Volume Slider Input
    const volumeSlider = document.getElementById('volumeSlider');
    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            audioPlayer.volume = val;
            isMuted = val === 0;
            updateVolumeIcon(val);
        });
    }

    // Volume Mute Button
    const btnVolume = document.getElementById('btnVolume');
    if (btnVolume) {
        btnVolume.addEventListener('click', () => {
            const volumeSlider = document.getElementById('volumeSlider');
            if (isMuted) {
                const restoreVol = previousVolume > 0 ? previousVolume : 0.8;
                if (volumeSlider) volumeSlider.value = restoreVol;
                audioPlayer.volume = restoreVol;
                isMuted = false;
                updateVolumeIcon(restoreVol);
            } else {
                previousVolume = audioPlayer.volume;
                if (volumeSlider) volumeSlider.value = 0;
                audioPlayer.volume = 0;
                isMuted = true;
                updateVolumeIcon(0);
            }
        });
    }
}

function updateVolumeIcon(val) {
    const icon = document.getElementById('volumeIcon');
    if (!icon) return;
    if (val === 0) {
        icon.className = 'fa-solid fa-volume-xmark';
    } else if (val < 0.5) {
        icon.className = 'fa-solid fa-volume-low';
    } else {
        icon.className = 'fa-solid fa-volume-high';
    }
}

function playTrackFromDisco(index) {
    playTrack(index);
    // window.scrollTo({
    //     top: 0,
    //     behavior: 'smooth'
    // });
}

// --- Starfield Background Canvas Animation ---
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

    const numStars = 150;
    const stars = [];

    for (let i = 0; i < numStars; i++) {
        stars.push({
            x: Math.random() * width,
            y: Math.random() * height,
            radius: Math.random() * 1.5 + 0.5,
            alpha: Math.random(),
            speed: Math.random() * 0.02 + 0.005
        });
    }

    function animateStars() {
        ctx.clearRect(0, 0, width, height);

        stars.forEach(star => {
            star.alpha += star.speed;
            if (star.alpha > 1 || star.alpha < 0) {
                star.speed = -star.speed;
            }

            ctx.beginPath();
            ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${Math.abs(star.alpha)})`;
            ctx.fill();
        });

        requestAnimationFrame(animateStars);
    }

    animateStars();
}

// --- Modals & Forms ---
function openTicketModal(cityName) {
    const modalCityName = document.getElementById('modalCityName');
    if (modalCityName) modalCityName.textContent = cityName;
    const ticketModal = document.getElementById('ticketModal');
    if (ticketModal) ticketModal.classList.add('active');
}

function closeTicketModal() {
    const ticketModal = document.getElementById('ticketModal');
    if (ticketModal) ticketModal.classList.remove('active');
}

function confirmPurchase(zone) {
    const modalCityName = document.getElementById('modalCityName');
    const city = modalCityName ? modalCityName.textContent : '';
    alert(`¡Gracias! Has reservado tu entrada (${zone}) para el show de Mítago en ${city}. Te enviaremos la confirmación por correo.`);
    closeTicketModal();
}

function handleNewsletter(event) {
    event.preventDefault();
    const subscriberEmail = document.getElementById('subscriberEmail');
    const email = subscriberEmail ? subscriberEmail.value : '';
    const msg = document.getElementById('newsletterMsg');
    if (msg) msg.textContent = `¡Bienvenido a la tripulación estelar! Confirmación enviada a: ${email}`;
    const form = document.getElementById('newsletterForm');
    if (form) form.reset();
    setTimeout(() => {
        if (msg) msg.textContent = '';
    }, 6000);
}