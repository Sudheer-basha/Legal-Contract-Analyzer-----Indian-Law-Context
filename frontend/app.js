/* ============================================
   NyayaSutra 3D Futuristic UI - Main Application
   ============================================ */

const API_BASE = '/api';

function formatChatText(text) {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '8px';
    
    const lines = String(text || '').split('\n');
    let inList = false;
    let listElement = null;

    lines.forEach((line) => {
        let trimmed = line.trim();
        if (!trimmed) {
            if (inList) {
                inList = false;
                listElement = null;
            }
            const br = document.createElement('br');
            container.appendChild(br);
            return;
        }

        // Check for bullet list item
        const listMatch = trimmed.match(/^[\*\-\+]\s+(.+)/);
        if (listMatch) {
            if (!inList) {
                inList = true;
                listElement = document.createElement('ul');
                listElement.style.margin = '4px 0 4px 20px';
                listElement.style.padding = '0';
                listElement.style.listStyleType = 'disc';
                container.appendChild(listElement);
            }
            const li = document.createElement('li');
            li.style.color = 'inherit';
            li.style.marginBottom = '4px';
            li.innerHTML = parseInlineMarkdown(listMatch[1]);
            listElement.appendChild(li);
            return;
        }

        // Check for numbered list item
        const numListMatch = trimmed.match(/^\d+\.\s+(.+)/);
        if (numListMatch) {
            if (!inList) {
                inList = true;
                listElement = document.createElement('ol');
                listElement.style.margin = '4px 0 4px 20px';
                listElement.style.padding = '0';
                container.appendChild(listElement);
            }
            const li = document.createElement('li');
            li.style.color = 'inherit';
            li.style.marginBottom = '4px';
            li.innerHTML = parseInlineMarkdown(numListMatch[1]);
            listElement.appendChild(li);
            return;
        }

        if (inList) {
            inList = false;
            listElement = null;
        }

        // Check for headers
        const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
        if (headerMatch) {
            const level = headerMatch[1].length;
            const h = document.createElement(`h${Math.min(level + 1, 6)}`);
            h.style.color = 'white';
            h.style.margin = '12px 0 6px 0';
            h.style.fontWeight = '600';
            h.innerHTML = parseInlineMarkdown(headerMatch[2]);
            container.appendChild(h);
            return;
        }

        // Normal paragraph text
        const p = document.createElement('p');
        p.style.margin = '0';
        p.style.lineHeight = '1.6';
        p.innerHTML = parseInlineMarkdown(trimmed);
        container.appendChild(p);
    });

    return container;
}

function parseInlineMarkdown(text) {
    let html = String(text || '');
    
    // Escape HTML special chars to prevent XSS
    html = html
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    // Bold (**text**)
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Italic (*text*)
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // Inline code (`code`)
    html = html.replace(/`(.*?)`/g, '<code style="background: rgba(255,255,255,0.12); padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 90%; color: var(--secondary-neon);">$1</code>');

    return html;
}

// ============================================
// 0. AUTHENTICATION & INTERCEPTORS
// ============================================

