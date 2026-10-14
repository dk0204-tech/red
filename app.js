/* ==========================================================================
   MANU PROTOCOL — MAIN APP LOGIC & STATE CONTROLLER
   Single-Page Reactive State Engine with LocalStorage Persistence
   ========================================================================== */

(function(window) {
    'use strict';

    // Game Global State
    const AppState = {
        currentView: 'hub', // 'hub', 'sector', 'passage'
        activeSectorId: 'community',
        solvedCTFs: new Set(),
        unlockedSectors: new Set(['community']),
        repairedRecordsCount: 0,
        selectedTeam: new Set(), // Set of Sanctuary IDs (max 10)
        timeRemainingSeconds: 24 * 3600, // 24:00:00 countdown (legacy field, migrated below)
        timerEndsAt: null, // timestamp-based deadline (epoch ms) — authoritative source
        isMLTrained: false
    };

    function getResolvedTeamId() {
        try {
            const p = new URLSearchParams(window.location.search);
            const urlTeam = (p.get('team') || p.get('teamId') || '').trim().toUpperCase();
            let stored = (sessionStorage.getItem('manu_team_id') || localStorage.getItem('manu_team_id') || '').trim().toUpperCase();
            if (stored === 'TECHTEAM10328' && urlTeam !== 'TECHTEAM10328') {
                try { localStorage.removeItem('manu_team_id'); } catch (_) {}
                try { sessionStorage.removeItem('manu_team_id'); } catch (_) {}
                stored = '';
            }
            const effective = urlTeam || (stored !== 'TECHTEAM10328' ? stored : '');
            if (effective && effective !== 'TECHTEAM10328') {
                try { localStorage.setItem('manu_team_id', effective); } catch (e) {}
            }
            return effective;
        } catch (e) { return ''; }
    }

    const resolvedTeam = getResolvedTeamId();
    const STORAGE_KEY = resolvedTeam ? ('MANU_PROTOCOL_SAVE_' + resolvedTeam) : 'MANU_PROTOCOL_SAVE_V1';

    // --- State Persistence ---
    function saveState() {
        const payload = {
            solvedCTFs: Array.from(AppState.solvedCTFs),
            unlockedSectors: Array.from(AppState.unlockedSectors),
            selectedTeam: Array.from(AppState.selectedTeam),
            timeRemainingSeconds: AppState.timeRemainingSeconds,
            timerEndsAt: AppState.timerEndsAt,
            isMLTrained: AppState.isMLTrained
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch (e) {
            console.warn('LocalStorage save failed:', e);
        }
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed.solvedCTFs) AppState.solvedCTFs = new Set(parsed.solvedCTFs);
                if (parsed.unlockedSectors) AppState.unlockedSectors = new Set(parsed.unlockedSectors);
                if (parsed.selectedTeam) AppState.selectedTeam = new Set(parsed.selectedTeam);
                if (parsed.timeRemainingSeconds !== undefined) AppState.timeRemainingSeconds = parsed.timeRemainingSeconds;
                if (parsed.isMLTrained) AppState.isMLTrained = parsed.isMLTrained;
                // Timer migration: prefer stored timestamp deadline; otherwise derive
                // it from the legacy seconds counter so reloads never reset/duplicate.
                if (typeof parsed.timerEndsAt === 'number' && isFinite(parsed.timerEndsAt)) {
                    AppState.timerEndsAt = parsed.timerEndsAt;
                } else if (typeof AppState.timeRemainingSeconds === 'number' && AppState.timeRemainingSeconds > 0) {
                    AppState.timerEndsAt = Date.now() + AppState.timeRemainingSeconds * 1000;
                }
            }
        } catch (e) {
            console.warn('LocalStorage load failed:', e);
        }
    }

    // --- Containment Countdown Timer (timestamp-based, duplicate-guarded) ---
    function startTimer() {
        // Guard against duplicate intervals (repeated init / hot reload)
        if (window.__manuContainmentTimer) {
            clearInterval(window.__manuContainmentTimer);
            window.__manuContainmentTimer = null;
        }

        if (AppState.timerEndsAt === null) {
            AppState.timerEndsAt = Date.now() + Math.max(0, AppState.timeRemainingSeconds) * 1000;
            saveState();
        }

        const tick = () => {
            const remaining = Math.max(0, Math.round((AppState.timerEndsAt - Date.now()) / 1000));
            if (remaining !== AppState.timeRemainingSeconds) {
                AppState.timeRemainingSeconds = remaining;
                updateTimerDisplay();
                if (remaining % 10 === 0) saveState(); // periodic, cheap persistence
            }
            if (remaining === 0 && window.__manuContainmentTimer) {
                clearInterval(window.__manuContainmentTimer);
                window.__manuContainmentTimer = null;
            }
        };

        tick();
        window.__manuContainmentTimer = setInterval(tick, 1000);
    }

    function updateTimerDisplay() {
        const h = Math.floor(AppState.timeRemainingSeconds / 3600).toString().padStart(2, '0');
        const m = Math.floor((AppState.timeRemainingSeconds % 3600) / 60).toString().padStart(2, '0');
        const s = (AppState.timeRemainingSeconds % 60).toString().padStart(2, '0');
        const timerEl = document.getElementById('containment-timer');
        if (timerEl) timerEl.innerText = `${h}:${m}:${s}`;
    }

    // --- Global Data Restoration Progress ---
    function updateGlobalProgress() {
        // Dynamic count — never hardcode the challenge total
        const totalCTFs = (window.MANU_DATA && window.MANU_DATA.CTF_CHALLENGES)
            ? Object.keys(window.MANU_DATA.CTF_CHALLENGES).length
            : Math.max(1, AppState.solvedCTFs.size);
        const solvedCount = AppState.solvedCTFs.size;
        const percent = Math.round((solvedCount / totalCTFs) * 100);
        
        const percentEl = document.getElementById('global-restoration-percent');
        const hubPercentEl = document.getElementById('hub-restoration-percent');
        if (percentEl) percentEl.innerText = `${percent}%`;
        if (hubPercentEl) hubPercentEl.innerText = `${percent}%`;

        // Check sector unlock triggers
        checkSectorProgression();
    }

    function checkSectorProgression() {
        const sectors = ['community', 'radio', 'forensics', 'research'];
        sectors.forEach((secId, idx) => {
            const secData = window.MANU_DATA.SECTORS[secId];
            const secChallenges = Object.values(window.MANU_DATA.CTF_CHALLENGES).filter(c => c.sectorId === secId);
            const allSolved = secChallenges.every(c => AppState.solvedCTFs.has(c.id));

            if (allSolved && idx < sectors.length - 1) {
                const nextSecId = sectors[idx + 1];
                if (!AppState.unlockedSectors.has(nextSecId)) {
                    AppState.unlockedSectors.add(nextSecId);
                    window.MANU_AUDIO.playSectorUnlock();
                    showToast(`🔓 SECTOR UNLOCKED: ${window.MANU_DATA.SECTORS[nextSecId].name}!`);
                    saveState();
                }
            }
        });

        // If research cleared, enable First Passage
        const researchChallenges = Object.values(window.MANU_DATA.CTF_CHALLENGES).filter(c => c.sectorId === 'research');
        const researchDone = researchChallenges.every(c => AppState.solvedCTFs.has(c.id));
        const passageNavBtn = document.getElementById('nav-passage-btn');
        if (passageNavBtn) {
            if (researchDone) {
                passageNavBtn.style.display = 'flex';
            } else {
                passageNavBtn.style.display = 'none';
            }
        }
    }

    // --- Navigation Router ---
    function navigateTo(view, sectorId = null) {
        window.MANU_AUDIO.playButtonHover();
        AppState.currentView = view;
        if (sectorId) AppState.activeSectorId = sectorId;

        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));

        if (view === 'hub') {
            document.getElementById('view-hub').classList.add('active');
            renderHubView();
        } else if (view === 'sector') {
            document.getElementById('view-sector').classList.add('active');
            renderSectorSubmap(AppState.activeSectorId);
        } else if (view === 'passage') {
            document.getElementById('view-passage').classList.add('active');
            renderPassageView();
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // --- View 1: Render Master Sanctuary Zero Hub ---
    function renderHubView() {
        const grid = document.getElementById('hub-sectors-grid');
        grid.innerHTML = '';

        const sectors = Object.values(window.MANU_DATA.SECTORS);
        sectors.forEach(sec => {
            const isUnlocked = AppState.unlockedSectors.has(sec.id);
            const secChallenges = Object.values(window.MANU_DATA.CTF_CHALLENGES).filter(c => c.sectorId === sec.id);
            const solvedInSector = secChallenges.filter(c => AppState.solvedCTFs.has(c.id)).length;
            const isComplete = solvedInSector === secChallenges.length;

            let statusClass = 'status-locked';
            let statusText = 'LOCKED';
            if (isComplete) {
                statusClass = 'status-completed';
                statusText = 'COMPLETED';
            } else if (isUnlocked) {
                statusClass = 'status-unlocked';
                statusText = 'UNLOCKED';
            }

            const card = document.createElement('div');
            card.className = `sector-hub-card glass-panel ${sec.id}`;
            card.innerHTML = `
                <div class="sector-card-top">
                    <span class="sector-num-badge">SECTOR 0${sec.number}</span>
                    <span class="sector-status-pill ${statusClass}">${statusText}</span>
                </div>
                <div class="sector-card-mid">
                    <h3>${sec.name}</h3>
                    <div class="sector-card-tagline">"${sec.tagline}"</div>
                </div>
                <div class="sector-card-bottom">
                    <span class="progress-track">RECOVERED: ${solvedInSector} / ${secChallenges.length} CTFs</span>
                    <div class="enter-btn">
                        ${isUnlocked ? 'ACCESS DISTRICT &rarr;' : '🔒 RESTRICTED'}
                    </div>
                </div>
            `;

            if (isUnlocked) {
                card.addEventListener('click', () => navigateTo('sector', sec.id));
            } else {
                card.style.opacity = '0.55';
                card.style.cursor = 'not-allowed';
                card.addEventListener('click', () => {
                    window.MANU_AUDIO.playAccessDenied();
                    showToast(`⚠️ Sector Restricted: Complete previous sector CTFs first.`);
                });
            }

            grid.appendChild(card);
        });
    }

    // --- View 2: Render Sector Submap (Matches Reference Exactly) ---
    function renderSectorSubmap(sectorId) {
        const sec = window.MANU_DATA.SECTORS[sectorId];
        if (!sec) return;

        // Header
        document.getElementById('submap-sector-title').innerText = `${sec.name} // ${sec.code}`;
        document.getElementById('submap-sector-tagline').innerText = `"${sec.tagline}"`;

        // Left Panel: District Info
        document.getElementById('info-type-val').innerText = sec.type;
        document.getElementById('info-sec-val').innerText = sec.securityLevel;
        document.getElementById('info-est-val').innerText = sec.estCompletion;

        const secChallenges = Object.values(window.MANU_DATA.CTF_CHALLENGES).filter(c => c.sectorId === sec.id);
        const solvedCount = secChallenges.filter(c => AppState.solvedCTFs.has(c.id)).length;
        const isComplete = solvedCount === secChallenges.length;

        const statusEl = document.getElementById('info-status-val');
        statusEl.innerText = isComplete ? 'SECTOR RECOVERED' : (AppState.unlockedSectors.has(sec.id) ? 'UNLOCKED / INVESTIGATING' : 'LOCKED');
        statusEl.style.color = isComplete ? 'var(--accent-emerald)' : 'var(--accent-cyan)';

        // Center Panel: Interactive Node Map & Connecting Pathways (SVG)
        renderNodeMap(sec);

        // Right Panel: Objectives Checklist
        const objList = document.getElementById('submap-objectives-list');
        objList.innerHTML = '';
        sec.objectives.forEach((obj, idx) => {
            const correspondingCTF = secChallenges[idx];
            const isDone = correspondingCTF && AppState.solvedCTFs.has(correspondingCTF.id);

            const div = document.createElement('div');
            div.className = `objective-item ${isDone ? 'completed' : ''}`;
            div.innerHTML = `
                <div class="obj-radio-icon"></div>
                <div>${obj.text}</div>
            `;
            objList.appendChild(div);
        });

        // District Status Seal
        const sealBox = document.getElementById('submap-district-seal');
        if (isComplete) {
            sealBox.className = 'district-seal-box unlocked';
            sealBox.querySelector('.seal-title').innerText = '✓ DISTRICT VERIFIED & UNLOCKED';
        } else {
            sealBox.className = 'district-seal-box';
            sealBox.querySelector('.seal-title').innerText = 'STATUS: CONTAINMENT ACTIVE';
        }

        // Bottom Row: Location Preview Thumbnails
        const thumbRow = document.getElementById('submap-thumbnails-row');
        thumbRow.innerHTML = '';
        sec.nodes.forEach(node => {
            const ctf = window.MANU_DATA.CTF_CHALLENGES[node.ctfId];
            const isSolved = AppState.solvedCTFs.has(node.ctfId);

            const card = document.createElement('div');
            card.className = 'preview-thumbnail-card';
            card.innerHTML = `
                <div>
                    <div class="preview-node-title">${node.label}</div>
                    <div class="preview-node-sub">${ctf ? ctf.category : 'Subsystem Node'}</div>
                </div>
                <div style="font-size:11px; font-family:var(--font-mono); margin-top:8px; color:${isSolved ? 'var(--accent-emerald)' : 'var(--accent-cyan)'}">
                    ${isSolved ? '✓ RECOVERED' : '▶ OPEN TERMINAL'}
                </div>
            `;
            card.addEventListener('click', () => openCTFModal(node.ctfId));
            thumbRow.appendChild(card);
        });
    }

    // Interactive SVG Node Map Engine
    function renderNodeMap(sector) {
        const container = document.getElementById('node-map-nodes-layer');
        const svg = document.getElementById('node-map-svg');
        container.innerHTML = '';
        svg.innerHTML = '';

        // Draw connecting pathway lines
        sector.pathways.forEach(path => {
            const fromNode = sector.nodes.find(n => n.id === path.from);
            const toNode = sector.nodes.find(n => n.id === path.to);
            if (!fromNode || !toNode) return;

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', `${fromNode.x}%`);
            line.setAttribute('y1', `${fromNode.y}%`);
            line.setAttribute('x2', `${toNode.x}%`);
            line.setAttribute('y2', `${toNode.y}%`);
            line.setAttribute('stroke', path.type === 'solid' ? sector.accentColor : 'rgba(255,255,255,0.2)');
            line.setAttribute('stroke-width', path.type === 'solid' ? '2.5' : '1.5');
            if (path.type === 'dotted') {
                line.setAttribute('stroke-dasharray', '5,5');
            }
            svg.appendChild(line);
        });

        // Place Clickable Node Elements
        sector.nodes.forEach(node => {
            const isSolved = AppState.solvedCTFs.has(node.ctfId);
            const div = document.createElement('div');
            div.className = 'map-node-element';
            div.style.left = `${node.x}%`;
            div.style.top = `${node.y}%`;

            const iconCircle = document.createElement('div');
            iconCircle.className = `node-icon-circle ${isSolved ? 'solved' : 'active-pulse'}`;
            iconCircle.style.borderColor = isSolved ? 'var(--accent-emerald)' : sector.accentColor;
            iconCircle.innerHTML = isSolved ? '✓' : (node.type === 'puzzle' ? '🧩' : (node.type === 'data' ? '🗄️' : '📡'));

            const label = document.createElement('div');
            label.className = 'node-label-tag';
            label.innerText = node.label;

            div.appendChild(iconCircle);
            div.appendChild(label);

            div.addEventListener('click', () => {
                window.MANU_AUDIO.playButtonHover();
                openCTFModal(node.ctfId);
            });

            container.appendChild(div);
        });
    }

    // --- CTF Challenge Terminal Modal ---
    let currentActiveCTF = null;

    function openCTFModal(ctfId) {
        const ctf = window.MANU_DATA.CTF_CHALLENGES[ctfId];
        if (!ctf) return;

        currentActiveCTF = ctf;
        const isSolved = AppState.solvedCTFs.has(ctf.id);

        document.getElementById('ctf-modal-title').innerText = ctf.title;
        document.getElementById('ctf-category-badge').innerText = ctf.category;
        document.getElementById('ctf-difficulty-badge').innerText = `${ctf.difficulty} [${ctf.points} PTS]`;
        document.getElementById('ctf-description-text').innerHTML = ctf.description.replace(/\n/g, '<br>');

        // Render Relevant Resident / Forensic Data Table inside Modal
        renderCTFDataTable(ctf);

        const inputField = document.getElementById('ctf-flag-input');
        const feedbackMsg = document.getElementById('ctf-feedback-msg');
        inputField.value = '';
        
        if (isSolved) {
            feedbackMsg.className = 'ctf-feedback-msg success';
            feedbackMsg.innerText = '✓ CHALLENGE CLEARED — DATA FRAGMENT RECOVERED';
            inputField.disabled = true;
        } else {
            feedbackMsg.className = 'ctf-feedback-msg';
            feedbackMsg.innerText = `Hint available: ${ctf.hint ? 'Type flag format MANU{...}' : ''}`;
            inputField.disabled = false;
        }

        document.getElementById('ctf-modal-overlay').classList.add('open');
        inputField.focus();
    }

    function renderCTFDataTable(ctf) {
        const tableContainer = document.getElementById('ctf-data-table-body');
        const thead = document.getElementById('ctf-data-table-head');
        tableContainer.innerHTML = '';

        if (ctf.sectorId === 'community') {
            thead.innerHTML = `
                <tr>
                    <th>Sanctuary_ID</th>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Housing_Assignment</th>
                    <th>Duty_Rotation</th>
                    <th>Clinic_Visits</th>
                    <th>Last_Log_Time</th>
                </tr>
            `;
            window.MANU_DATA.residents.slice(0, 30).forEach(r => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${r.id}</strong></td>
                    <td>${r.name}</td>
                    <td><span class="role-pill">${r.role}</span></td>
                    <td>${r.housingSector ? r.housingSector : '<span class="null-highlight">NULL</span>'}</td>
                    <td>${r.dutyRotation ? r.dutyRotation : '<span class="null-highlight">NULL</span>'}</td>
                    <td>${r.clinicVisits !== null ? r.clinicVisits : '<span class="null-highlight">NULL</span>'}</td>
                    <td>${r.lastLogTime}</td>
                `;
                tableContainer.appendChild(tr);
            });
        } else if (ctf.sectorId === 'radio') {
            thead.innerHTML = `
                <tr>
                    <th>Sanctuary_ID</th>
                    <th>Call_Sign</th>
                    <th>Transmissions</th>
                    <th>Emergency_Ack</th>
                    <th>Relay_Node</th>
                    <th>Signal_Signature</th>
                </tr>
            `;
            window.MANU_DATA.residents.slice(0, 30).forEach(r => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${r.id}</strong></td>
                    <td>${r.callSign}</td>
                    <td>${r.transSent}</td>
                    <td><span style="color:${r.emergencyListened === 'ALERT_AUTO_ACK' ? 'var(--accent-red)' : 'var(--text-secondary)'}">${r.emergencyListened}</span></td>
                    <td>${r.nodeAffiliation}</td>
                    <td><code>${r.signalSignature}</code></td>
                `;
                tableContainer.appendChild(tr);
            });
        } else if (ctf.sectorId === 'forensics') {
            thead.innerHTML = `
                <tr>
                    <th>Sanctuary_ID</th>
                    <th>Original_ID_Hash</th>
                    <th>PRALAYA_Status</th>
                    <th>Old_District</th>
                    <th>Clearance</th>
                </tr>
            `;
            window.MANU_DATA.residents.slice(0, 30).forEach(r => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${r.id}</strong></td>
                    <td><code>${r.originalIDHash}</code></td>
                    <td><span style="color:var(--border-purple); font-weight:700;">${r.pralayaStatus}</span></td>
                    <td>${r.oldDistrict}</td>
                    <td>${r.clearanceLevel}</td>
                `;
                tableContainer.appendChild(tr);
            });
        } else {
            // Research & ML table
            thead.innerHTML = `
                <tr>
                    <th>Sanctuary_ID</th>
                    <th>Role</th>
                    <th>Age</th>
                    <th>Radiation (mSv)</th>
                    <th>Cellular_Resilience</th>
                    <th>Neuro_Stability</th>
                    <th>Survival_Prob</th>
                </tr>
            `;
            window.MANU_DATA.residents.slice(0, 30).forEach(r => {
                const tr = document.createElement('tr');
                const prob = r.predictedScore !== null ? r.predictedScore : r.groundTruthScore;
                tr.innerHTML = `
                    <td><strong>${r.id}</strong></td>
                    <td>${r.role}</td>
                    <td>${r.age}</td>
                    <td>${r.radiation_mSv}</td>
                    <td>${r.cellularResilience}</td>
                    <td>${r.neuroStability}</td>
                    <td><strong style="color:var(--accent-emerald)">${(prob * 100).toFixed(1)}%</strong></td>
                `;
                tableContainer.appendChild(tr);
            });
        }
    }

    function closeCTFModal() {
        document.getElementById('ctf-modal-overlay').classList.remove('open');
        currentActiveCTF = null;
    }

    function submitFlag() {
        if (!currentActiveCTF) return;
        const input = document.getElementById('ctf-flag-input').value.trim();
        const feedbackMsg = document.getElementById('ctf-feedback-msg');

        if (input.toUpperCase() === currentActiveCTF.flag.toUpperCase()) {
            window.MANU_AUDIO.playAccessGranted();
            AppState.solvedCTFs.add(currentActiveCTF.id);
            feedbackMsg.className = 'ctf-feedback-msg success';
            feedbackMsg.innerHTML = `🎉 ACCESS GRANTED! ${currentActiveCTF.storyUnlock}`;

            // Mark repaired record
            AppState.repairedRecordsCount += 6;
            saveState();
            updateGlobalProgress();

            // Refresh submap state
            renderSectorSubmap(AppState.activeSectorId);
            showToast(`🚩 Fragment Recovered: +${currentActiveCTF.points} PTS`);
        } else {
            window.MANU_AUDIO.playAccessDenied();
            feedbackMsg.className = 'ctf-feedback-msg error';
            feedbackMsg.innerText = `❌ INVALID FLAG. Check hint or inspect data table.`;
        }
    }

    // --- View 3: The First Passage Finale & ML Engine ---
    function renderPassageView() {
        // Auto train ML model if not trained yet
        if (!AppState.isMLTrained) {
            const trainResult = window.MANU_ML.modelInstance.fit(window.MANU_DATA.historical);
            window.MANU_ML.modelInstance.predictAll(window.MANU_DATA.residents);
            AppState.isMLTrained = true;
            saveState();
        }

        renderRosterTable();
        updateTeamBuilderUI();
    }

    let rosterFilterRole = 'ALL';
    let rosterSearchQuery = '';

    function renderRosterTable() {
        const tbody = document.getElementById('roster-table-body');
        tbody.innerHTML = '';

        let residents = [...window.MANU_DATA.residents];

        // Filter by role
        if (rosterFilterRole !== 'ALL') {
            residents = residents.filter(r => r.role === rosterFilterRole);
        }

        // Filter by search query
        if (rosterSearchQuery) {
            const q = rosterSearchQuery.toLowerCase();
            residents = residents.filter(r => r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
        }

        // Sort by predicted survival probability descending
        residents.sort((a, b) => (b.predictedScore || b.groundTruthScore) - (a.predictedScore || a.groundTruthScore));

        residents.forEach(r => {
            const isSelected = AppState.selectedTeam.has(r.id);
            const prob = r.predictedScore !== null ? r.predictedScore : r.groundTruthScore;

            const tr = document.createElement('tr');
            tr.style.background = isSelected ? 'rgba(56, 189, 248, 0.15)' : '';
            tr.innerHTML = `
                <td>
                    <input type="checkbox" ${isSelected ? 'checked' : ''} style="cursor:pointer;" />
                </td>
                <td><strong>${r.id}</strong></td>
                <td>${r.name}</td>
                <td><span class="role-pill ${r.role.toLowerCase()}">${r.role}</span></td>
                <td>${r.age}</td>
                <td>${r.radiation_mSv} mSv</td>
                <td>${r.cellularResilience}</td>
                <td>${r.trustCoordination}</td>
                <td><strong style="color:var(--accent-emerald); font-size:13px;">${(prob * 100).toFixed(1)}%</strong></td>
            `;

            // Row toggle selection
            tr.addEventListener('click', (e) => {
                if (e.target.tagName !== 'INPUT') {
                    const cb = tr.querySelector('input');
                    cb.checked = !cb.checked;
                }
                toggleResidentSelection(r.id);
            });

            tbody.appendChild(tr);
        });
    }

    function toggleResidentSelection(residentId) {
        window.MANU_AUDIO.playKeyClick();
        if (AppState.selectedTeam.has(residentId)) {
            AppState.selectedTeam.delete(residentId);
        } else {
            if (AppState.selectedTeam.size >= 10) {
                showToast(`⚠️ Maximum 10 residents for First Passage vehicle.`);
                return;
            }
            AppState.selectedTeam.add(residentId);
        }
        saveState();
        renderRosterTable();
        updateTeamBuilderUI();
    }

    function updateTeamBuilderUI() {
        const selectedList = window.MANU_DATA.residents.filter(r => AppState.selectedTeam.has(r.id));
        const evalResult = window.MANU_ML.TeamEvaluator.evaluateTeam(selectedList);

        // Update counts & Gauges
        document.getElementById('team-count-display').innerText = `${evalResult.count} / 10`;
        document.getElementById('avg-survival-gauge').innerText = `${(evalResult.avgSurvival * 100).toFixed(1)}%`;
        document.getElementById('synergy-score-gauge').innerText = `${(evalResult.compositeSynergy * 100).toFixed(1)}%`;

        document.getElementById('survival-gauge-bar').style.width = `${evalResult.avgSurvival * 100}%`;
        document.getElementById('synergy-gauge-bar').style.width = `${evalResult.compositeSynergy * 100}%`;

        // Update Role Balance Pills
        const roles = ['Runner', 'Medic', 'Builder', 'Analyst'];
        roles.forEach(role => {
            const count = evalResult.roleCounts[role];
            const pill = document.getElementById(`role-pill-${role.toLowerCase()}`);
            if (pill) {
                pill.className = `role-indicator-box ${count >= 2 ? 'valid' : 'invalid'}`;
                pill.innerHTML = `<span>${role}</span><strong>${count} / 2</strong>`;
            }
        });

        // Warnings list
        const warnContainer = document.getElementById('team-warnings-list');
        warnContainer.innerHTML = '';
        evalResult.warnings.forEach(w => {
            const div = document.createElement('div');
            div.style.color = 'var(--accent-red)';
            div.style.fontSize = '12px';
            div.style.fontFamily = 'var(--font-mono)';
            div.innerText = `⚠️ ${w}`;
            warnContainer.appendChild(div);
        });

        // Final Key output
        const keyBox = document.getElementById('final-key-display');
        const verifyBtn = document.getElementById('btn-verify-passage');

        if (evalResult.isValid) {
            keyBox.innerText = evalResult.finalKey;
            keyBox.style.borderColor = 'var(--accent-emerald)';
            keyBox.style.color = 'var(--accent-emerald)';
            verifyBtn.disabled = false;
        } else {
            keyBox.innerText = 'KEY_LOCKED // AWAITING BALANCED 10-PERSON ROSTER';
            keyBox.style.borderColor = 'var(--accent-red)';
            keyBox.style.color = 'var(--accent-red)';
            verifyBtn.disabled = true;
        }
    }

    async function initiateFinalEvacuation() {
        window.MANU_AUDIO.playVictoryFanfare();
        const tid = getResolvedTeamId();
        if (tid) {
            try {
                await fetch('/api/red/complete', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer the-last-dataset-2026-production-service-token-manipal',
                        'x-team-id': tid
                    },
                    body: JSON.stringify({ teamId: tid })
                });
            } catch (e) {
                try {
                    await fetch('https://last-dataset.vercel.app/api/red/complete', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer the-last-dataset-2026-production-service-token-manipal',
                            'x-team-id': tid
                        },
                        body: JSON.stringify({ teamId: tid })
                    });
                } catch (err) {}
            }
            if (window.opener) {
                try { window.opener.postMessage({ type: 'ZONE_COMPLETED', zone: 'red', teamId: tid }, '*'); } catch (e) {}
            }
            if (window.parent && window.parent !== window) {
                try { window.parent.postMessage({ type: 'ZONE_COMPLETED', zone: 'red', teamId: tid }, '*'); } catch (e) {}
            }
        }
        const overlay = document.getElementById('victory-modal-overlay');
        if (overlay) overlay.classList.add('open');
    }

    // --- Toast Notification Helper ---
    function showToast(msg) {
        const toast = document.getElementById('manu-toast');
        if (!toast) return;
        toast.innerText = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3500);
    }

    // --- Initialization & Event Listeners ---
    function initApp() {
        loadState();
        startTimer();
        updateGlobalProgress();

        // Nav buttons
        document.getElementById('nav-hub-btn').addEventListener('click', () => navigateTo('hub'));
        document.getElementById('brand-home-btn').addEventListener('click', () => navigateTo('hub'));
        
        const passageBtn = document.getElementById('nav-passage-btn');
        if (passageBtn) passageBtn.addEventListener('click', () => navigateTo('passage'));

        document.getElementById('nav-audio-btn').addEventListener('click', () => {
            const enabled = window.MANU_AUDIO.toggleAudio();
            document.getElementById('nav-audio-btn').innerText = enabled ? '🔊 AUDIO: ON' : '🔇 AUDIO: OFF';
        });

        // CTF Modal Events
        document.getElementById('ctf-close-modal').addEventListener('click', closeCTFModal);
        document.getElementById('btn-submit-ctf').addEventListener('click', submitFlag);
        document.getElementById('ctf-flag-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitFlag();
        });

        // First Passage Filter Events
        document.querySelectorAll('.role-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.role-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                rosterFilterRole = btn.getAttribute('data-role');
                renderRosterTable();
            });
        });

        const searchInp = document.getElementById('roster-search-input');
        if (searchInp) {
            searchInp.addEventListener('input', (e) => {
                rosterSearchQuery = e.target.value.trim();
                renderRosterTable();
            });
        }

        // Final Verify Button
        const verifyBtn = document.getElementById('btn-verify-passage');
        if (verifyBtn) verifyBtn.addEventListener('click', initiateFinalEvacuation);

        document.getElementById('victory-close-btn').addEventListener('click', () => {
            document.getElementById('victory-modal-overlay').classList.remove('open');
        });

        // Initial View
        navigateTo('hub');
    }

    window.addEventListener('DOMContentLoaded', initApp);

})(window);
