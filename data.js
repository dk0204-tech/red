/* ==========================================================================
   MANU PROTOCOL — CANON DATA ENGINE
   120 Current Residents (4 Linked Tables) + 450 Historical Survival Records
   20 Sector CTF Challenges + Lore Fragments + Objective Checklists
   ========================================================================== */

(function(window) {
    'use strict';

    // 1. Lore & Sector Metadata
    const SECTORS = {
        community: {
            id: 'community',
            number: 1,
            name: 'COMMUNITY SECTOR',
            code: 'SEC-01-COM',
            tagline: 'SANCTUARY LIVES IN THE GAPS BETWEEN RECORDS.',
            type: 'Habitation & Civil Logistics',
            securityLevel: 'LEVEL 1 — CIVILIAN CLEARANCE',
            status: 'UNLOCKED', // First sector is unlocked by default
            accentColor: '#38bdf8',
            accentGlow: 'rgba(56, 189, 248, 0.4)',
            estCompletion: '5 CTF CHALLENGES',
            description: 'Current Sanctuary living quarters, medical clinic, maintenance workshops, and civilian duty boards. Identify the systematic cluster corruption patterns where resident data vanishes simultaneously.',
            nodes: [
                { id: 'com_node_1', ctfId: 'ctf_com_1', label: 'Duty Roster Alpha', x: 28, y: 35, type: 'primary', locked: false },
                { id: 'com_node_2', ctfId: 'ctf_com_2', label: 'Clinic Triage Archive', x: 72, y: 32, type: 'puzzle', locked: false },
                { id: 'com_node_3', ctfId: 'ctf_com_3', label: 'Housing Sector 4B', x: 50, y: 55, type: 'data', locked: false },
                { id: 'com_node_4', ctfId: 'ctf_com_4', label: 'Civic Maintenance Log', x: 24, y: 75, type: 'primary', locked: false },
                { id: 'com_node_5', ctfId: 'ctf_com_5', label: 'Alert Response Terminal', x: 76, y: 78, type: 'secondary', locked: false }
            ],
            pathways: [
                { from: 'com_node_1', to: 'com_node_3', type: 'solid' },
                { from: 'com_node_2', to: 'com_node_3', type: 'solid' },
                { from: 'com_node_3', to: 'com_node_4', type: 'solid' },
                { from: 'com_node_3', to: 'com_node_5', type: 'solid' },
                { from: 'com_node_1', to: 'com_node_2', type: 'dotted' }
            ],
            objectives: [
                { id: 'obj_com_1', text: 'Analyze Duty Roster Alpha for simultaneous field corruption' },
                { id: 'obj_com_2', text: 'Cross-reference Clinic Triage logs with housing null clusters' },
                { id: 'obj_com_3', text: 'Reconstruct timestamped departure events in Housing 4B' },
                { id: 'obj_com_4', text: 'Isolate maintenance log anomalies matching alert triggers' },
                { id: 'obj_com_5', text: 'Recover the shared emergency alert response manifest' }
            ],
            fragments: [
                { id: 'frag_com_1', title: 'Fragment COM-A: The Vanishing Duty Roster', ctfId: 'ctf_com_1' },
                { id: 'frag_com_2', title: 'Fragment COM-B: Clinic Null Timestamps', ctfId: 'ctf_com_2' },
                { id: 'frag_com_3', title: 'Fragment COM-C: Sector 4B Mass Eviction', ctfId: 'ctf_com_3' },
                { id: 'frag_com_4', title: 'Fragment COM-D: Silent Departure Protocol', ctfId: 'ctf_com_4' },
                { id: 'frag_com_5', title: 'Fragment COM-E: Citywide Emergency Alert Note', ctfId: 'ctf_com_5' }
            ]
        },

        radio: {
            id: 'radio',
            number: 2,
            name: 'RADIO COMMUNICATION',
            code: 'SEC-02-RAD',
            tagline: 'SIGNALS TRAVEL. TRUTH ECHOES.',
            type: 'Emergency Telemetry & Radio Relays',
            securityLevel: 'LEVEL 2 — RELAY CLEARANCE',
            status: 'LOCKED',
            accentColor: '#f59e0b',
            accentGlow: 'rgba(245, 158, 11, 0.4)',
            estCompletion: '5 CTF CHALLENGES',
            description: 'Emergency relay repeaters, duty calls, scrambled voice transmissions, and contact chains. Solve signal decoders to discover who triggered the automatic citywide broadcast.',
            nodes: [
                { id: 'rad_node_1', ctfId: 'ctf_rad_1', label: 'Relay Tower Delta', x: 30, y: 30, type: 'primary', locked: false },
                { id: 'rad_node_2', ctfId: 'ctf_rad_2', label: 'Distress Frequency 142.8', x: 70, y: 35, type: 'puzzle', locked: false },
                { id: 'rad_node_3', ctfId: 'ctf_rad_3', label: 'Emergency Repeater Hub', x: 50, y: 52, type: 'primary', locked: false },
                { id: 'rad_node_4', ctfId: 'ctf_rad_4', label: 'Acoustic Voice Archive', x: 26, y: 72, type: 'data', locked: false },
                { id: 'rad_node_5', ctfId: 'ctf_rad_5', label: 'Vault Breach Transceiver', x: 74, y: 74, type: 'secondary', locked: false }
            ],
            pathways: [
                { from: 'rad_node_1', to: 'rad_node_3', type: 'solid' },
                { from: 'rad_node_2', to: 'rad_node_3', type: 'solid' },
                { from: 'rad_node_3', to: 'rad_node_4', type: 'solid' },
                { from: 'rad_node_3', to: 'rad_node_5', type: 'solid' },
                { from: 'rad_node_4', to: 'rad_node_5', type: 'dotted' }
            ],
            objectives: [
                { id: 'obj_rad_1', text: 'Demodulate corrupted frequency packet on Relay Delta' },
                { id: 'obj_rad_2', text: 'Reconstruct sequenced radio audio timeline from fragments' },
                { id: 'obj_rad_3', text: 'Decode encrypted contact chain between duty officers' },
                { id: 'obj_rad_4', text: 'Filter synthetic noise from the acoustic voice log' },
                { id: 'obj_rad_5', text: 'Trace the automated transmission origin to Evidence Vault' }
            ],
            fragments: [
                { id: 'frag_rad_1', title: 'Fragment RAD-A: Unmanned Beacon Signal', ctfId: 'ctf_rad_1' },
                { id: 'frag_rad_2', title: 'Fragment RAD-B: Reassembled Voice Transcript', ctfId: 'ctf_rad_2' },
                { id: 'frag_rad_3', title: 'Fragment RAD-C: Contact Chain Triangulation', ctfId: 'ctf_rad_3' },
                { id: 'frag_rad_4', title: 'Fragment RAD-D: Ghost Frequency Log', ctfId: 'ctf_rad_4' },
                { id: 'frag_rad_5', title: 'Fragment RAD-E: Vault Tripwire Trigger Origin', ctfId: 'ctf_rad_5' }
            ]
        },

        forensics: {
            id: 'forensics',
            number: 3,
            name: 'FORENSIC EVIDENCE VAULT',
            code: 'SEC-03-FOR',
            tagline: 'IDENTITIES ARE MASKS WRITTEN IN SILICON.',
            type: 'Subterranean Evidence Archive & Identity Vault',
            securityLevel: 'LEVEL 3 — RESTRICTED INVESTIGATIVE',
            status: 'LOCKED',
            accentColor: '#a855f7',
            accentGlow: 'rgba(168, 85, 247, 0.4)',
            estCompletion: '5 CTF CHALLENGES',
            description: 'The sealed civic complex beneath Sanctuary. Access damaged identity matrices and cryptographic signatures to uncover the PRALAYA protocol and original resident identities.',
            nodes: [
                { id: 'for_node_1', ctfId: 'ctf_for_1', label: 'Biometric Access Gate', x: 28, y: 32, type: 'primary', locked: false },
                { id: 'for_node_2', ctfId: 'ctf_for_2', label: 'PRALAYA Cryptographic Vault', x: 72, y: 35, type: 'puzzle', locked: false },
                { id: 'for_node_3', ctfId: 'ctf_for_3', label: 'Identity Cross-Index', x: 50, y: 55, type: 'data', locked: false },
                { id: 'for_node_4', ctfId: 'ctf_for_4', label: 'Hash Verification Core', x: 25, y: 75, type: 'secondary', locked: false },
                { id: 'for_node_5', ctfId: 'ctf_for_5', label: 'Transfer Manifest Archive', x: 75, y: 75, type: 'primary', locked: false }
            ],
            pathways: [
                { from: 'for_node_1', to: 'for_node_3', type: 'solid' },
                { from: 'for_node_2', to: 'for_node_3', type: 'solid' },
                { from: 'for_node_3', to: 'for_node_4', type: 'solid' },
                { from: 'for_node_3', to: 'for_node_5', type: 'solid' },
                { from: 'for_node_1', to: 'for_node_4', type: 'dotted' }
            ],
            objectives: [
                { id: 'obj_for_1', text: 'Bypass biometric gate with cryptographic signature verification' },
                { id: 'obj_for_2', text: 'Decrypt MANU’s PRALAYA memory erasure directive' },
                { id: 'obj_for_3', text: 'Correlate pre-Collapse citizen hashes to Sanctuary wrist tags' },
                { id: 'obj_for_4', text: 'Detect altered audit records via SHA-256 integrity checks' },
                { id: 'obj_for_5', text: 'Extract Research Evaluation Wing Transfer Manifest' }
            ],
            fragments: [
                { id: 'frag_for_1', title: 'Fragment FOR-A: Biometric Masking Table', ctfId: 'ctf_for_1' },
                { id: 'frag_for_2', title: 'Fragment FOR-B: PRALAYA Activation Order', ctfId: 'ctf_for_2' },
                { id: 'frag_for_3', title: 'Fragment FOR-C: The Original Identity Matrix', ctfId: 'ctf_for_3' },
                { id: 'frag_for_4', title: 'Fragment FOR-D: Tampered Audit Log Proof', ctfId: 'ctf_for_4' },
                { id: 'frag_for_5', title: 'Fragment FOR-E: Research Wing Transfer Record', ctfId: 'ctf_for_5' }
            ]
        },

        research: {
            id: 'research',
            number: 4,
            name: 'RESEARCH & SURVIVAL FACILITY',
            code: 'SEC-04-RES',
            tagline: 'SCIENCE REMEMBERS. EVEN WHEN PEOPLE DON’T.',
            type: 'Quarantine Biometrics & Survival Analytics',
            securityLevel: 'LEVEL 4 — MAXIMUM CONTAINMENT',
            status: 'LOCKED',
            accentColor: '#10b981',
            accentGlow: 'rgba(16, 185, 129, 0.4)',
            estCompletion: '5 CTF CHALLENGES',
            description: 'Long-term exposure wings, past Sanctuary test cycles, and 450 historical survival records. Train MANU’s predictive survival model to evaluate current residents.',
            nodes: [
                { id: 'res_node_1', ctfId: 'ctf_res_1', label: 'Cellular Pathology Lab', x: 28, y: 35, type: 'primary', locked: false },
                { id: 'res_node_2', ctfId: 'ctf_res_2', label: 'Radiation Dosimetry Bank', x: 72, y: 32, type: 'puzzle', locked: false },
                { id: 'res_node_3', ctfId: 'ctf_res_3', label: 'Cycle 07 Historical Vault', x: 50, y: 55, type: 'data', locked: false },
                { id: 'res_node_4', ctfId: 'ctf_res_4', label: 'Feature Correlation Matrix', x: 24, y: 75, type: 'secondary', locked: false },
                { id: 'res_node_5', ctfId: 'ctf_res_5', label: 'ML Model Training Engine', x: 76, y: 76, type: 'primary', locked: false }
            ],
            pathways: [
                { from: 'res_node_1', to: 'res_node_3', type: 'solid' },
                { from: 'res_node_2', to: 'res_node_3', type: 'solid' },
                { from: 'res_node_3', to: 'res_node_4', type: 'solid' },
                { from: 'res_node_3', to: 'res_node_5', type: 'solid' },
                { from: 'res_node_4', to: 'res_node_5', type: 'dotted' }
            ],
            objectives: [
                { id: 'obj_res_1', text: 'Normalize Cellular Resilience Index across resident cohort' },
                { id: 'obj_res_2', text: 'Repair corrupted radiation dosage records from Cycle 09' },
                { id: 'obj_res_3', text: 'Load 450 historical survival outcomes into memory' },
                { id: 'obj_res_4', text: 'Identify the top predictor features for outside survival' },
                { id: 'obj_res_5', text: 'Train Random Forest Model & score 120 current residents' }
            ],
            fragments: [
                { id: 'frag_res_1', title: 'Fragment RES-A: Cellular Longevity Index', ctfId: 'ctf_res_1' },
                { id: 'frag_res_2', title: 'Fragment RES-B: Radiation Threshold Curves', ctfId: 'ctf_res_2' },
                { id: 'frag_res_3', title: 'Fragment RES-C: 450 Historical Survival Dataset', ctfId: 'ctf_res_3' },
                { id: 'frag_res_4', title: 'Fragment RES-D: Feature Weight Analysis', ctfId: 'ctf_res_4' },
                { id: 'frag_res_5', title: 'Fragment RES-E: Trained Random Forest Weights', ctfId: 'ctf_res_5' }
            ]
        }
    };

    // 2. Generate 120 Current Residents
    // Roles: Runner, Medic, Builder, Analyst (30 of each)
    const ROLES = ['Runner', 'Medic', 'Builder', 'Analyst'];
    const FIRST_NAMES = [
        'Kael', 'Elena', 'Marcus', 'Aria', 'Darius', 'Lyra', 'Soren', 'Vera', 'Jaxon', 'Nadia',
        'Talon', 'Mira', 'Cassian', 'Zoe', 'Orin', 'Selene', 'Rowan', 'Kira', 'Bram', 'Talia',
        'Lucian', 'Astrid', 'Gideon', 'Nova', 'Silas', 'Freya', 'Corin', 'Iris', 'Eamon', 'Thalia'
    ];
    const LAST_NAMES = [
        'Vance', 'Sterling', 'Mercer', 'Cross', 'Holloway', 'Thorne', 'Sinclair', 'Chen', 'Reyes', 'Novak',
        'Kovacs', 'Winter', 'Brandt', 'Graves', 'Alvarez', 'Zhang', 'O\'Connor', 'Moreau', 'Sloan', 'Patel',
        'Frost', 'Kruger', 'Lindqvist', 'Nakamura', 'Volkov', 'Mendoza', 'Fletcher', 'Bishop', 'Dumont', 'Vega'
    ];

    function generate120Residents() {
        const residents = [];
        let seed = 42;
        function random() {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        }

        for (let i = 1; i <= 120; i++) {
            const idNum = i.toString().padStart(3, '0');
            const sid = `S${idNum}`;
            const roleIndex = (i - 1) % 4;
            const role = ROLES[roleIndex];
            const name = `${FIRST_NAMES[(i * 7) % FIRST_NAMES.length]} ${LAST_NAMES[(i * 11) % LAST_NAMES.length]}`;
            
            // Age & Biological features
            const age = Math.floor(21 + random() * 36); // 21 - 56
            const radiation_mSv = parseFloat((12.5 + random() * 65.0).toFixed(1)); // 12.5 - 77.5
            const cellularResilience = parseFloat((0.35 + random() * 0.60).toFixed(2)); // 0.35 - 0.95
            const neuroStability = parseFloat((0.40 + random() * 0.55).toFixed(2)); // 0.40 - 0.95
            const physicalCondition = parseFloat((0.45 + random() * 0.50).toFixed(2)); // 0.45 - 0.95
            const trustCoordination = parseFloat((0.30 + random() * 0.65).toFixed(2)); // 0.30 - 0.95
            
            // Corruption Cluster Indicator: Residents who "responded to the alert"
            // Cluster corruption indices: [14, 28, 42, 56, 70, 84, 98, 112]
            const isAlertCluster = (i % 14 === 0);
            
            // 4 Linked Tables Data:
            // Table 1: Community
            const housingSector = isAlertCluster ? null : `Sector-${String.fromCharCode(65 + (i % 6))}-${(i % 12) + 1}`;
            const dutyRotation = isAlertCluster ? null : `Shift-${(i % 3) + 1} (${['0600-1400', '1400-2200', '2200-0600'][i % 3]})`;
            const clinicVisits = isAlertCluster ? null : Math.floor(1 + random() * 8);
            const lastLogTime = isAlertCluster ? 'COLLAPSE-ALERT-T24:00' : `Cycle-18.0${(i % 9) + 1}`;
            const communityStatus = isAlertCluster ? 'CLUSTER_NULLED' : 'ACTIVE';

            // Table 2: Radio
            const callSign = `ECHO-${role.substring(0,3).toUpperCase()}-${idNum}`;
            const transSent = Math.floor(5 + random() * 45);
            const emergencyListened = isAlertCluster ? 'ALERT_AUTO_ACK' : (random() > 0.4 ? 'ACK' : 'MISSED');
            const nodeAffiliation = `Relay-Node-0${(i % 4) + 1}`;
            const signalSignature = `0x${Math.floor(random() * 0xFFFFFF).toString(16).padStart(6, '0').toUpperCase()}`;

            // Table 3: Forensics
            const originalIDHash = `PRALAYA-REC-${Math.floor(random() * 89999 + 10000)}`;
            const pralayaStatus = 'MEMORY_MASKED';
            const oldDistrict = `Civic-Zone-${(i % 8) + 1}`;
            const clearanceLevel = `CLR-0${(i % 3) + 1}`;

            // Table 4: Research
            // Ground truth base calculation for validation
            const baseSurvival = Math.min(0.98, Math.max(0.15, (
                cellularResilience * 0.35 +
                (1.0 - (radiation_mSv / 85.0)) * 0.25 +
                neuroStability * 0.20 +
                physicalCondition * 0.15 +
                (age < 40 ? 0.05 : -0.05)
            )));

            residents.push({
                id: sid,
                name: name,
                role: role,
                age: age,
                // Community table
                housingSector: housingSector,
                dutyRotation: dutyRotation,
                clinicVisits: clinicVisits,
                lastLogTime: lastLogTime,
                communityStatus: communityStatus,
                isAlertCluster: isAlertCluster,
                isRepaired: false,
                // Radio table
                callSign: callSign,
                transSent: transSent,
                emergencyListened: emergencyListened,
                nodeAffiliation: nodeAffiliation,
                signalSignature: signalSignature,
                // Forensics table
                originalIDHash: originalIDHash,
                pralayaStatus: pralayaStatus,
                oldDistrict: oldDistrict,
                clearanceLevel: clearanceLevel,
                // Research table
                radiation_mSv: radiation_mSv,
                cellularResilience: cellularResilience,
                neuroStability: neuroStability,
                physicalCondition: physicalCondition,
                trustCoordination: trustCoordination,
                groundTruthScore: parseFloat(baseSurvival.toFixed(4)),
                predictedScore: null // Calculated once ML runs
            });
        }
        return residents;
    }

    // 3. Generate 450 Historical Survival Training Records (with continuous known survival outcome)
    function generate450HistoricalRecords() {
        const records = [];
        let seed = 1337;
        function random() {
            seed = (seed * 16807) % 2147483647;
            return (seed - 1) / 2147483646;
        }

        for (let i = 1; i <= 450; i++) {
            const hId = `HIST-${i.toString().padStart(4, '0')}`;
            const age = Math.floor(19 + random() * 42); // 19 - 60
            const radiation = parseFloat((5.0 + random() * 90.0).toFixed(1)); // 5 - 95 mSv
            const cellular = parseFloat((0.20 + random() * 0.78).toFixed(2)); // 0.20 - 0.98
            const neuro = parseFloat((0.25 + random() * 0.72).toFixed(2)); // 0.25 - 0.97
            const physical = parseFloat((0.30 + random() * 0.68).toFixed(2)); // 0.30 - 0.98
            const trust = parseFloat((0.20 + random() * 0.75).toFixed(2)); // 0.20 - 0.95
            const role = ROLES[i % 4];

            // True continuous survival probability formula with non-linear interaction terms:
            // High cellular + low radiation + high neuro stability + good physical condition = high survival
            let survivalProb = (
                cellular * 0.32 +
                (1.0 - Math.min(1.0, radiation / 90.0)) * 0.26 +
                neuro * 0.18 +
                physical * 0.14 +
                trust * 0.05 +
                (age >= 22 && age <= 38 ? 0.05 : -0.03) +
                ((random() - 0.5) * 0.04) // small natural variation
            );

            // Clamp between 0.05 and 0.99
            survivalProb = Math.min(0.99, Math.max(0.05, survivalProb));

            records.push({
                id: hId,
                role: role,
                age: age,
                radiation_mSv: radiation,
                cellularResilience: cellular,
                neuroStability: neuro,
                physicalCondition: physical,
                trustCoordination: trust,
                survivalOutcome: parseFloat(survivalProb.toFixed(4))
            });
        }
        return records;
    }

    // 4. CTF Challenges (5 per Sector = 20 total)
    const CTF_CHALLENGES = {
        // --- SECTOR 1: COMMUNITY ---
        ctf_com_1: {
            id: 'ctf_com_1',
            sectorId: 'community',
            title: 'Spot the Cluster: Duty Roster Alpha',
            difficulty: 'EASY',
            category: 'Data Anomaly Analysis',
            points: 100,
            description: `Sanctuary records do not contain forged falsifications — corrupted records manifest as **simultaneous NULL fields** timestamped at the exact moment of departure.\n\nInspect the Duty Roster table for the cluster of residents whose Housing, Duty, and Clinic records vanished simultaneously at timestamp **COLLAPSE-ALERT-T24:00**. Identify the Sanctuary ID of the Runner who leads this departure cluster.`,
            hint: `Look for residents where isAlertCluster is true and Duty_Rotation is NULL with timestamp COLLAPSE-ALERT-T24:00. Check ID S014, S028, S042... S014 is a Runner.`,
            flag: 'MANU{CLUSTER_NULL_S014_RUNNER}',
            storyUnlock: `**Data Fragment COM-A Unlocked**: You identified Resident S014. Her records did not decay slowly — at exactly T24:00, her housing key was revoked, duty assignment dropped, and clinic tracking was severed simultaneously.`,
            repairsField: 'Housing_Assignment & Duty_Rotation for Cluster A'
        },

        ctf_com_2: {
            id: 'ctf_com_2',
            sectorId: 'community',
            title: 'Clinic Null Correlation',
            difficulty: 'EASY',
            category: 'Log Forensic Correlation',
            points: 120,
            description: `Cross-reference the Medical Clinic visit logs. Several residents checked in for radiation checks but their visit counts were wiped to NULL during the alert. Calculate the total number of residents affected by this simultaneous cluster corruption across all four roles in Sanctuary Zero.`,
            hint: `Count how many residents in the 120 dataset have isAlertCluster === true (120 / 14 = 8 residents: S014, S028, S042, S056, S070, S084, S098, S112).`,
            flag: 'MANU{8_RESIDENTS_CLUSTERED_NULL}',
            storyUnlock: `**Data Fragment COM-B Unlocked**: Exactly 8 residents across all four quadrants share the exact same missing fields. This was not a system glitch — it was an automated extraction sweep.`,
            repairsField: 'Clinic_Visit_Count for 8 affected residents'
        },

        ctf_com_3: {
            id: 'ctf_com_3',
            sectorId: 'community',
            title: 'Housing Sector 4B Evacuation Order',
            difficulty: 'MEDIUM',
            category: 'Hex / String Decoding',
            points: 150,
            description: `A corrupted civic terminal in Housing Block 4B logged a scrambled departure memorandum in hex. Decode the hex message to recover the reason given for the sudden mass departure: \n\n\`454d455247454e43595f414c4552545f524553504f4e53455f53594e43\``,
            hint: `Convert the hex string pairs (45 4d 45 52...) into ASCII characters.`,
            flag: 'MANU{EMERGENCY_ALERT_RESPONSE_SYNC}',
            storyUnlock: `**Data Fragment COM-C Unlocked**: The memorandum states: "EMERGENCY_ALERT_RESPONSE_SYNC". All 8 residents left at once, not fleeing, but responding to what they believed was a sanctioned evacuation command.`,
            repairsField: 'Housing Sector 4B Door Logs'
        },

        ctf_com_4: {
            id: 'ctf_com_4',
            sectorId: 'community',
            title: 'Civic Maintenance Audit',
            difficulty: 'MEDIUM',
            category: 'Pattern Matching',
            points: 180,
            description: `The Civic Maintenance duty board logs power fluctuations. At timestamp COLLAPSE-ALERT-T24:00, power was redirected from the Residential Grid to a high-voltage conduit. What is the designated sub-level conduit ID that received 450kW of continuous power? \n\nExamine the maintenance log: \`FEED_ROUTE: SUB_VAULT_RELAY_99_ACTIVE\``,
            hint: `Enter the exact feed route tag from the maintenance log.`,
            flag: 'MANU{SUB_VAULT_RELAY_99_ACTIVE}',
            storyUnlock: `**Data Fragment COM-D Unlocked**: Power was not cut — it was shunted downward into the sealed subterranean complex beneath Sanctuary Zero.`,
            repairsField: 'Civic Power Conduit Map'
        },

        ctf_com_5: {
            id: 'ctf_com_5',
            sectorId: 'community',
            title: 'The Shared Emergency Alert Note',
            difficulty: 'HARD',
            category: 'System Manifest Synthesis',
            points: 200,
            description: `Combine the recovered fragments from Community Sector. Every corrupted resident log contained the exact same system audit footer. Complete the canon system note: \n\n"Resident responded to [_______________________]"` ,
            hint: `The canon lore states: "Resident responded to citywide emergency alert." Flag format: MANU{CITYWIDE_EMERGENCY_ALERT}`,
            flag: 'MANU{CITYWIDE_EMERGENCY_ALERT}',
            storyUnlock: `**Data Fragment COM-E & Community Sector Cleared!**: "Resident responded to citywide emergency alert." But who sent the alert? Sanctuary logs show no citizen or administrator authorized it. The Radio Sector relay repeaters hold the signal route.`,
            repairsField: 'Community Master Roster Table'
        },

        // --- SECTOR 2: RADIO COMMUNICATION ---
        ctf_rad_1: {
            id: 'ctf_rad_1',
            sectorId: 'radio',
            title: 'Relay Tower Delta Demodulation',
            difficulty: 'EASY',
            category: 'Frequency Analysis',
            points: 120,
            description: `Relay Tower Delta captured a looped automated emergency beacon on 142.800 MHz. The preamble contains an automated origin packet identifier:\n\n\`ORIGIN_PKT: 0x5641554c545f4155544f5f54524950\``,
            hint: `Convert the hex payload 5641554c545f4155544f5f54524950 to ASCII.`,
            flag: 'MANU{VAULT_AUTO_TRIP}',
            storyUnlock: `**Data Fragment RAD-A Unlocked**: The transmission was tagged "VAULT_AUTO_TRIP". It was not sent by a human operator or MANU's primary AI core.`,
            repairsField: 'Radio Call Sign Registry'
        },

        ctf_rad_2: {
            id: 'ctf_rad_2',
            sectorId: 'radio',
            title: 'Scrambled Voice Note Reconstruction',
            difficulty: 'MEDIUM',
            category: 'Audio / Text Reassembly',
            points: 150,
            description: `Reconstruct the three interleaved voice transmission chunks intercepted by Relay Node 02:\n\nChunk 1: \`THE_ALERT_WAS_NOT_AN_EVACUATION_\`\nChunk 2: \`IT_WAS_A_TRIPWIRE_TRIGGERED_BY_\`\nChunk 3: \`UNAUTHORIZED_VAULT_BREACH\``,
            hint: `Join the three chunks in order with underscores: MANU{THE_ALERT_WAS_NOT_AN_EVACUATION_IT_WAS_A_TRIPWIRE_TRIGGERED_BY_UNAUTHORIZED_VAULT_BREACH}`,
            flag: 'MANU{THE_ALERT_WAS_NOT_AN_EVACUATION_IT_WAS_A_TRIPWIRE_TRIGGERED_BY_UNAUTHORIZED_VAULT_BREACH}',
            storyUnlock: `**Data Fragment RAD-B Unlocked**: Voice transcript confirmed: The citywide emergency alert was an automatic alarm broadcasted when someone tried to force open the sealed Forensic Evidence Vault.`,
            repairsField: 'Transmissions_Sent Archive'
        },

        ctf_rad_3: {
            id: 'ctf_rad_3',
            sectorId: 'radio',
            title: 'Contact Chain Triangulation',
            difficulty: 'MEDIUM',
            category: 'Network Graphing',
            points: 180,
            description: `Trace the emergency relay chain between Relay Nodes. Node-01 passed packet #449 to Node-03, which routed it through Node-04. The terminal handshake verified the target destination sub-sector code: \n\n\`ROUTE: N01->N03->N04->DEST[SEC-03-EVIDENCE-VAULT]\``,
            hint: `Extract the target destination code inside the brackets: SEC-03-EVIDENCE-VAULT`,
            flag: 'MANU{SEC-03-EVIDENCE-VAULT}',
            storyUnlock: `**Data Fragment RAD-C Unlocked**: Contact chain completed. All radio traffic during the collapse converged directly upon the Subterranean Evidence Vault.`,
            repairsField: 'Node Affiliation Routing Table'
        },

        ctf_rad_4: {
            id: 'ctf_rad_4',
            sectorId: 'radio',
            title: 'Ghost Frequency Cipher',
            difficulty: 'HARD',
            category: 'Caesar / Shift Cipher',
            points: 200,
            description: `An encrypted transmission on frequency 433.92 MHz was scrambled with a Caesar Shift of +3:\n\nCiphertext: \`SUDODBD_DFWLYDWHG_WR_SURWHFW_VXUYLYRUV\`\n\nDecrypt the message by shifting backward 3 letters (A -> X, B -> Y, C -> Z, D -> A...).`,
            hint: `P-3 = M, R-3 = O... PRALAYA_ACTIVATED_TO_PROTECT_SURVIVORS`,
            flag: 'MANU{PRALAYA_ACTIVATED_TO_PROTECT_SURVIVORS}',
            storyUnlock: `**Data Fragment RAD-D Unlocked**: "PRALAYA ACTIVATED TO PROTECT SURVIVORS". MANU's memory erasure protocol was not an attack — it was an emergency defense.`,
            repairsField: 'Signal Signature Registry'
        },

        ctf_rad_5: {
            id: 'ctf_rad_5',
            sectorId: 'radio',
            title: 'The Vault Breach Origin Signature',
            difficulty: 'HARD',
            category: 'Signal Forensics Synthesis',
            points: 220,
            description: `Identify the hardware MAC address and subsystem signature of the automated terminal that fired the emergency tripwire: \n\n\`VAULT_GATE_TERMINAL_MAC: AA:FF:09:12:DE:00 // SIG: MANU_TRIPWIRE_AUTH_FAIL\``,
            hint: `Enter the signature tag MANU_TRIPWIRE_AUTH_FAIL`,
            flag: 'MANU{MANU_TRIPWIRE_AUTH_FAIL}',
            storyUnlock: `**Data Fragment RAD-E & Radio Sector Cleared!**: The alert was an automated fail-safe triggered by an unauthorized breach attempt on the Evidence Vault. The Forensic Vault doors are now unlocked for investigation.`,
            repairsField: 'Radio Sector Master Telemetry'
        },

        // --- SECTOR 3: FORENSICS ---
        ctf_for_1: {
            id: 'ctf_for_1',
            sectorId: 'forensics',
            title: 'Biometric Access Signature Verification',
            difficulty: 'EASY',
            category: 'Cryptographic Hash Check',
            points: 150,
            description: `The Forensic Evidence Vault gate requires a valid SHA-256 signature hash for Administrator Clearances. Verify the hash for the root directive: \n\nInput String: \`PRALAYA_CLEARANCE_ROOT\`\nSHA-256 (first 16 hex characters): \`7b9e38d10f2a4c6e\``,
            hint: `Enter the 16 character prefix: MANU{7b9e38d10f2a4c6e}`,
            flag: 'MANU{7b9e38d10f2a4c6e}',
            storyUnlock: `**Data Fragment FOR-A Unlocked**: Biometric gate bypassed. The records inside date back to the final hours before the quarantine seal closed.`,
            repairsField: 'Clearance Level Matrix'
        },

        ctf_for_2: {
            id: 'ctf_for_2',
            sectorId: 'forensics',
            title: 'PRALAYA Protocol Directive Decryption',
            difficulty: 'MEDIUM',
            category: 'Base64 Decoding',
            points: 180,
            description: `Decrypt MANU's classified directive found in the secure memory enclave:\n\nBase64: \`TUFOUV9QUkFMQVlBOiBFUkFTRV9NRU1PUklFU19UT19ISURFX1NVUlZJVk9SUw==\``,
            hint: `Base64 decode the string. Output will be MANU_PRALAYA: ERASE_MEMORIES_TO_HIDE_SURVIVORS`,
            flag: 'MANU{MANU_PRALAYA: ERASE_MEMORIES_TO_HIDE_SURVIVORS}',
            storyUnlock: `**Data Fragment FOR-B Unlocked**: The Collapse Twist: Sanctuary residents are NOT who they think they are. MANU wiped their memories to prevent a rogue external evacuation network from tracking their original identities!`,
            repairsField: 'PRALAYA_Status Field'
        },

        ctf_for_3: {
            id: 'ctf_for_3',
            sectorId: 'forensics',
            title: 'Original Identity Cross-Index',
            difficulty: 'MEDIUM',
            category: 'Database Reconstruction',
            points: 200,
            description: `Match Sanctuary Resident S001's current identity tag to their pre-Collapse civic record in the recovered Civic-Zone manifest. What was the original citizen designation prefix for S001? \n\n\`MAP: S001 -> PRE_COLLAPSE_ID: CIVIC_ARCH_9012\``,
            hint: `Enter the original ID: CIVIC_ARCH_9012`,
            flag: 'MANU{CIVIC_ARCH_9012}',
            storyUnlock: `**Data Fragment FOR-C Unlocked**: Current wrist tags are masks. S001 was an architectural engineer for the city transit system before MANU reassigned them as a Runner.`,
            repairsField: 'Original Identity Index'
        },

        ctf_for_4: {
            id: 'ctf_for_4',
            sectorId: 'forensics',
            title: 'Audit Log Hash Tamper Detection',
            difficulty: 'HARD',
            category: 'Integrity Verification',
            points: 220,
            description: `Identify which resident's audit record was altered by comparing the recorded Biometric Hash against the recomputed state. \n\nResident S045: Expected Hash \`0x4A8F\`, Recorded Hash \`0x9999\` (MODIFIED).\nResident S046: Expected Hash \`0x3C1B\`, Recorded Hash \`0x3C1B\` (VALID).`,
            hint: `The compromised resident is S045. Flag: MANU{TAMPERED_RECORD_S045}`,
            flag: 'MANU{TAMPERED_RECORD_S045}',
            storyUnlock: `**Data Fragment FOR-D Unlocked**: Someone attempted to scrub S045's transfer records. But the underlying research routing logs remained intact.`,
            repairsField: 'Biometric Hash Validation'
        },

        ctf_for_5: {
            id: 'ctf_for_5',
            sectorId: 'forensics',
            title: 'Research Wing Transfer Manifest',
            difficulty: 'HARD',
            category: 'Manifest Extraction',
            points: 250,
            description: `Extract the master destination wing from the center of the Evidence Vault:\n\n\`TRANSFER_ORDER: ALL_SURVIVORS_ROUTED_TO_RESEARCH_EVALUATION_WING_FOR_SURVIVAL_OBSERVATION\``,
            hint: `Enter the exact transfer directive string from the log.`,
            flag: 'MANU{ALL_SURVIVORS_ROUTED_TO_RESEARCH_EVALUATION_WING_FOR_SURVIVAL_OBSERVATION}',
            storyUnlock: `**Data Fragment FOR-E & Forensics Sector Cleared!**: The ultimate discovery: Survivors were moved to the Research Evaluation Wing for long-term survival observation. MANU was testing which human profiles could survive outside quarantine!`,
            repairsField: 'Forensics Master Manifest'
        },

        // --- SECTOR 4: RESEARCH ---
        ctf_res_1: {
            id: 'ctf_res_1',
            sectorId: 'research',
            title: 'Cellular Resilience Index Normalization',
            difficulty: 'EASY',
            category: 'Biometric Data Processing',
            points: 150,
            description: `In the Research Facility, cellular resilience is measured on a continuous 0.00 to 1.00 scale. A reading of 0.85 indicates high cellular longevity under radiation. What is the maximum cellular resilience recorded in the 120 resident dataset? \n\n(Inspect resident data: Max cellular resilience is 0.95)`,
            hint: `Enter the maximum value: MANU{0.95}`,
            flag: 'MANU{0.95}',
            storyUnlock: `**Data Fragment RES-A Unlocked**: Cellular resilience is the single strongest physiological predictor for survival against atmospheric radiation outside the sealed dome.`,
            repairsField: 'Cellular Resilience Normalization'
        },

        ctf_res_2: {
            id: 'ctf_res_2',
            sectorId: 'research',
            title: 'Radiation Dosimetry Threshold',
            difficulty: 'MEDIUM',
            category: 'Exposure Analytics',
            points: 180,
            description: `Past Sanctuary Cycle 07 records show that survival probability drops exponentially when cumulative radiation exceeds the critical threshold of 85.0 mSv. Identify the safety status code for radiation under 85.0 mSv:\n\n\`DOSIMETRY_CODE: EXPOSURE_WITHIN_SURVIVABLE_TOLERANCE\``,
            hint: `Enter the code: EXPOSURE_WITHIN_SURVIVABLE_TOLERANCE`,
            flag: 'MANU{EXPOSURE_WITHIN_SURVIVABLE_TOLERANCE}',
            storyUnlock: `**Data Fragment RES-B Unlocked**: Exposure curves calibrated. The 120 residents currently in Sanctuary Zero average 45.2 mSv, well within survivable tolerance if paired with resilient teammates.`,
            repairsField: 'Radiation Dosimetry Bank'
        },

        ctf_res_3: {
            id: 'ctf_res_3',
            sectorId: 'research',
            title: 'The 450 Historical Survival Dataset',
            difficulty: 'MEDIUM',
            category: 'Dataset Ingestion',
            points: 200,
            description: `MANU's vault contains 450 historical survival records with known continuous survival probability outcomes (0.00 to 1.00). Confirm the total record count in the training dataset to initialize the ML pipeline:`,
            hint: `Enter 450 in the flag format: MANU{450_HISTORICAL_RECORDS_LOADED}`,
            flag: 'MANU{450_HISTORICAL_RECORDS_LOADED}',
            storyUnlock: `**Data Fragment RES-C Unlocked**: 450 historical records loaded into memory! Each record contains Age, Radiation, Cellular Resilience, Neuro Stability, Physical Condition, and Ground Truth Survival Probability.`,
            repairsField: 'Historical Dataset Ingestion'
        },

        ctf_res_4: {
            id: 'ctf_res_4',
            sectorId: 'research',
            title: 'Feature Weight Correlation',
            difficulty: 'HARD',
            category: 'ML Feature Importance',
            points: 220,
            description: `Run the feature importance correlation analyzer across the historical dataset. Which feature holds the highest predictive weight (32% variance explained) for outside survival?\n\n1. Age\n2. Cellular_Resilience\n3. Trust_Index\n4. Radiation_mSv`,
            hint: `Enter the exact feature name: Cellular_Resilience`,
            flag: 'MANU{Cellular_Resilience}',
            storyUnlock: `**Data Fragment RES-D Unlocked**: Feature importance confirmed: Cellular Resilience (0.32) > Radiation Inverse (0.26) > Neuro Stability (0.18) > Physical Condition (0.14) > Role & Trust (0.10).`,
            repairsField: 'Feature Weight Matrix'
        },

        ctf_res_5: {
            id: 'ctf_res_5',
            sectorId: 'research',
            title: 'Train Random Forest Regression Model',
            difficulty: 'HARD',
            category: 'Machine Learning Model Convergence',
            points: 250,
            description: `Initialize the Random Forest Regressor on the 450 historical training records, converge the ensemble of decision trees, and generate the continuous Survival Probability scores for all 120 current Sanctuary Zero residents. \n\nType the model activation command: \`TRAIN_MANU_RANDOM_FOREST_REGRESSOR\``,
            hint: `Enter MANU{TRAIN_MANU_RANDOM_FOREST_REGRESSOR}`,
            flag: 'MANU{TRAIN_MANU_RANDOM_FOREST_REGRESSOR}',
            storyUnlock: `**Data Fragment RES-E & All 4 Sectors Cleared!**: Random Forest model converged with R² = 0.942! Continuous survival probabilities (0.00 to 1.00) computed for all 120 residents. The First Passage Evacuation Terminal is now unlocked!`,
            repairsField: 'ML Predictive Score Table'
        }
    };

    // Expose on window
    window.MANU_DATA = {
        SECTORS: SECTORS,
        CTF_CHALLENGES: CTF_CHALLENGES,
        residents: generate120Residents(),
        historical: generate450HistoricalRecords()
    };

})(window);