const AuthSystem = {
    tokenKey: 'nyayasutra-auth-token',
    currentUser: null,
    chatMode: 'contract', // contract or general
    
    getToken() {
        try {
            return localStorage.getItem(this.tokenKey);
        } catch (e) {
            return this.tempToken || null;
        }
    },
    
    setToken(token) {
        try {
            localStorage.setItem(this.tokenKey, token);
        } catch (e) {
            this.tempToken = token;
        }
    },
    
    clearToken() {
        try {
            localStorage.removeItem(this.tokenKey);
        } catch (e) {
            this.tempToken = null;
        }
    },
    
    async checkSession() {
        const token = this.getToken();
        if (!token) {
            // Frictionless first load landing: auto-login as Advocate
            if (sessionStorage.getItem('nyayasutra-explicit-logout') === 'true') {
                this.showLogin();
            } else {
                console.log("No token found. Performing auto-login as Advocate preset...");
                await this.loginWithPreset('advocate');
            }
            return;
        }
        
        try {
            // Call /me with explicit Authorization header to avoid race conditions
            const res = await fetch(`${API_BASE}/auth/me`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (res.ok) {
                const user = await res.json();
                this.onLoginSuccess(token, user);
            } else {
                this.logout();
            }
        } catch (e) {
            console.error("Auth session validation failed:", e);
            if (sessionStorage.getItem('nyayasutra-explicit-logout') === 'true') {
                this.showLogin();
            } else {
                await this.loginWithPreset('advocate');
            }
        }
    },
    
    async loginWithPreset(role) {
        try {
            // Use global fetch (wrapped) for robustness; backend accepts preset-login without auth
            const res = await fetch(`${API_BASE}/auth/preset-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role })
            });
            if (res.ok) {
                const data = await res.json();
                this.onLoginSuccess(data.token, data.user);
                showToast(`Logged in as ${data.user.name} (${data.user.role})`);
            } else {
                const err = await res.json();
                this.showError(err.detail || "Login failed");
            }
        } catch (e) {
            this.showError("Failed to reach auth server");
        }
    },
    
    async loginWithCredentials(email, password) {
        try {
            const res = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            if (res.ok) {
                const data = await res.json();
                this.onLoginSuccess(data.token, data.user);
                showToast(`Logged in as ${data.user.name}`);
            } else {
                const err = await res.json();
                this.showError(err.detail || "Invalid credentials");
            }
        } catch (e) {
            this.showError("Failed to reach auth server");
        }
    },
    
    onLoginSuccess(token, user) {
        this.setToken(token);
        this.currentUser = user;
        sessionStorage.removeItem('nyayasutra-explicit-logout');
        
        // Hide login modal
        document.getElementById('login-overlay').style.display = 'none';
        
        // Update user profile display
        document.getElementById('display-user-name').innerText = user.name;
        document.getElementById('display-user-role').innerText = user.role.toUpperCase();
        
        // Adjust navigation visibility
        this.applyPermissions(user.role);
        
        // Reload dashboard components
        if (window.app) {
            if (window.app.clauseExplorer) window.app.clauseExplorer.loadContracts(true);
            if (window.app.reviewerQueue) window.app.reviewerQueue.refresh();
            if (window.app.chatInterface) window.app.chatInterface.loadContracts();
        }

        // Ensure admin tab becomes active for admin users. Use a small timeout
        // to allow TabSystem initialization and event listeners to settle.
        setTimeout(() => {
            try {
                if (user.role === 'admin') {
                    const adminNav = document.querySelector('.sidebar-nav .nav-item[data-tab="admin"]');
                    if (adminNav) {
                        // Prefer triggering the click handler so TabSystem.switchTab runs
                        adminNav.click();
                        // If the click did not set the active class (fallback), enforce it
                        if (!adminNav.classList.contains('active')) {
                            // Remove active from others
                            document.querySelectorAll('.sidebar-nav .nav-item').forEach(i => i.classList.remove('active'));
                            adminNav.classList.add('active');
                            // Show pane manually
                            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
                            const pane = document.getElementById('tab-admin');
                            if (pane) pane.classList.add('active');
                        }
                    }
                }
            } catch (e) {
                console.warn('Failed to auto-activate admin tab:', e);
            }
        }, 250);
    },
    
    applyPermissions(role) {
        const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
        let defaultTab = 'upload';
        
        navItems.forEach(item => {
            const tabName = item.getAttribute('data-tab');
            let visible = true;
            
            if (role === 'common') {
                // Citizen can only upload, explore, and chat
                if (tabName === 'reviewer' || tabName === 'metrics' || tabName === 'admin') {
                    visible = false;
                }
            } else if (role === 'judge') {
                // Judge reviews and sees metrics, but doesn't upload
                if (tabName === 'upload' || tabName === 'admin') {
                    visible = false;
                }
            } else if (role === 'advocate' || role === 'lawyer') {
                // Advocates and Lawyers see everything except the Admin tab
                if (tabName === 'admin') {
                    visible = false;
                }
            }
            
            if (visible) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
                item.classList.remove('active');
            }
        });
        
        // Choose default active tab based on role
        if (role === 'judge') {
            defaultTab = 'reviewer';
        } else if (role === 'admin') {
            defaultTab = 'admin';
        } else {
            defaultTab = 'upload';
        }
        
        // Activate default tab
        navItems.forEach(item => {
            if (item.getAttribute('data-tab') === defaultTab) {
                item.click();
            }
        });
        
        // Configure Dialogue AI modes
        const modeSelection = document.getElementById('chat-mode-selection-bar');
        const contractSelector = document.getElementById('chat-contract-selector-row');
        
        if (role === 'common') {
            if (modeSelection) modeSelection.style.display = 'none';
            if (contractSelector) contractSelector.style.display = 'flex';
            // Force Document Mode
            AuthSystem.setChatMode('contract');
        } else {
            if (modeSelection) modeSelection.style.display = 'flex';
            // Default to document mode
            AuthSystem.setChatMode('contract');
        }
        
        // Read-only features for explorer overrides and share/export options under Citizen role
        const overrideControls = document.querySelector('.explorer-reviewer-controls');
        const workspace = document.querySelector('.explorer-workspace');
        const shareBtn = document.getElementById('btn-share-contract');
        const exportBtn = document.getElementById('btn-export-pdf');
        
        if (role === 'common') {
            if (overrideControls) overrideControls.style.display = 'none';
            if (workspace) workspace.style.gridTemplateColumns = '1fr 1.2fr'; // 2-column fallback
            if (shareBtn) shareBtn.style.display = 'none';
            if (exportBtn) exportBtn.style.display = 'none';
        } else {
            if (overrideControls) overrideControls.style.display = ''; // Clear inline display to restore default 3rd column
            if (workspace) workspace.style.gridTemplateColumns = ''; // Clear inline style to restore stylesheet grid layout
            if (shareBtn) shareBtn.style.display = '';
            if (exportBtn) exportBtn.style.display = '';
        }
    },
    
    setChatMode(mode) {
        this.chatMode = mode;
        const btnContract = document.getElementById('btn-mode-contract');
        const btnGeneral = document.getElementById('btn-mode-general');
        const contractSelector = document.getElementById('chat-contract-selector-row');
        const workspaceContainer = document.getElementById('chat-workspace-container');
        const promptEmpty = document.getElementById('chat-prompt-empty');
        const userInput = document.getElementById('chat-user-input');
        const sendBtn = document.getElementById('btn-chat-send');
        
        if (mode === 'contract') {
            if (btnContract) btnContract.classList.add('active-toggle');
            if (btnGeneral) btnGeneral.classList.remove('active-toggle');
            if (contractSelector) contractSelector.style.display = 'flex';
            
            // Sync empty prompt
            const explorerSelect = document.getElementById('chat-contract-select');
            if (explorerSelect && explorerSelect.value) {
                if (workspaceContainer) workspaceContainer.style.display = 'flex';
                if (promptEmpty) promptEmpty.style.display = 'none';
            } else {
                if (workspaceContainer) workspaceContainer.style.display = 'none';
                if (promptEmpty) promptEmpty.style.display = 'flex';
            }
        } else {
            if (btnContract) btnContract.classList.remove('active-toggle');
            if (btnGeneral) btnGeneral.classList.add('active-toggle');
            if (contractSelector) contractSelector.style.display = 'none';
            
            // Show general workspace directly without contract check
            if (workspaceContainer) workspaceContainer.style.display = 'flex';
            if (promptEmpty) promptEmpty.style.display = 'none';
            if (userInput) {
                userInput.disabled = false;
                userInput.placeholder = "Ask general legal questions under Indian Law...";
            }
            if (sendBtn) sendBtn.disabled = false;
            
            // Load history
            if (window.app?.chatInterface) {
                window.app.chatInterface.loadGeneralHistory();
            }
        }
    },
    
    showLogin() {
        document.getElementById('login-overlay').style.display = 'flex';
        this.clearToken();
        this.currentUser = null;
    },
    
    showError(msg) {
        const errDiv = document.getElementById('login-error-msg');
        if (errDiv) {
            errDiv.innerText = msg;
            errDiv.style.display = 'block';
        }
    },
    
    logout() {
        this.clearToken();
        this.currentUser = null;
        sessionStorage.setItem('nyayasutra-explicit-logout', 'true');
        this.showLogin();
        const chatHist = document.getElementById('chat-history-container');
        if (chatHist) {
            chatHist.innerHTML = '';
        }
    }
};

// Expose AuthSystem globally to avoid timing/scope issues
try { window.AuthSystem = AuthSystem; } catch (e) { /* ignore */ }

// Global fetch wrapper to inject Auth header
const originalFetch = window.fetch;
window.fetch = function(url, options = {}) {
    // Try to read token from AuthSystem if available, otherwise fall back to localStorage.
    let token = null;
    try {
        if (typeof AuthSystem !== 'undefined' && AuthSystem && typeof AuthSystem.getToken === 'function') {
            token = AuthSystem.getToken();
        }
    } catch (e) {
        token = null;
    }
    if (!token) {
        try { token = localStorage.getItem('nyayasutra-auth-token'); } catch (e) { token = null; }
    }
    if (token) {
        if (!options.headers) {
            options.headers = {};
        }
        if (options.headers instanceof Headers) {
            options.headers.set('Authorization', `Bearer ${token}`);
        } else if (Array.isArray(options.headers)) {
            const hasAuth = options.headers.some(([key]) => key.toLowerCase() === 'authorization');
            if (!hasAuth) {
                options.headers.push(['Authorization', `Bearer ${token}`]);
            }
        } else {
            if (!options.headers['Authorization'] && !options.headers['authorization']) {
                options.headers['Authorization'] = `Bearer ${token}`;
            }
        }
    }
    return originalFetch(url, options);
};

// ============================================
// 1. THREE.JS BACKGROUND SCENE
// ============================================

class BackgroundScene {
    constructor() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth,
            window.innerHeight,
            0.1,
            1000
        );
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: true, 
            alpha: true,
            precision: 'highp'
        });
        
        this.init();
    }
    
    init() {
        this.camera.position.z = 50;
        
        const container = document.getElementById('three-js-container');
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(this.renderer.domElement);
        
        this.createParticles();
        this.createLegalSymbols();
        this.animate();
        
        window.addEventListener('resize', () => this.onWindowResize());
    }
    
    createParticles() {
        const particlesGeometry = new THREE.BufferGeometry();
        const particlesCount = 150;
        const posArray = new Float32Array(particlesCount * 3);
        
        for (let i = 0; i < particlesCount * 3; i += 3) {
            posArray[i] = (Math.random() - 0.5) * 200;
            posArray[i + 1] = (Math.random() - 0.5) * 200;
            posArray[i + 2] = (Math.random() - 0.5) * 200;
        }
        
        particlesGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        
        const particlesMaterial = new THREE.PointsMaterial({
            size: 0.5,
            color: 0x00d9ff,
            transparent: true,
            opacity: 0.5,
            sizeAttenuation: true
        });
        
        this.particlesMesh = new THREE.Points(particlesGeometry, particlesMaterial);
        this.scene.add(this.particlesMesh);
    }
    
    createLegalSymbols() {
        // Create floating legal scale symbols
        const symbolGeometry = new THREE.IcosahedronGeometry(2, 4);
        const symbolMaterial = new THREE.MeshPhongMaterial({
            color: 0x00ff88,
            emissive: 0x00d9ff,
            wireframe: false,
            transparent: true,
            opacity: 0.3
        });
        
        this.legalSymbols = [];
        for (let i = 0; i < 5; i++) {
            const symbol = new THREE.Mesh(symbolGeometry, symbolMaterial);
            symbol.position.set(
                (Math.random() - 0.5) * 150,
                (Math.random() - 0.5) * 150,
                (Math.random() - 0.5) * 100
            );
            symbol.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
            this.legalSymbols.push(symbol);
            this.scene.add(symbol);
        }
        
        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);
        
        const pointLight = new THREE.PointLight(0x00d9ff, 1, 100);
        pointLight.position.set(30, 30, 30);
        this.scene.add(pointLight);
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        // Rotate particles
        if (this.particlesMesh) {
            this.particlesMesh.rotation.x += 0.0001;
            this.particlesMesh.rotation.y += 0.0002;
        }
        
        // Rotate legal symbols
        this.legalSymbols.forEach((symbol, index) => {
            symbol.rotation.x += 0.001 + index * 0.0001;
            symbol.rotation.y += 0.0015 + index * 0.00015;
            symbol.position.y += Math.sin(Date.now() * 0.0001 + index) * 0.01;
        });
        
        this.renderer.render(this.scene, this.camera);
    }
    
    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

// ============================================
// 1B. 3D COMPLIANCE CORE - SCALES OF JUSTICE
// ============================================

class ScalesOfJustice3D {
    constructor() {
        this.container = document.getElementById('scales-3d-container');
        this.statusText = document.getElementById('scales-3d-status');
        if (!this.container || typeof THREE === 'undefined') {
            console.warn("Three.js or scales container not found. Bypassing 3D Compliance Core.");
            return;
        }

        this.width = this.container.clientWidth;
        this.height = this.container.clientHeight || 300;

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.scalesGroup = null;
        this.crossbeamGroup = null;
        this.leftAssembly = null;
        this.rightAssembly = null;
        
        // Parts for animation
        this.leftPan = null;
        this.rightPan = null;
        this.pointLight = null;
        this.glowMaterial = null;
        this.metallicMaterial = null;

        // Animation state variables
        this.state = 'STANDBY'; // STANDBY, INGESTION, COMPLIANCE
        this.currentTilt = 0;
        this.targetTilt = 0;
        this.rotationSpeed = 0.005;
        this.targetRotationSpeed = 0.005;
        
        this.colors = {
            STANDBY: { light: 0x00d9ff, emissive: 0x002233, status: 'SYSTEM: STANDBY // CALIBRATING SCALES...' },
            LOW: { light: 0x00ff88, emissive: 0x003311, status: 'COMPLIANCE: SECURE // LOW RISK DETECTED' },
            MEDIUM: { light: 0xffa500, emissive: 0x331e00, status: 'WARNING: VULNERABILITY // MEDIUM RISK DETECTED' },
            HIGH: { light: 0xff0055, emissive: 0x3b000a, status: 'CRITICAL: BREACH // HIGH RISK DETECTED' },
            INGESTION: { light: 0x00d9ff, emissive: 0x002233, status: 'INGESTING // RETRIEVING LEGAL CITATIONS...' }
        };

        this.currentColors = {
            light: new THREE.Color(this.colors.STANDBY.light),
            emissive: new THREE.Color(this.colors.STANDBY.emissive)
        };
        this.targetColors = {
            light: new THREE.Color(this.colors.STANDBY.light),
            emissive: new THREE.Color(this.colors.STANDBY.emissive)
        };

        this.init();
    }

    init() {
        try {
            // Create Scene
            this.scene = new THREE.Scene();

            // Camera
            this.camera = new THREE.PerspectiveCamera(45, this.width / this.height, 0.1, 100);
            this.camera.position.set(0, 3, 14);
            this.camera.lookAt(0, 1.8, 0);

            // Renderer
            this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            this.renderer.setSize(this.width, this.height);
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            this.container.appendChild(this.renderer.domElement);

            // Group to hold the entire scales model
            this.scalesGroup = new THREE.Group();
            this.scene.add(this.scalesGroup);

            // Materials
            this.glowMaterial = new THREE.MeshPhongMaterial({
                color: 0xffffff,
                emissive: this.colors.STANDBY.emissive,
                shininess: 100,
                specular: 0x00d9ff
            });

            this.metallicMaterial = new THREE.MeshStandardMaterial({
                color: 0x1e293b,
                metalness: 0.9,
                roughness: 0.2
            });

            // 1. Base (Pedestal)
            const baseGeo = new THREE.CylinderGeometry(2, 2.2, 0.4, 32);
            const base = new THREE.Mesh(baseGeo, this.metallicMaterial);
            base.position.y = -1.8;
            this.scalesGroup.add(base);

            const subBaseGeo = new THREE.CylinderGeometry(1.4, 1.7, 0.3, 32);
            const subBase = new THREE.Mesh(subBaseGeo, this.metallicMaterial);
            subBase.position.y = -1.5;
            this.scalesGroup.add(subBase);

            // 2. Main Vertical Pillar
            const pillarGeo = new THREE.CylinderGeometry(0.2, 0.26, 6, 16);
            const pillar = new THREE.Mesh(pillarGeo, this.metallicMaterial);
            pillar.position.y = 1.5;
            this.scalesGroup.add(pillar);

            // Decorative ring on pillar
            const ringGeo = new THREE.TorusGeometry(0.35, 0.08, 8, 24);
            const ring = new THREE.Mesh(ringGeo, this.metallicMaterial);
            ring.rotation.x = Math.PI / 2;
            ring.position.y = 2.8;
            this.scalesGroup.add(ring);

            // Top decorative sphere (Pivot point)
            const topSphereGeo = new THREE.SphereGeometry(0.4, 24, 24);
            const topSphere = new THREE.Mesh(topSphereGeo, this.glowMaterial);
            topSphere.position.y = 4.5;
            this.scalesGroup.add(topSphere);

            // 3. Crossbeam Group (pivots at topSphere)
            this.crossbeamGroup = new THREE.Group();
            this.crossbeamGroup.position.set(0, 4.5, 0); // Position at pivot
            this.scalesGroup.add(this.crossbeamGroup);

            // Crossbeam horizontal rod
            const beamGeo = new THREE.CylinderGeometry(0.12, 0.12, 7.6, 32);
            const beam = new THREE.Mesh(beamGeo, this.metallicMaterial);
            beam.rotation.z = Math.PI / 2; // Lie horizontally
            this.crossbeamGroup.add(beam);

            // Decorative end caps for beam
            const capGeo = new THREE.SphereGeometry(0.2, 16, 16);
            const leftCap = new THREE.Mesh(capGeo, this.glowMaterial);
            leftCap.position.set(-3.8, 0, 0);
            this.crossbeamGroup.add(leftCap);

            const rightCap = new THREE.Mesh(capGeo, this.glowMaterial);
            rightCap.position.set(3.8, 0, 0);
            this.crossbeamGroup.add(rightCap);

            // 4. Hangers and Pans (Left & Right)
            // Left assembly group
            this.leftAssembly = new THREE.Group();
            this.leftAssembly.position.set(-3.8, 0, 0);
            this.crossbeamGroup.add(this.leftAssembly); // Child of crossbeamGroup to tilt with it

            // Right assembly group
            this.rightAssembly = new THREE.Group();
            this.rightAssembly.position.set(3.8, 0, 0);
            this.crossbeamGroup.add(this.rightAssembly);

            // Hanger lines (we'll draw them as three thin cords forming a cone)
            const createHangers = (group) => {
                const lineMat = new THREE.LineBasicMaterial({ color: 0x00d9ff, transparent: true, opacity: 0.6 });
                
                // Draw three chains/strings holding the pans
                const points1 = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.6, -3, 0.35)];
                const points2 = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.6, -3, 0.35)];
                const points3 = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -3, -0.6)];

                const makeLine = (pts) => {
                    const geo = new THREE.BufferGeometry().setFromPoints(pts);
                    return new THREE.Line(geo, lineMat);
                };

                group.add(makeLine(points1));
                group.add(makeLine(points2));
                group.add(makeLine(points3));
            };

            createHangers(this.leftAssembly);
            createHangers(this.rightAssembly);

            // Left Pan (Tray)
            const panGeo = new THREE.CylinderGeometry(0.85, 0.75, 0.1, 32);
            this.leftPan = new THREE.Mesh(panGeo, this.glowMaterial);
            this.leftPan.position.y = -3.05;
            this.leftAssembly.add(this.leftPan);

            // Right Pan (Tray)
            this.rightPan = new THREE.Mesh(panGeo, this.glowMaterial);
            this.rightPan.position.y = -3.05;
            this.rightAssembly.add(this.rightPan);

            // Add Lighting
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
            this.scene.add(ambientLight);

            const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
            dirLight.position.set(3, 8, 5);
            this.scene.add(dirLight);

            // Point Light inside the scale for holographic neon glow
            this.pointLight = new THREE.PointLight(this.colors.STANDBY.light, 2.5, 12);
            this.pointLight.position.set(0, 2.5, 1.5);
            this.scene.add(this.pointLight);

            // Start render loop
            this.animate();
        } catch (err) {
            console.error("Error building 3D scales of justice model:", err);
        }
    }

    animate() {
        if (!this.renderer || !this.scene || !this.camera) return;
        requestAnimationFrame(() => this.animate());

        try {
            // Auto resize check if container dimensions change
            if (this.container && (this.container.clientWidth !== this.width || this.container.clientHeight !== this.height)) {
                this.onResize();
            }

            const time = Date.now() * 0.001;

            // Smoothly interpolate values (lerp)
            this.currentTilt += (this.targetTilt - this.currentTilt) * 0.08;
            this.rotationSpeed += (this.targetRotationSpeed - this.rotationSpeed) * 0.08;

            // Apply rotation to scales group
            if (this.scalesGroup) {
                this.scalesGroup.rotation.y += this.rotationSpeed;
            }

            // Apply tilt to crossbeam and cancel it for hangers
            if (this.crossbeamGroup && this.leftAssembly && this.rightAssembly) {
                this.crossbeamGroup.rotation.z = this.currentTilt;
                this.leftAssembly.rotation.z = -this.currentTilt;
                this.rightAssembly.rotation.z = -this.currentTilt;
            }

            // Standby/Hover animations
            if (this.state === 'STANDBY') {
                if (this.leftPan && this.rightPan) {
                    this.leftPan.position.y = -3.05 + Math.sin(time * 2) * 0.06;
                    this.rightPan.position.y = -3.05 + Math.sin(time * 2 + Math.PI) * 0.06;
                }
                this.targetTilt = Math.sin(time * 0.5) * 0.015;
            } else if (this.state === 'INGESTION') {
                if (this.leftPan && this.rightPan) {
                    this.leftPan.position.y = -3.05 + Math.sin(time * 20) * 0.12;
                    this.rightPan.position.y = -3.05 + Math.cos(time * 20) * 0.12;
                }
                this.targetTilt = Math.sin(time * 10) * 0.06;
            } else if (this.state === 'COMPLIANCE') {
                if (this.leftPan && this.rightPan) {
                    this.leftPan.position.y = -3.05 + Math.sin(time * 1.5) * 0.03;
                    this.rightPan.position.y = -3.05 + Math.sin(time * 1.5 + Math.PI) * 0.03;
                }
            }

            // Lerp colors
            if (this.currentColors.light && this.targetColors.light) {
                this.currentColors.light.lerp(this.targetColors.light, 0.08);
            }
            if (this.currentColors.emissive && this.targetColors.emissive) {
                this.currentColors.emissive.lerp(this.targetColors.emissive, 0.08);
            }

            if (this.pointLight) {
                this.pointLight.color.copy(this.currentColors.light);
                this.pointLight.intensity = 2.2 + Math.sin(time * 3) * 0.3;
            }

            if (this.glowMaterial) {
                this.glowMaterial.emissive.copy(this.currentColors.emissive);
            }

            this.renderer.render(this.scene, this.camera);
        } catch (err) {
            console.error("Error in ScalesOfJustice3D render loop:", err);
        }
    }

    setStandbyState() {
        this.state = 'STANDBY';
        this.targetRotationSpeed = 0.005;
        this.targetTilt = 0;
        this.targetColors.light.setHex(this.colors.STANDBY.light);
        this.targetColors.emissive.setHex(this.colors.STANDBY.emissive);
        this.updateStatus(this.colors.STANDBY.status, false);
    }

    setIngestionState() {
        this.state = 'INGESTION';
        this.targetRotationSpeed = 0.08; // Spin rapidly!
        this.targetColors.light.setHex(this.colors.INGESTION.light);
        this.targetColors.emissive.setHex(this.colors.INGESTION.emissive);
        this.updateStatus(this.colors.INGESTION.status, true);
    }

    setComplianceState(overallRisk) {
        this.state = 'COMPLIANCE';
        this.targetRotationSpeed = 0.002; // Spin very slowly
        
        let riskColor;
        let tiltVal;

        const normalizedRisk = (overallRisk || '').toUpperCase();

        if (normalizedRisk === 'LOW') {
            riskColor = this.colors.LOW;
            tiltVal = 0; // Balanced
        } else if (normalizedRisk === 'MEDIUM') {
            riskColor = this.colors.MEDIUM;
            tiltVal = -0.12; // Left tray slightly up, right tray down
        } else if (normalizedRisk === 'HIGH') {
            riskColor = this.colors.HIGH;
            tiltVal = -0.28; // Left tray significantly up, right tray heavily down
        } else {
            this.setStandbyState();
            return;
        }

        this.targetTilt = tiltVal;
        this.targetColors.light.setHex(riskColor.light);
        this.targetColors.emissive.setHex(riskColor.emissive);
        this.updateStatus(riskColor.status, false);
    }

    updateStatus(text, warningGlow) {
        if (!this.statusText) return;
        this.statusText.innerText = text;
        if (warningGlow) {
            this.statusText.style.color = 'var(--warning-neon)';
            this.statusText.style.textShadow = '0 0 8px var(--warning-neon)';
        } else {
            if (this.state === 'COMPLIANCE') {
                if (text.includes('LOW')) {
                    this.statusText.style.color = 'var(--secondary-neon)';
                    this.statusText.style.textShadow = '0 0 8px var(--secondary-neon)';
                } else if (text.includes('MEDIUM')) {
                    this.statusText.style.color = 'var(--warning-neon)';
                    this.statusText.style.textShadow = '0 0 8px var(--warning-neon)';
                } else {
                    this.statusText.style.color = 'var(--danger-neon)';
                    this.statusText.style.textShadow = '0 0 8px var(--danger-neon)';
                }
            } else {
                this.statusText.style.color = 'var(--primary-neon)';
                this.statusText.style.textShadow = '0 0 8px var(--primary-neon)';
            }
        }
    }

    onResize() {
        if (!this.container || !this.camera || !this.renderer) return;
        this.width = this.container.clientWidth;
        this.height = this.container.clientHeight || 300;
        
        this.camera.aspect = this.width / this.height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.width, this.height);
    }

    updateThemeColors(themeName) {
        if (themeName === 'cyber-neon') {
            this.colors.STANDBY = { light: 0x00d9ff, emissive: 0x002233, status: 'SYSTEM: STANDBY // CALIBRATING SCALES...' };
            this.colors.INGESTION = { light: 0x00d9ff, emissive: 0x002233, status: 'INGESTING // RETRIEVING LEGAL CITATIONS...' };
        } else if (themeName === 'emerald-court') {
            this.colors.STANDBY = { light: 0xd4af37, emissive: 0x332a00, status: 'SYSTEM: STANDBY // CALIBRATING SCALES...' };
            this.colors.INGESTION = { light: 0xd4af37, emissive: 0x332a00, status: 'INGESTING // RETRIEVING LEGAL CITATIONS...' };
        } else if (themeName === 'nordic-obsidian') {
            this.colors.STANDBY = { light: 0x38bdf8, emissive: 0x001b33, status: 'SYSTEM: STANDBY // CALIBRATING SCALES...' };
            this.colors.INGESTION = { light: 0x38bdf8, emissive: 0x001b33, status: 'INGESTING // RETRIEVING LEGAL CITATIONS...' };
        } else if (themeName === 'sunset-copper') {
            this.colors.STANDBY = { light: 0xf97316, emissive: 0x331700, status: 'SYSTEM: STANDBY // CALIBRATING SCALES...' };
            this.colors.INGESTION = { light: 0xf97316, emissive: 0x331700, status: 'INGESTING // RETRIEVING LEGAL CITATIONS...' };
        }

        // Trigger updates depending on current state
        if (this.state === 'STANDBY') {
            this.targetColors.light.setHex(this.colors.STANDBY.light);
            this.targetColors.emissive.setHex(this.colors.STANDBY.emissive);
            this.updateStatus(this.colors.STANDBY.status, false);
        } else if (this.state === 'INGESTION') {
            this.targetColors.light.setHex(this.colors.INGESTION.light);
            this.targetColors.emissive.setHex(this.colors.INGESTION.emissive);
            this.updateStatus(this.colors.INGESTION.status, true);
        }
    }
}

// ============================================
// 2. MOUSE INTERACTION & PARALLAX
// ============================================

class MouseInteraction {
    constructor() {
        this.mouseX = 0;
        this.mouseY = 0;
        this.cursor = document.getElementById('cursor-glow');
        
        document.addEventListener('mousemove', (e) => this.onMouseMove(e));
        document.addEventListener('mouseenter', () => this.onMouseEnter());
        document.addEventListener('mouseleave', () => this.onMouseLeave());
    }
    
    onMouseMove(e) {
        this.mouseX = e.clientX;
        this.mouseY = e.clientY;
        
        // Update cursor glow position
        if (this.cursor) {
            this.cursor.style.left = this.mouseX + 'px';
            this.cursor.style.top = this.mouseY + 'px';
        }
        
        // Parallax effect on cards
        this.applyParallax();
    }
    
    onMouseEnter() {
        document.body.classList.add('cursor-active');
    }
    
    onMouseLeave() {
        document.body.classList.remove('cursor-active');
    }
    
    applyParallax() {
        const cards = document.querySelectorAll('.card:hover');
        cards.forEach(card => {
            const rect = card.getBoundingClientRect();
            const cardCenterX = rect.left + rect.width / 2;
            const cardCenterY = rect.top + rect.height / 2;
            
            const angleX = (this.mouseY - cardCenterY) * 0.01;
            const angleY = (this.mouseX - cardCenterX) * 0.01;
            
            card.style.transform = `perspective(1000px) rotateX(${angleX}deg) rotateY(${angleY}deg)`;
        });
    }
}

// ============================================
// 3. TAB SYSTEM & NAVIGATION
// ============================================

class TabSystem {
    constructor() {
        this.navItems = document.querySelectorAll('.nav-item');
        this.tabPanes = document.querySelectorAll('.tab-pane');
        this.init();
    }
    
    init() {
        this.navItems.forEach(item => {
            item.addEventListener('click', (e) => this.switchTab(e));
        });
    }
    
    switchTab(e) {
        e.preventDefault();
        
        const tabName = e.currentTarget.getAttribute('data-tab');
        
        // Remove active class from all nav items
        this.navItems.forEach(item => item.classList.remove('active'));
        
        // Add active class to clicked nav item
        e.currentTarget.classList.add('active');
        
        // Hide all tab panes
        this.tabPanes.forEach(pane => pane.classList.remove('active'));
        
        // Show selected tab pane
        const selectedPane = document.getElementById(`tab-${tabName}`);
        if (selectedPane) {
            selectedPane.classList.add('active');
            
            // Trigger animations for visible elements
            this.animateTabContent(selectedPane);

            // Re-render charts when switching to metrics/observability tab
            if (tabName === 'metrics' && typeof MetricsSystem !== 'undefined') {
                MetricsSystem.refresh();
            }

            // Refresh user list when switching to admin tab
            if (tabName === 'admin' && window.app?.adminConsole) {
                window.app.adminConsole.refreshUsers();
            }
        }
    }
    
    animateTabContent(pane) {
        if (typeof VanillaTilt === 'undefined') return;
        // Re-initialize Vanilla Tilt for cards in this pane
        const vantaElements = pane.querySelectorAll('[data-tilt]');
        vantaElements.forEach(el => {
            if (el.vanillaTilt) {
                el.vanillaTilt.destroy();
            }
            VanillaTilt.init(el, {
                max: 15,
                scale: 1.05,
                speed: 400
            });
        });
    }
}

// ============================================
// 4. FILE UPLOAD & DRAG-DROP
// ============================================


class FileUpload {
    constructor() {
        this.dropZone = document.getElementById('file-drop-zone');
        this.fileInput = document.getElementById('file-input');

        if (this.dropZone && this.fileInput) {
            this.init();
        }
    }

    init() {
        this.dropZone.addEventListener('click', () => this.fileInput.click());
        this.dropZone.addEventListener('dragover', (e) => this.onDragOver(e));
        this.dropZone.addEventListener('dragleave', (e) => this.onDragLeave(e));
        this.dropZone.addEventListener('drop', (e) => this.onDrop(e));
        this.fileInput.addEventListener('change', (e) => this.onFileSelect(e));
    }

    onDragOver(e) {
        e.preventDefault();
        this.dropZone.classList.add('dragover');
        this.addPulseRings();
    }

    onDragLeave(e) {
        e.preventDefault();
        this.dropZone.classList.remove('dragover');
    }

    onDrop(e) {
        e.preventDefault();
        this.dropZone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        this.processFiles(files);
    }

    onFileSelect(e) {
        const files = e.target.files;
        this.processFiles(files);
        this.fileInput.value = ''; // Reset
    }

    processFiles(files) {
        Array.from(files).forEach(file => {
            if (file.name.endsWith('.pdf') || file.name.endsWith('.docx')) {
                this.uploadFile(file);
            } else {
                showToast("Only PDF and DOCX files are supported!");
            }
        });
    }

    async uploadFile(file) {
        if (window.gsap) {
            gsap.to(this.dropZone, {
                duration: 0.3,
                scale: 1.05,
                opacity: 0.8,
                onComplete: () => {
                    gsap.to(this.dropZone, {
                        duration: 0.3,
                        scale: 1,
                        opacity: 1
                    });
                }
            });
        }

        // Set 3D Compliance Core to ingestion state
        if (window.app?.scales3d) {
            window.app.scales3d.setIngestionState();
        }

        const formData = new FormData();
        formData.append('file', file);

        try {
            showToast(`Uploading ${file.name}...`);
            const response = await fetch(`${API_BASE}/contracts/upload`, {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                const result = await response.json();
                showToast(`Uploaded successfully! Analysis enqueued.`);
                
                if (window.app?.clauseExplorer) window.app.clauseExplorer.loadContracts(true);
                if (window.app?.reviewerQueue) window.app.reviewerQueue.refresh();
                if (window.app?.chatInterface) window.app.chatInterface.loadContracts();
            } else {
                const err = await response.json();
                alert(`Upload failed: ${err.detail || 'Unknown error'}`);
                if (window.app?.scales3d) window.app.scales3d.setStandbyState();
            }
        } catch (e) {
            console.error("Upload error:", e);
            alert("Failed to reach API server. Ensure backend is running.");
            if (window.app?.scales3d) window.app.scales3d.setStandbyState();
        }
    }

    addPulseRings() {
        const icon = this.dropZone.querySelector('.drop-zone-icon');
        if (!icon) return;

        for (let i = 0; i < 3; i++) {
            const ring = document.createElement('div');
            ring.style.cssText = `
                position: absolute;
                width: 60px;
                height: 60px;
                border: 2px solid rgba(0, 217, 255, 0.4);
                border-radius: 50%;
                animation: pulseRing 1s ease-out forwards;
                animation-delay: ${i * 0.2}s;
            `;
            this.dropZone.appendChild(ring);

            setTimeout(() => ring.remove(), 1000 + i * 200);
        }
    }
}
// ============================================
// 5. GSAP ANIMATIONS
// ============================================

class GSAPAnimations {
    static init() {
        this.registerScrollTrigger();
        this.animateMetrics();
        this.animateCards();
    }
    
    static registerScrollTrigger() {
        gsap.registerPlugin(ScrollTrigger);
    }
    
    static animateMetrics() {
        const metrics = document.querySelectorAll('.metric-stat-card h2');
        metrics.forEach((metric, index) => {
            const finalValue = parseInt(metric.textContent) || 0;
            const startValue = 0;
            
            gsap.from(metric, {
                duration: 1.5,
                delay: index * 0.1,
                textContent: startValue,
                snap: { textContent: 1 },
                ease: 'power2.out'
            });
        });
    }
    
    static animateCards() {
        const cards = document.querySelectorAll('.card');
        gsap.from(cards, {
            duration: 0.8,
            opacity: 0,
            y: 20,
            stagger: 0.1,
            ease: 'cubic.out'
        });
    }
}

// ============================================
// 6. 3D CARD TILT EFFECTS
// ============================================

class CardTilt {
    static init() {
        const tiltElements = document.querySelectorAll('[data-tilt]');
        tiltElements.forEach(element => {
            VanillaTilt.init(element, {
                max: 15,
                scale: 1.05,
                speed: 400,
                glare: true,
                'max-glare': 0.3
            });
        });
    }
    
    static initContractCards() {
        if (typeof gsap === 'undefined') return;
        const contractCards = document.querySelectorAll('.contract-item');
        contractCards.forEach(card => {
            card.addEventListener('mouseenter', () => {
                gsap.to(card, {
                    duration: 0.3,
                    y: -8,
                    boxShadow: '0 20px 50px rgba(0, 217, 255, 0.3)',
                    ease: 'power2.out'
                });
            });
            
            card.addEventListener('mouseleave', () => {
                gsap.to(card, {
                    duration: 0.3,
                    y: 0,
                    boxShadow: 'none',
                    ease: 'power2.out'
                });
            });
        });
    }
}
// ============================================
// 7. CLAUSE EXPLORER
// ============================================

class ClauseExplorer {
    constructor() {
        this.contractSelect = document.getElementById('explorer-contract-select');
        this.clausesList = document.getElementById('explorer-clauses-list');
        this.explorerContainer = document.getElementById('explorer-workspace-container');
        this.emptyState = document.getElementById('explorer-prompt-empty');

        // Right panel detail elements
        this.clauseCategory = document.getElementById('exp-clause-category');
        this.clauseRisk = document.getElementById('exp-clause-risk');
        this.clauseHindiBlock = document.getElementById('exp-translation-block');
        this.clauseHindi = document.getElementById('exp-clause-hindi');
        this.clauseEnglish = document.getElementById('exp-clause-english');
        
        // Side-by-side compare
        this.compUploaded = document.getElementById('comparison-uploaded');
        this.compTemplate = document.getElementById('comparison-template');
        this.compSimilarity = document.getElementById('exp-similarity-score');
        
        // Explanation
        this.clauseExplanation = document.getElementById('exp-clause-explanation');

        // Reviewer controls
        this.overrideRiskSelect = document.getElementById('override-risk-select');
        this.overrideComments = document.getElementById('override-comments');
        this.btnSubmitOverride = document.getElementById('btn-submit-override');
        this.contractAuditNotes = document.getElementById('contract-audit-notes');
        this.btnContractApprove = document.getElementById('btn-contract-approve');
        this.btnContractEscalate = document.getElementById('btn-contract-escalate');
        
        // Export PDF and Share
        this.btnExportPdf = document.getElementById('btn-export-pdf');
        this.btnShareContract = document.getElementById('btn-share-contract');

        // State variables
        this.selectedContractId = null;
        this.selectedClauseId = null;
        this.currentClauses = [];
        this.isUpdating = false;

        if (this.contractSelect) {
            this.init();
        }
    }

    init() {
        this.contractSelect.addEventListener('change', (e) => this.onContractSelect(e));
        this.btnSubmitOverride?.addEventListener('click', () => this.applyClauseOverride());
        this.btnContractApprove?.addEventListener('click', () => this.submitContractWorkflowAction("APPROVED"));
        this.btnContractEscalate?.addEventListener('click', () => this.submitContractWorkflowAction("ESCALATED"));
        this.btnExportPdf?.addEventListener('click', () => this.downloadPDFReport());

        this.loadContracts();
        // Periodically refresh contracts to update status (e.g. PROCESSING -> PENDING_REVIEW)
        setInterval(() => this.loadContracts(true), 5000);
    }

    async loadContracts(quiet = false) {
        try {
            const response = await fetch(`${API_BASE}/contracts`);
            if (!response.ok) return;
            const contracts = await response.json();
            
            this.isUpdating = true;
            
            // Preserve selection
            const prevVal = this.contractSelect.value;
            
            // Check if options have actually changed by comparing DOM option values/texts
            const currentOptionIds = Array.from(this.contractSelect.options).map(opt => opt.value);
            const currentOptionTexts = Array.from(this.contractSelect.options).map(opt => opt.text);
            
            const newOptionIds = ["", ...contracts.map(c => String(c.id))];
            const newOptionTexts = ["-- Select a contract to explore --", ...contracts.map(c => `${c.filename} (${c.status.replace('_', ' ')})`)];
            
            const optionsChanged = currentOptionIds.length !== newOptionIds.length ||
                currentOptionIds.some((id, idx) => id !== newOptionIds[idx]) ||
                currentOptionTexts.some((txt, idx) => txt !== newOptionTexts[idx]);

            if (optionsChanged) {
                let options = '<option value="">-- Select a contract to explore --</option>';
                contracts.forEach(c => {
                    options += `<option value="${c.id}">${c.filename} (${c.status.replace('_', ' ')})</option>`;
                });
                this.contractSelect.innerHTML = options;
                
                if (contracts.some(c => c.id == prevVal)) {
                    this.contractSelect.value = prevVal;
                } else if (prevVal) {
                    this.onContractSelect({ target: { value: '' } });
                }
                
                // Delay setting isUpdating = false to ignore browser-queued change events
                setTimeout(() => {
                    this.isUpdating = false;
                }, 50);
            } else {
                this.isUpdating = false;
            }

            // Check for active ingestion/processing jobs to sync with 3D Compliance Core
            const hasActiveJob = contracts.some(c => c.status === 'PENDING' || c.status === 'PROCESSING');
            if (hasActiveJob) {
                if (window.app?.scales3d && window.app.scales3d.state !== 'INGESTION') {
                    window.app.scales3d.setIngestionState();
                }
            } else {
                if (window.app?.scales3d && window.app.scales3d.state === 'INGESTION') {
                    const selectedId = this.selectedContractId;
                    if (selectedId) {
                        const selContract = contracts.find(c => c.id == selectedId);
                        if (selContract) {
                            window.app.scales3d.setComplianceState(selContract.overall_risk_score);
                        } else {
                            window.app.scales3d.setStandbyState();
                        }
                    } else {
                        window.app.scales3d.setStandbyState();
                    }
                }
            }

            // Sync repository list on upload portal
            const repoList = document.getElementById('contracts-list-container');
            if (repoList) {
                if (contracts.length === 0) {
                    repoList.innerHTML = `
                        <div class="empty-state">
                            <i data-lucide="file-question"></i>
                            <p>No contracts uploaded yet.</p>
                        </div>`;
                    if (window.lucide) lucide.createIcons();
                } else {
                    let html = '';
                    contracts.forEach(c => {
                        const timeStr = new Date(c.created_at).toLocaleString();
                        const sizeStr = c.overall_risk_score ? `Risk Assessment: ${c.overall_risk_score}` : 'Pending';
                        html += `
                            <div class="contract-item" style="cursor: pointer;">
                                <div class="contract-info">
                                    <div class="doc-icon"><i data-lucide="${c.file_type === 'pdf' ? 'file-text' : 'file-code'}"></i></div>
                                    <div class="doc-details">
                                        <span class="doc-name" title="${c.filename}">${c.filename}</span>
                                        <span class="doc-meta">${timeStr} | ${sizeStr}</span>
                                    </div>
                                </div>
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <span class="status-pill ${c.status.toLowerCase()}">${c.status.replace('_', ' ')}</span>
                                    <div class="contract-actions" style="display: flex; gap: 6px;">
                                        <button class="icon-btn btn-explore-item" title="Explore Clauses"><i data-lucide="file-search"></i></button>
                                        <button class="icon-btn btn-chat-item" title="Dialogue AI"><i data-lucide="messages-square"></i></button>
                                    </div>
                                </div>
                            </div>
                        `;
                    });
                    repoList.innerHTML = html;
                    if (window.lucide) lucide.createIcons();

                    // Attach click listener to each contract-item to open in explorer or chat
                    const items = repoList.querySelectorAll('.contract-item');
                    items.forEach((item, idx) => {
                        const c = contracts[idx];
                        if (!c) return;

                        // Click on card itself opens explorer
                        item.addEventListener('click', (e) => {
                            if (e.target.closest('.contract-actions')) return;
                            this.openContract(c.id);
                        });

                        // Explore button click
                        const expBtn = item.querySelector('.btn-explore-item');
                        expBtn?.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this.openContract(c.id);
                        });

                        // Chat button click
                        const chatBtn = item.querySelector('.btn-chat-item');
                        chatBtn?.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this.openContractInChat(c.id);
                        });
                    });
                }
            }

            // Handle URL-shared contract load once
            if (window.urlSharedContractId && contracts.some(c => c.id === window.urlSharedContractId)) {
                const targetId = window.urlSharedContractId;
                window.urlSharedContractId = null; // Clear so it only runs once
                
                // Clear query param in address bar
                window.history.replaceState({}, document.title, window.location.pathname);
                
                setTimeout(() => {
                    // Switch tab to Explorer
                    const explorerTabItem = document.querySelector('.nav-item[data-tab="explorer"]');
                    if (explorerTabItem) explorerTabItem.click();
                    
                    // Set select value and trigger change
                    this.contractSelect.value = targetId;
                    this.onContractSelect({ target: { value: targetId } });
                }, 100);
            }
        } catch (e) {
            if (!quiet) console.warn("Failed to load contracts:", e);
        }
    }

    async openContract(contractId) {
        // Force tab switch
        const explorerTabItem = document.querySelector('.nav-item[data-tab="explorer"]');
        if (explorerTabItem) explorerTabItem.click();

        this.contractSelect.value = contractId;
        this.onContractSelect({ target: { value: contractId } });
    }

    async openContractInChat(contractId) {
        // Force tab switch to Chat
        const chatTabItem = document.querySelector('.nav-item[data-tab="chat"]');
        if (chatTabItem) chatTabItem.click();

        if (window.app?.chatInterface) {
            window.app.chatInterface.chatSelect.value = contractId;
            window.app.chatInterface.onContractSelect({ target: { value: contractId } });
        }
    }

    async onContractSelect(e) {
        if (this.isUpdating) return;
        const contractId = e.target.value;
        
        if (this.selectedContractId === contractId) {
            return;
        }
        this.selectedContractId = contractId;

        // Sync selection with Chat dropdown
        if (window.app?.chatInterface) {
            const chatSelect = window.app.chatInterface.chatSelect;
            if (chatSelect && chatSelect.value !== contractId) {
                // Ensure option exists in chatSelect, otherwise add it dynamically
                let hasOption = Array.from(chatSelect.options).some(opt => opt.value === contractId);
                if (!hasOption && contractId) {
                    const optionName = e.target.options[e.target.selectedIndex]?.text || "Contract";
                    const newOpt = new Option(optionName, contractId);
                    chatSelect.add(newOpt);
                }
                chatSelect.value = contractId;
                window.app.chatInterface.onContractSelect({ target: { value: contractId } }, true);
            }
        }

        if (!contractId) {
            this.explorerContainer.style.display = 'none';
            this.emptyState.style.display = 'flex';
            if (this.btnExportPdf) this.btnExportPdf.disabled = true;
            if (this.btnShareContract) this.btnShareContract.disabled = true;
            
            // Revert 3D Compliance Core to standby
            if (window.app?.scales3d) {
                window.app.scales3d.setStandbyState();
            }
            return;
        }

        this.explorerContainer.style.display = 'grid';
        this.emptyState.style.display = 'none';
        
        if (this.btnExportPdf) this.btnExportPdf.disabled = false;
        if (this.btnShareContract) this.btnShareContract.disabled = false;

        await this.loadClauses(contractId);
    }

    async loadClauses(contractId, preserveSelection = false) {
        try {
            const response = await fetch(`${API_BASE}/contracts/${contractId}`);
            if (!response.ok) return;
            const details = await response.json();
            const contract = details.contract;
            this.currentClauses = details.clauses;

            // Update 3D Compliance Core scale alignment and color based on contract risk
            if (window.app?.scales3d) {
                window.app.scales3d.setComplianceState(contract.overall_risk_score);
            }

            if (this.contractAuditNotes) {
                this.contractAuditNotes.value = contract.review_notes || '';
            }

            this.clausesList.innerHTML = '';

            if (this.currentClauses.length === 0) {
                this.clausesList.innerHTML = `
                    <div class="empty-state">
                        <p>Analysis running or failed. Check back shortly.</p>
                    </div>`;
                return;
            }

            this.currentClauses.forEach(clause => {
                const clauseItem = document.createElement('div');
                clauseItem.className = `clause-item risk-${clause.risk_level}`;
                clauseItem.id = `clause-nav-${clause.id}`;
                
                const summaryText = clause.raw_text_english.substring(0, 100) + '...';
                clauseItem.innerHTML = `
                    <div class="clause-card-header">
                        <span class="clause-num">Clause #${clause.sequence_number} (Pg ${clause.page_number})</span>
                        <span class="clause-type-tag">${clause.clause_type}</span>
                    </div>
                    <p class="clause-snippet">${summaryText}</p>
                `;

                clauseItem.addEventListener('click', () => this.selectClause(clause.id));
                this.clausesList.appendChild(clauseItem);
            });

            // Select first or preserved clause automatically
            if (this.currentClauses.length > 0) {
                if (preserveSelection && this.selectedClauseId && this.currentClauses.some(c => c.id === this.selectedClauseId)) {
                    this.selectClause(this.selectedClauseId);
                } else {
                    this.selectClause(this.currentClauses[0].id);
                }
            }
        } catch (e) {
            console.error("Failed to load clauses:", e);
        }
    }

    selectClause(clauseId) {
        this.selectedClauseId = clauseId;

        // Un-highlight all
        this.clausesList.querySelectorAll('.clause-item').forEach(item => {
            item.classList.remove('active');
        });

        // Highlight selected
        const activeCard = document.getElementById(`clause-nav-${clauseId}`);
        if (activeCard) activeCard.classList.add('active');

        // Find clause details in local memory
        const clause = this.currentClauses.find(item => item.id === clauseId);
        if (!clause) return;

        // Animate details panel - responsive, fast fade transition
        if (window.gsap) {
            gsap.killTweensOf('.analysis-details-card');
            gsap.fromTo('.analysis-details-card', 
                { opacity: 0 },
                { duration: 0.1, opacity: 1, ease: 'power1.out', clearProps: 'all' }
            );
        }

        this.displayClauseDetails(clause);
    }

    displayClauseDetails(clause) {
        if (this.clauseCategory) this.clauseCategory.innerText = clause.clause_type;
        
        if (this.clauseRisk) {
            this.clauseRisk.innerText = `${clause.risk_level} RISK`;
            this.clauseRisk.className = `risk-pill ${clause.risk_level.toLowerCase()}`;
        }

        if (clause.raw_text_hindi) {
            if (this.clauseHindiBlock) this.clauseHindiBlock.style.display = 'block';
            if (this.clauseHindi) this.clauseHindi.innerText = clause.raw_text_hindi;
        } else {
            if (this.clauseHindiBlock) this.clauseHindiBlock.style.display = 'none';
        }

        if (this.clauseEnglish) this.clauseEnglish.innerText = clause.raw_text_english;
        if (this.compUploaded) this.compUploaded.innerText = clause.raw_text_english;
        if (this.compTemplate) this.compTemplate.innerText = clause.matched_template_clause || 'No similar template clause found.';
        
        if (this.compSimilarity) {
            const matchScore = Math.round(clause.similarity_score * 100);
            this.compSimilarity.innerText = `${matchScore}% Match`;
        }

        if (this.clauseExplanation) {
            this.clauseExplanation.innerHTML = clause.risk_explanation.replace(/\n/g, '<br/>');
        }

        // Set Reviewer Control options
        if (this.overrideRiskSelect) this.overrideRiskSelect.value = clause.risk_level;
        if (this.overrideComments) this.overrideComments.value = clause.reviewer_comments || '';
    }

    async applyClauseOverride() {
        if (!this.selectedClauseId) return;
        const riskLevel = this.overrideRiskSelect.value;
        const comments = this.overrideComments.value;

        if (!comments.trim()) {
            alert("Please provide audit review comments explaining the risk override.");
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/reviewer/clauses/${this.selectedClauseId}/override`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ risk_level: riskLevel, comments: comments })
            });

            if (response.ok) {
                showToast("Risk overridden successfully!");
                await this.loadClauses(this.selectedContractId, true);
                if (window.app?.reviewerQueue) window.app.reviewerQueue.refresh();
            } else {
                const err = await response.json();
                alert(`Override failed: ${err.detail}`);
            }
        } catch (e) {
            console.error(e);
        }
    }

    async submitContractWorkflowAction(action) {
        if (!this.selectedContractId) return;
        const notes = this.contractAuditNotes ? this.contractAuditNotes.value : '';

        try {
            const response = await fetch(`${API_BASE}/reviewer/contracts/${this.selectedContractId}/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: action, notes: notes })
            });

            if (response.ok) {
                showToast(`Contract review workflow state set to ${action}!`);
                await this.loadContracts(true);
                if (window.app?.reviewerQueue) window.app.reviewerQueue.refresh();
            } else {
                const err = await response.json();
                alert(`Failed: ${err.detail}`);
            }
        } catch (e) {
            console.error(e);
        }
    }

    async downloadPDFReport() {
        if (!this.selectedContractId) return;
        
        try {
            const checkRes = await fetch(`${API_BASE}/contracts`);
            if (checkRes.ok) {
                const contracts = await checkRes.json();
                const contractObj = contracts.find(c => c.id === this.selectedContractId);
                if (contractObj && contractObj.status === 'PENDING_REVIEW' && contractObj.overall_risk_score === 'HIGH') {
                    alert("Cannot Export PDF: This contract contains HIGH risk terms and must be Approved/Escalated by a reviewer first.");
                    return;
                }
            }
        } catch (e) {
            console.warn(e);
        }

        const url = `${API_BASE}/contracts/${this.selectedContractId}/report`;
        window.open(url, '_blank');
    }
}

// ============================================
// 8. CHAT INTERFACE
// ============================================

class ChatInterface {
    constructor() {
        this.chatSelect = document.getElementById('chat-contract-select');
        this.chatHistory = document.getElementById('chat-history-container');
        this.userInput = document.getElementById('chat-user-input');
        this.sendBtn = document.getElementById('btn-chat-send');
        this.chatWorkspace = document.getElementById('chat-workspace-container');
        this.chatPrompt = document.getElementById('chat-prompt-empty');
        this.selectedContractId = null;
        this.isUpdating = false;

        if (this.chatSelect) {
            this.init();
        }
    }

    init() {
        this.chatSelect.addEventListener('change', (e) => this.onContractSelect(e));
        this.sendBtn?.addEventListener('click', () => this.sendMessage());
        this.userInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.sendMessage();
            }
        });
        this.loadContracts();
    }

    async loadContracts() {
        try {
            const response = await fetch(`${API_BASE}/contracts`);
            if (!response.ok) return;
            const contracts = await response.json();
            
            this.isUpdating = true;
            
            // Preserve selection
            const prevVal = this.chatSelect.value;
            
            // Check if options have actually changed by comparing DOM option values/texts
            const currentOptionIds = Array.from(this.chatSelect.options).map(opt => opt.value);
            const currentOptionTexts = Array.from(this.chatSelect.options).map(opt => opt.text);
            
            const newOptionIds = ["", ...contracts.map(c => String(c.id))];
            const newOptionTexts = ["-- Select a contract to query --", ...contracts.map(c => c.filename)];
            
            const optionsChanged = currentOptionIds.length !== newOptionIds.length ||
                currentOptionIds.some((id, idx) => id !== newOptionIds[idx]) ||
                currentOptionTexts.some((txt, idx) => txt !== newOptionTexts[idx]);

            if (optionsChanged) {
                let options = '<option value="">-- Select a contract to query --</option>';
                contracts.forEach(c => {
                    options += `<option value="${c.id}">${c.filename}</option>`;
                });
                this.chatSelect.innerHTML = options;
                
                if (contracts.some(c => c.id == prevVal)) {
                    this.chatSelect.value = prevVal;
                } else if (prevVal) {
                    this.onContractSelect({ target: { value: '' } });
                }
                
                // Delay setting isUpdating = false to ignore browser-queued change events
                setTimeout(() => {
                    this.isUpdating = false;
                }, 50);
            } else {
                this.isUpdating = false;
            }
        } catch (e) {
            this.isUpdating = false;
            console.warn("Failed to load chat contracts:", e);
        }
    }

    onContractSelect(e, isSync = false) {
        if (this.isUpdating) return;
        
        // In General Counsel mode, don't reset chat when contract dropdown changes
        const mode = AuthSystem.chatMode || 'contract';
        if (mode === 'general') {
            return;
        }
        
        const contractId = e.target.value;

        // Sync selection with Clause Explorer dropdown
        if (!isSync && window.app?.clauseExplorer) {
            const explorerSelect = window.app.clauseExplorer.contractSelect;
            if (explorerSelect && explorerSelect.value !== contractId) {
                let hasOption = Array.from(explorerSelect.options).some(opt => opt.value === contractId);
                if (!hasOption && contractId) {
                    const optionName = e.target.options[e.target.selectedIndex]?.text || "Contract";
                    const newOpt = new Option(optionName, contractId);
                    explorerSelect.add(newOpt);
                }
                explorerSelect.value = contractId;
                window.app.clauseExplorer.onContractSelect({ target: { value: contractId } });
            }
        }

        if (this.selectedContractId === contractId) {
            return;
        }
        this.selectedContractId = contractId;

        if (!contractId) {
            this.chatWorkspace.style.display = 'none';
            this.chatPrompt.style.display = 'flex';
            this.userInput.disabled = true;
            this.sendBtn.disabled = true;
        } else {
            this.chatWorkspace.style.display = 'flex';
            this.chatPrompt.style.display = 'none';
            this.userInput.disabled = false;
            this.sendBtn.disabled = false;
            
            this.loadContractHistory(contractId);
        }
    }

    async loadContractHistory(contractId) {
        this.chatHistory.innerHTML = '<div class="chat-bubble assistant"><div class="bubble-meta">Dialogue AI</div><div class="bubble-content">Loading history...</div></div>';
        try {
            const response = await fetch(`${API_BASE}/chat/${contractId}`);
            if (response.ok) {
                const history = await response.json();
                this.chatHistory.innerHTML = '';
                if (history.length === 0) {
                    this.chatHistory.innerHTML = `
                        <div class="chat-bubble assistant">
                            <div class="bubble-meta">Dialogue AI</div>
                            <div class="bubble-content">
                                Context loaded. Ready to answer specific questions regarding this legal document. Try queries like: "Show me the termination clauses." or "Does this contain a non-compete?".
                            </div>
                        </div>
                    `;
                } else {
                    history.forEach(msg => {
                        this.addMessage(msg.message, msg.role, false);
                    });
                }
            } else {
                this.chatHistory.innerHTML = '<div class="chat-bubble assistant"><div class="bubble-meta">Dialogue AI</div><div class="bubble-content">Failed to load conversation history. Ready to accept new questions.</div></div>';
            }
        } catch (e) {
            console.warn("Failed to load contract chat history:", e);
            this.chatHistory.innerHTML = '<div class="chat-bubble assistant"><div class="bubble-meta">Dialogue AI</div><div class="bubble-content">Failed to connect to backend API.</div></div>';
        }
    }

    async loadGeneralHistory() {
        this.chatHistory.innerHTML = '<div class="chat-bubble assistant"><div class="bubble-meta">Dialogue AI</div><div class="bubble-content">Loading history...</div></div>';
        try {
            const response = await fetch(`${API_BASE}/chat/general`);
            if (response.ok) {
                const history = await response.json();
                this.chatHistory.innerHTML = '';
                if (history.length === 0) {
                    this.chatHistory.innerHTML = `
                        <div class="chat-bubble assistant">
                            <div class="bubble-meta">Dialogue AI</div>
                            <div class="bubble-content">
                                Welcome! I am your AI Legal Assistant. You can ask me general questions about Indian Law, such as contract rules, RERA provisions, or IT Acts.
                            </div>
                        </div>
                    `;
                } else {
                    history.forEach(msg => {
                        this.addMessage(msg.message, msg.role, false);
                    });
                }
            } else {
                this.chatHistory.innerHTML = '<div class="chat-bubble assistant"><div class="bubble-meta">Dialogue AI</div><div class="bubble-content">Failed to load conversation history. Ready to accept new questions.</div></div>';
            }
        } catch (e) {
            console.warn("Failed to load general chat history:", e);
            this.chatHistory.innerHTML = '<div class="chat-bubble assistant"><div class="bubble-meta">Dialogue AI</div><div class="bubble-content">Failed to connect to backend server.</div></div>';
        }
    }

    async sendMessage() {
        const mode = AuthSystem.chatMode || 'contract';
        const contractId = this.chatSelect.value;
        const message = this.userInput.value.trim();
        
        if (!message) return;
        if (mode === 'contract' && !contractId) return;

        this.addMessage(message, 'user');
        this.userInput.value = '';

        this.showTypingIndicator();

        try {
            let url = `${API_BASE}/chat/${contractId}`;
            if (mode === 'general') {
                url = `${API_BASE}/chat/general`;
            }
            
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: message })
            });

            this.removeTypingIndicator();

            if (response.ok) {
                const data = await response.json();
                this.addMessage(data.reply, 'assistant');
            } else {
                const err = await response.json();
                this.addMessage(`Error querying Dialogue agent: ${err.detail || 'Internal error'}`, 'assistant');
            }
        } catch (e) {
            this.removeTypingIndicator();
            this.addMessage('Failed connection to backend API.', 'assistant');
        }
    }

    addMessage(text, sender, animate = true) {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${sender}`;

        const meta = document.createElement('div');
        meta.className = 'bubble-meta';
        meta.innerText = sender === 'user' ? 'Client Request' : 'Dialogue AI';

        const content = document.createElement('div');
        content.className = 'bubble-content';
        content.appendChild(formatChatText(text));

        bubble.appendChild(meta);
        bubble.appendChild(content);
        this.chatHistory.appendChild(bubble);

        if (animate && window.gsap) {
            gsap.fromTo(bubble, 
                { opacity: 0, y: 10 },
                { duration: 0.15, opacity: 1, y: 0, ease: 'power2.out', clearProps: 'all' }
            );
        }

        this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
    }

    showTypingIndicator() {
        const indicator = document.createElement('div');
        indicator.className = 'chat-bubble assistant typing-indicator-bubble';
        indicator.innerHTML = `
            <div class="bubble-meta">Dialogue AI</div>
            <div class="typing-indicator">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        `;
        this.chatHistory.appendChild(indicator);
        this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
    }

    removeTypingIndicator() {
        const indicators = this.chatHistory.querySelectorAll('.typing-indicator-bubble');
        indicators.forEach(ind => ind.remove());
    }
}
// ============================================
// 9. REVIEWER QUEUE
// ============================================

class ReviewerQueue {
    constructor() {
        this.tbody = document.getElementById('reviewer-queue-tbody');
        this.pendingCount = document.getElementById('rev-pending-count');
        this.avgTime = document.getElementById('rev-avg-time');
        this.appRate = document.getElementById('rev-app-rate');
        if (this.tbody) {
            this.init();
        }
    }

    init() {
        this.refresh();
        setInterval(() => this.refresh(), 7000);
    }

    async refresh() {
        try {
            const response = await fetch(`${API_BASE}/reviewer/queue`);
            if (!response.ok) return;
            const queue = await response.json();
            
            if (this.pendingCount) this.pendingCount.innerText = queue.length;
            
            const badge = document.getElementById('queue-badge');
            if (badge) {
                badge.innerText = queue.length;
                badge.style.display = queue.length > 0 ? 'inline-block' : 'none';
            }

            if (queue.length === 0) {
                this.tbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="table-empty">
                            <i data-lucide="smile"></i> No contracts pending review.
                        </td>
                    </tr>`;
                if (window.lucide) lucide.createIcons();
                return;
            }

            let html = '';
            queue.forEach(c => {
                const timeStr = new Date(c.created_at).toLocaleString();
                html += `
                    <tr>
                        <td><b>${c.filename}</b></td>
                        <td>${timeStr}</td>
                        <td>${c.language.toUpperCase()}</td>
                        <td><span class="risk-pill ${c.overall_risk_score.toLowerCase()}">${c.overall_risk_score} RISK</span></td>
                        <td><span class="status-pill ${c.status.toLowerCase()}">${c.status.replace('_', ' ')}</span></td>
                        <td>
                            <button class="btn btn-secondary btn-icon" onclick="window.app.clauseExplorer.openContract('${c.id}')">
                                <i data-lucide="gavel"></i> Audit
                            </button>
                        </td>
                    </tr>
                `;
            });
            this.tbody.innerHTML = html;
            if (window.lucide) lucide.createIcons();
        } catch (e) {
            console.warn("Reviewer queue refresh failed:", e);
        }
    }
}

// ============================================
// 10. METRICS & CHARTS
// ============================================

class MetricsSystem {
    static initCharts() {
        this.riskChart = null;
        this.reviewerChart = null;
        this.refresh();
        setInterval(() => this.refresh(), 15000);
    }

    static async refresh() {
        try {
            const response = await fetch(`${API_BASE}/metrics`);
            if (!response.ok) return;
            const data = await response.json();

            const totalVal = document.getElementById('metric-total-contracts');
            const avgVal = document.getElementById('metric-avg-clauses');
            const escRateVal = document.getElementById('metric-escalation-rate');

            if (totalVal) totalVal.innerText = data.summary.total_contracts;
            if (avgVal) avgVal.innerText = data.summary.avg_clauses_per_contract;
            if (escRateVal) escRateVal.innerText = `${data.reviewer_metrics.escalation_rate_percent}%`;

            const revAvgTimeVal = document.getElementById('rev-avg-time');
            const revAppRateVal = document.getElementById('rev-app-rate');
            if (revAvgTimeVal) revAvgTimeVal.innerText = `${data.reviewer_metrics.avg_review_time_minutes}m`;
            if (revAppRateVal) revAppRateVal.innerText = `${data.reviewer_metrics.approval_rate_percent}%`;

            this.renderRiskChart(data.risk_distribution);
            this.renderReviewerChart(data.reviewer_metrics);

            const auditBody = document.getElementById('metrics-audit-tbody');
            if (auditBody) {
                if (data.audit_logs.length === 0) {
                    auditBody.innerHTML = `<tr><td colspan="4" class="table-empty">No audit trails logged.</td></tr>`;
                    return;
                }
                
                let html = '';
                data.audit_logs.forEach(log => {
                    html += `
                        <tr>
                            <td>${log.timestamp}</td>
                            <td><span class="status-pill pending">${log.event_type}</span></td>
                            <td>${log.contract_id || 'Global'}</td>
                            <td>${log.details}</td>
                        </tr>
                    `;
                });
                auditBody.innerHTML = html;
            }
        } catch (e) {
            console.warn("Metrics refresh failed:", e);
        }
    }

    static renderRiskChart(riskData) {
        if (typeof Chart === 'undefined') return;
        const ctx = document.getElementById('chart-risk-distribution');
        if (!ctx) return;

        if (this.riskChart) {
            this.riskChart.destroy();
        }

        this.riskChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Low Risk', 'Medium Risk', 'High Risk'],
                datasets: [{
                    data: [riskData.low, riskData.medium, riskData.high],
                    backgroundColor: [
                        'rgba(0, 255, 136, 0.8)',
                        'rgba(255, 165, 0, 0.8)',
                        'rgba(255, 0, 85, 0.8)'
                    ],
                    borderColor: [
                        'rgba(0, 255, 136, 1)',
                        'rgba(255, 165, 0, 1)',
                        'rgba(255, 0, 85, 1)'
                    ],
                    borderWidth: 2,
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        labels: {
                            color: '#e0e7ff',
                            font: { size: 12, weight: '600' }
                        }
                    }
                }
            }
        });
    }

    static renderReviewerChart(metrics) {
        if (typeof Chart === 'undefined') return;
        const ctx = document.getElementById('chart-reviewer-actions');
        if (!ctx) return;

        if (this.reviewerChart) {
            this.reviewerChart.destroy();
        }

        this.reviewerChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Approved', 'Escalated'],
                datasets: [{
                    label: 'Contracts',
                    data: [metrics.approved_count, metrics.escalated_count],
                    backgroundColor: [
                        'rgba(0, 255, 136, 0.8)',
                        'rgba(255, 0, 85, 0.8)'
                    ],
                    borderColor: [
                        'rgba(0, 255, 136, 1)',
                        'rgba(255, 0, 85, 1)'
                    ],
                    borderWidth: 2,
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                indexAxis: 'y',
                plugins: {
                    legend: {
                        labels: {
                            color: '#e0e7ff',
                            font: { size: 12, weight: '600' }
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(0, 217, 255, 0.1)' }
                    },
                    y: {
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(0, 217, 255, 0.1)' }
                    }
                }
            }
        });
    }
}

// ============================================
// 11. SHARE MODAL
// ============================================

class ShareModal {
    constructor() {
        this.shareBtn = document.getElementById('btn-share-contract');
        this.shareModal = document.getElementById('share-modal');
        this.closeBtn = document.getElementById('btn-close-share');
        this.copyBtn = document.getElementById('btn-copy-link');
        this.shareLink = document.getElementById('share-link-input');

        // Social links
        this.whatsappBtn = document.getElementById('share-whatsapp');
        this.gmailBtn = document.getElementById('share-gmail');
        this.telegramBtn = document.getElementById('share-telegram');
        this.emailClientBtn = document.getElementById('share-email-client');

        if (this.shareBtn) {
            this.init();
        }
    }

    init() {
        this.shareBtn.addEventListener('click', () => this.openModal());
        this.closeBtn?.addEventListener('click', () => this.closeModal());
        this.copyBtn?.addEventListener('click', () => this.copyLink());

        window.addEventListener('click', (e) => {
            if (e.target === this.shareModal) {
                this.closeModal();
            }
        });
    }

    openModal() {
        const explorerSelect = document.getElementById('explorer-contract-select');
        const contractId = explorerSelect ? explorerSelect.value : null;

        if (!contractId) {
            showToast("Please select a contract to share first!");
            return;
        }

        const shareUrl = `${window.location.origin}/?contract_id=${contractId}`;
        this.shareLink.value = shareUrl;

        // Dynamic share configurations
        const shareMsg = "Please review this Legal Contract Compliance Analysis: " + shareUrl;
        const subject = "Legal Contract Audit Report";
        const emailBody = "Please review the legal contract compliance analysis report at the following link:\n\n" + shareUrl;

        // WhatsApp
        if (this.whatsappBtn) {
            this.whatsappBtn.href = `https://wa.me/?text=${encodeURIComponent(shareMsg)}`;
        }

        // Gmail Web
        if (this.gmailBtn) {
            this.gmailBtn.href = `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailBody)}`;
        }

        // Telegram
        if (this.telegramBtn) {
            this.telegramBtn.href = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent("Please review this legal contract analysis report.")}`;
        }

        // Email Client
        if (this.emailClientBtn) {
            this.emailClientBtn.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailBody)}`;
        }

        // GSAP animate
        this.shareModal.style.display = 'flex';
        if (window.gsap) {
            gsap.killTweensOf(this.shareModal.querySelector('.modal-content'));
            gsap.fromTo(this.shareModal.querySelector('.modal-content'), 
                { opacity: 0, scale: 0.95 },
                { duration: 0.15, opacity: 1, scale: 1, ease: 'power2.out', clearProps: 'all' }
            );
        }
    }

    closeModal() {
        if (window.gsap) {
            gsap.killTweensOf(this.shareModal.querySelector('.modal-content'));
            gsap.to(this.shareModal.querySelector('.modal-content'), {
                duration: 0.1,
                opacity: 0,
                scale: 0.95,
                ease: 'power2.in',
                onComplete: () => {
                    this.shareModal.style.display = 'none';
                }
            });
        } else {
            this.shareModal.style.display = 'none';
        }
    }

    copyLink() {
        const input = this.shareLink;
        const copyBtn = this.copyBtn;

        const handleSuccess = () => {
            const prevHtml = copyBtn.innerHTML;
            copyBtn.innerHTML = '<i data-lucide="check"></i> Copied!';
            if (window.lucide) {
                lucide.createIcons();
            }
            showToast("Link copied to clipboard!");
            setTimeout(() => {
                copyBtn.innerHTML = prevHtml;
                if (window.lucide) {
                    lucide.createIcons();
                }
            }, 2000);
        };

        const handleFallback = () => {
            input.select();
            input.setSelectionRange(0, 99999);
            try {
                const successful = document.execCommand('copy');
                if (successful) {
                    handleSuccess();
                } else {
                    showToast("Failed to copy link. Please manually copy the input.");
                }
            } catch (err) {
                showToast("Failed to copy link. Please manually copy the input.");
            }
        };

        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(input.value).then(handleSuccess).catch(handleFallback);
        } else {
            handleFallback();
        }
    }
}

// ============================================
// 11B. ADMIN CONSOLE
// ============================================

class AdminConsole {
    constructor() {
        this.form = document.getElementById('admin-create-user-form');
        this.tbody = document.getElementById('admin-users-tbody');
        this.btnFlush = document.getElementById('btn-admin-flush-db');
        this.successMsg = document.getElementById('admin-user-success-msg');
        this.errorMsg = document.getElementById('admin-user-error-msg');
        
        if (this.form) {
            this.init();
        }
    }
    
    init() {
        this.form.addEventListener('submit', (e) => this.registerUser(e));
        this.btnFlush?.addEventListener('click', () => this.flushDatabase());

        // If Admin tab is already active when this console is initialized,
        // perform an immediate refresh so users are shown without manual click.
        try {
            setTimeout(() => {
                const pane = document.getElementById('tab-admin');
                if (pane && pane.classList.contains('active')) {
                    this.refreshUsers();
                }
            }, 250);

            // Also poll briefly in case the tab becomes active shortly after init
            let attempts = 0;
            const poll = setInterval(() => {
                const p = document.getElementById('tab-admin');
                if (p && p.classList.contains('active')) {
                    this.refreshUsers();
                    clearInterval(poll);
                }
                attempts += 1;
                if (attempts > 10) clearInterval(poll);
            }, 300);
        } catch (e) {
            console.warn('AdminConsole init check failed:', e);
        }
    }
    
    async refreshUsers() {
        if (!this.tbody) return;
        this.tbody.innerHTML = '<tr><td colspan="4" class="table-empty">Loading active system users...</td></tr>';
        
        try {
            // Ensure Authorization header is explicitly provided using AuthSystem
            const token = AuthSystem.getToken && AuthSystem.getToken();
            const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
            const res = await fetch('/api/auth/users', { headers });
            if (res.ok) {
                const users = await res.json();
                if (users.length === 0) {
                    this.tbody.innerHTML = '<tr><td colspan="4" class="table-empty">No users registered in system.</td></tr>';
                } else {
                    let html = '';
                    users.forEach(u => {
                        const dateStr = new Date(u.created_at).toLocaleDateString();
                        html += `
                            <tr>
                                <td><span style="font-weight: 600; color: white;">${u.name}</span></td>
                                <td>${u.email}</td>
                                <td><span class="category-tag" style="background: rgba(0, 217, 255, 0.1); border: 1px solid rgba(0, 217, 255, 0.2);">${u.role.toUpperCase()}</span></td>
                                <td>${dateStr}</td>
                            </tr>
                        `;
                    });
                    this.tbody.innerHTML = html;
                }
            } else {
                // Try to surface backend error details to aid debugging
                let detail = `Failed to load users list (status ${res.status})`;
                try {
                    const errObj = await res.json();
                    if (errObj && errObj.detail) detail = `${detail}: ${errObj.detail}`;
                } catch (e) {
                    // ignore
                }
                this.tbody.innerHTML = `<tr><td colspan="4" class="table-empty" style="color: var(--danger-neon);">${detail}</td></tr>`;
            }
        } catch (e) {
            console.error("Failed to load admin users:", e);
            this.tbody.innerHTML = '<tr><td colspan="4" class="table-empty" style="color: var(--danger-neon);">Failed to connect to system database.</td></tr>';
        }
    }
    
    async registerUser(e) {
        e.preventDefault();
        this.successMsg.style.display = 'none';
        this.errorMsg.style.display = 'none';
        
        const name = document.getElementById('admin-user-name').value;
        const email = document.getElementById('admin-user-email').value;
        const password = document.getElementById('admin-user-password').value;
        const role = document.getElementById('admin-user-role').value;
        
        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password, role })
            });
            
            if (res.ok) {
                const data = await res.json();
                this.successMsg.innerText = `User account registered for ${name} (${role})!`;
                this.successMsg.style.display = 'block';
                this.form.reset();
                this.refreshUsers();
                showToast("New user registered successfully! Opening dashboard...");
                
                // Automatically log in as the newly created user and switch to their dashboard
                setTimeout(() => {
                    AuthSystem.onLoginSuccess(data.token, data.user);
                }, 1200);
            } else {
                const err = await res.json();
                this.errorMsg.innerText = err.detail || "Registration failed.";
                this.errorMsg.style.display = 'block';
            }
        } catch (e) {
            this.errorMsg.innerText = "Connection error. Failed to register user.";
            this.errorMsg.style.display = 'block';
        }
    }
    
    async flushDatabase() {
        if (!confirm("CRITICAL WARNING: Are you absolutely sure you want to wipe the system database? This action is irreversible and clears all documents and audit logs.")) {
            return;
        }
        
        try {
            showToast("Wiping database...");
            const res = await fetch('/api/contracts/flush', {
                method: 'DELETE'
            });
            
            if (res.ok) {
                showToast("System database wiped successfully!");
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            } else {
                const err = await res.json();
                alert(`Failed to flush database: ${err.detail}`);
            }
        } catch (e) {
            console.error("Flush database failure:", e);
            alert("Failed to reach flush API endpoint.");
        }
    }
}

// Expose AdminConsole globally so it can be instantiated from other contexts
try { window.AdminConsole = AdminConsole; } catch (e) { /* ignore */ }

// ============================================
// 12. INITIALIZE APPLICATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    try {
        // Check for shared contract URL query param
        const urlParams = new URLSearchParams(window.location.search);
        window.urlSharedContractId = urlParams.get('contract_id');

        // 3D compliance core scales of justice bypassed
        let scales3d = null;

        // Initialize tab system
        let tabSystem;
        try {
            tabSystem = new TabSystem();
        } catch (e) {
            console.error("Failed to initialize tab system:", e);
        }

        // Initialize file upload
        let fileUpload;
        try {
            fileUpload = new FileUpload();
        } catch (e) {
            console.error("Failed to initialize file upload:", e);
        }

        // Initialize clause explorer
        let clauseExplorer;
        try {
            clauseExplorer = new ClauseExplorer();
        } catch (e) {
            console.error("Failed to initialize clause explorer:", e);
        }

        // Initialize chat interface
        let chatInterface;
        try {
            chatInterface = new ChatInterface();
        } catch (e) {
            console.error("Failed to initialize chat interface:", e);
        }

        // Initialize reviewer queue
        let reviewerQueue;
        try {
            reviewerQueue = new ReviewerQueue();
        } catch (e) {
            console.error("Failed to initialize reviewer queue:", e);
        }

        // Initialize metrics and charts
        try {
            if (typeof Chart !== 'undefined') {
                MetricsSystem.initCharts();
            } else {
                console.warn("Chart.js not loaded. Bypassing charts.");
            }
        } catch (e) {
            console.error("Failed to initialize metrics and charts:", e);
        }

        // Initialize share modal
        let shareModal;
        try {
            shareModal = new ShareModal();
        } catch (e) {
            console.error("Failed to initialize share modal:", e);
        }

        // Initialize admin console
        let adminConsole;
        try {
            adminConsole = new AdminConsole();
        } catch (e) {
            console.error("Failed to initialize admin console:", e);
        }

        // Initialize Theme Switcher
        try {
            const themeSelector = document.getElementById('theme-selector');
            if (themeSelector) {
                // Safe Storage wrapper in case tracking prevention blocks localStorage
                const safeGetItem = (key) => {
                    try {
                        return localStorage.getItem(key);
                    } catch (err) {
                        console.warn("Storage access blocked by browser tracking prevention. Falling back to default.");
                        return null;
                    }
                };
                const safeSetItem = (key, value) => {
                    try {
                        localStorage.setItem(key, value);
                    } catch (err) {
                        console.warn("Unable to save theme preference in localStorage:", err);
                    }
                };

                // Load saved theme or use default
                const savedTheme = safeGetItem('nyayasutra-theme') || 'cyber-neon';
                themeSelector.value = savedTheme;
                document.body.className = `theme-${savedTheme}`;
                
                themeSelector.addEventListener('change', (e) => {
                    const newTheme = e.target.value;
                    document.body.className = `theme-${newTheme}`;
                    safeSetItem('nyayasutra-theme', newTheme);
                    
                    // Sync with 3D compliance core if active
                    if (scales3d && typeof THREE !== 'undefined') {
                        scales3d.updateThemeColors(newTheme);
                    }
                });
                
                // Sync with 3D compliance core on initial load
                if (scales3d && typeof THREE !== 'undefined') {
                    scales3d.updateThemeColors(savedTheme);
                }
            }
        } catch (e) {
            console.error("Failed to initialize theme switcher:", e);
        }
        // Make instances global so they can interact
        window.app = {
            clauseExplorer,
            chatInterface,
            reviewerQueue,
            shareModal,
            scales3d,
            adminConsole
        };

        // Wire auth listeners
        const presetBtns = document.querySelectorAll('.btn-preset-login');
        presetBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const role = e.currentTarget.getAttribute('data-preset');
                AuthSystem.loginWithPreset(role);
            });
        });

        const loginForm = document.getElementById('login-credentials-form');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const email = document.getElementById('login-email').value;
                const password = document.getElementById('login-password').value;
                AuthSystem.loginWithCredentials(email, password);
            });
        }

        // Login Overlay tab switcher
        const btnTabSignin = document.getElementById('btn-login-tab-signin');
        const btnTabSignup = document.getElementById('btn-login-tab-signup');
        const sectionSignin = document.getElementById('login-signin-section');
        const sectionSignup = document.getElementById('login-signup-section');
        const errDiv = document.getElementById('login-error-msg');

        if (btnTabSignin && btnTabSignup) {
            btnTabSignin.addEventListener('click', () => {
                btnTabSignin.className = 'btn active-toggle';
                btnTabSignup.className = 'btn btn-secondary';
                if (sectionSignin) sectionSignin.style.display = 'block';
                if (sectionSignup) sectionSignup.style.display = 'none';
                if (errDiv) errDiv.style.display = 'none';
            });

            btnTabSignup.addEventListener('click', () => {
                btnTabSignup.className = 'btn active-toggle';
                btnTabSignin.className = 'btn btn-secondary';
                if (sectionSignin) sectionSignin.style.display = 'none';
                if (sectionSignup) sectionSignup.style.display = 'block';
                if (errDiv) errDiv.style.display = 'none';
            });
        }

        // Register form handler in Login Overlay
        const registerForm = document.getElementById('login-register-form');
        if (registerForm) {
            registerForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                if (errDiv) errDiv.style.display = 'none';

                const name = document.getElementById('register-name').value;
                const email = document.getElementById('register-email').value;
                const password = document.getElementById('register-password').value;
                const role = document.getElementById('register-role').value;

                try {
                    const res = await fetch('/api/auth/register', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, email, password, role })
                    });
                    
                    if (res.ok) {
                        const data = await res.json();
                        showToast(`Account created for ${name}! Logging in...`);
                        // Auto login
                        AuthSystem.onLoginSuccess(data.token, data.user);
                    } else {
                        const err = await res.json();
                        AuthSystem.showError(err.detail || "Registration failed.");
                    }
                } catch (err) {
                    console.error(err);
                    AuthSystem.showError("Connection error. Failed to create account.");
                }
            });
        }

        const logoutBtn = document.getElementById('btn-logout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                AuthSystem.logout();
            });
        }

        const btnModeContract = document.getElementById('btn-mode-contract');
        const btnModeGeneral = document.getElementById('btn-mode-general');
        if (btnModeContract) {
            btnModeContract.addEventListener('click', () => {
                AuthSystem.setChatMode('contract');
            });
        }
        if (btnModeGeneral) {
            btnModeGeneral.addEventListener('click', () => {
                AuthSystem.setChatMode('general');
            });
        }

        // Run session check on start
        AuthSystem.checkSession();

        console.log('🚀 NyayaSutra 3D Futuristic UI fully integrated and initialized');
    } catch (e) {
        console.error('Application initialization failed:', e);
        try { window.__appInitError = e && e.stack ? e.stack : String(e); } catch (ex) { /* ignore */ }
    }
});

// ============================================
// 13. UTILITY FUNCTIONS
// ============================================

// Add CSS animation for pulse rings
const style = document.createElement('style');
style.textContent = `
    @keyframes pulseRing {
        0% {
            width: 0;
            height: 0;
            opacity: 1;
        }
        100% {
            width: 100px;
            height: 100px;
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        bottom: 30px;
        right: 30px;
        background: rgba(18, 22, 36, 0.9);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(0, 217, 255, 0.3);
        color: #fff;
        padding: 12px 24px;
        border-radius: 8px;
        box-shadow: 0 8px 32px 0 rgba(0, 217, 255, 0.15);
        z-index: 99999;
        font-family: 'Inter', sans-serif;
        font-size: 14px;
        font-weight: 600;
        opacity: 0;
        transform: translateY(20px);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    `;
    
    toast.innerText = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    }, 50);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Handle window resize
window.addEventListener('resize', () => {
    // Reflow layouts if necessary
});
