const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Environment variables for access keys
const RECEPTIONIST_KEY = process.env.receptionist_key;
const OBSERVER_KEY = process.env.observer_key;
const SAFETY_KEY = process.env.safety_key;

// Validate environment variables
if (!RECEPTIONIST_KEY || !OBSERVER_KEY || !SAFETY_KEY) {
    console.error('Error: Access keys must be set as environment variables');
    console.error('Required: receptionist_key, observer_key, safety_key');
    process.exit(1);
}

// Check if running in dev mode (1 minute races)
const IS_DEV = process.env.npm_lifecycle_event === 'dev';
const RACE_DURATION = IS_DEV ? 60 : 600; // 1 minute or 10 minutes in seconds

app.use(express.static('public'));
app.use(express.json());

// In-memory data storage
let raceSessions = [];
let currentRaceIndex = -1;
let currentRace = null;
let raceTimer = null;
let raceTimeRemaining = RACE_DURATION;
let raceMode = 'danger'; // safe, hazard, danger, finish
let raceActive = false;
let raceEnded = false;

// Helper functions
function generateId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function assignCarsToDrivers(drivers) {
    // Simple assignment: assign cars 1-8 in order
    return drivers.map((driver, index) => ({
        ...driver,
        carNumber: index + 1,
        laps: [],
        fastestLap: null,
        currentLap: 0,
        lapStartTime: null
    }));
}

function calculateLapTime(driver) {
    if (!driver.lapStartTime) return null;
    const lapTime = (Date.now() - driver.lapStartTime) / 1000;
    return Math.round(lapTime * 1000) / 1000; // Round to 3 decimal places
}

function startRaceTimer() {
    if (raceTimer) clearInterval(raceTimer);
    
    raceTimer = setInterval(() => {
        if (raceTimeRemaining > 0 && raceActive) {
            raceTimeRemaining--;
            
            io.emit('timer-update', {
                remaining: raceTimeRemaining,
                total: RACE_DURATION
            });
            
            if (raceTimeRemaining === 0) {
                finishRace();
            }
        }
    }, 1000);
}

function finishRace() {
    if (raceMode !== 'finish') {
        raceMode = 'finish';
        raceActive = false;
        clearInterval(raceTimer);
        
        io.emit('race-mode-changed', { mode: raceMode });
        io.emit('race-finished');
    }
}

function endRaceSession() {
    if (currentRace) {
        currentRace.completed = true;
        currentRace.endTime = new Date();
    }
    
    raceMode = 'danger';
    raceActive = false;
    raceEnded = true;
    clearInterval(raceTimer);
    
    io.emit('race-mode-changed', { mode: raceMode });
    io.emit('session-ended');
    
    // Move to next race
    if (currentRaceIndex < raceSessions.length - 1) {
        currentRaceIndex++;
        currentRace = raceSessions[currentRaceIndex];
        raceTimeRemaining = RACE_DURATION;
        raceEnded = false;
        
        io.emit('next-race-ready', currentRace);
    }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    // Authentication
    socket.on('authenticate', ({ role, key }) => {
        let validKey = false;
        
        switch(role) {
            case 'receptionist':
                validKey = key === RECEPTIONIST_KEY;
                break;
            case 'observer':
                validKey = key === OBSERVER_KEY;
                break;
            case 'safety':
                validKey = key === SAFETY_KEY;
                break;
        }
        
        setTimeout(() => {
            if (validKey) {
                socket.authenticated = true;
                socket.role = role;
                socket.emit('authenticated', { success: true });
                
                // Send initial data based on role
                if (role === 'receptionist') {
                    socket.emit('race-sessions', raceSessions);
                } else if (role === 'safety') {
                    socket.emit('current-race', currentRace);
                    socket.emit('race-status', {
                        mode: raceMode,
                        active: raceActive,
                        remaining: raceTimeRemaining,
                        ended: raceEnded
                    });
                } else if (role === 'observer' && currentRace) {
                    socket.emit('current-race-drivers', currentRace.drivers);
                    socket.emit('race-status', {
                        mode: raceMode,
                        ended: raceEnded
                    });
                }
            } else {
                socket.emit('authenticated', { 
                    success: false, 
                    error: 'Invalid access key' 
                });
            }
        }, 500);
    });
    
    // Public connection (no auth required)
    socket.on('public-connect', () => {
        socket.authenticated = true;
        socket.role = 'public';
        
        // Send current state
        if (currentRace) {
            socket.emit('leaderboard-update', currentRace.drivers);
            socket.emit('timer-update', {
                remaining: raceTimeRemaining,
                total: RACE_DURATION
            });
        }
        socket.emit('race-mode-changed', { mode: raceMode });
        socket.emit('next-race-info', currentRace || raceSessions[currentRaceIndex]);
    });
    
    // Receptionist actions
    socket.on('create-race-session', (sessionData) => {
        if (!socket.authenticated || socket.role !== 'receptionist') return;
        
        const session = {
            id: generateId(),
            name: sessionData.name,
            time: sessionData.time,
            drivers: assignCarsToDrivers(sessionData.drivers || []),
            created: new Date()
        };
        
        raceSessions.push(session);
        io.emit('race-sessions-updated', raceSessions);
    });
    
    socket.on('update-race-session', ({ sessionId, drivers }) => {
        if (!socket.authenticated || socket.role !== 'receptionist') return;
        
        const session = raceSessions.find(s => s.id === sessionId);
        if (session) {
            session.drivers = assignCarsToDrivers(drivers);
            io.emit('race-sessions-updated', raceSessions);
            
            if (currentRace && currentRace.id === sessionId) {
                currentRace.drivers = session.drivers;
                io.emit('leaderboard-update', currentRace.drivers);
            }
        }
    });
    
    socket.on('delete-race-session', (sessionId) => {
        if (!socket.authenticated || socket.role !== 'receptionist') return;
        
        raceSessions = raceSessions.filter(s => s.id !== sessionId);
        io.emit('race-sessions-updated', raceSessions);
    });
    
    // Safety Official actions
    socket.on('start-race', () => {
        if (!socket.authenticated || socket.role !== 'safety') return;
        if (!currentRace && raceSessions.length > 0) {
            currentRaceIndex = 0;
            currentRace = raceSessions[0];
        }
        
        if (currentRace) {
            raceMode = 'safe';
            raceActive = true;
            raceEnded = false;
            raceTimeRemaining = RACE_DURATION;
            
            // Initialize lap timing for all drivers
            currentRace.drivers.forEach(driver => {
                driver.currentLap = 1;
                driver.lapStartTime = Date.now();
                driver.fastestLap = null;
                driver.laps = [];
            });
            
            startRaceTimer();
            
            io.emit('race-started', currentRace);
            io.emit('race-mode-changed', { mode: raceMode });
            io.emit('timer-update', {
                remaining: raceTimeRemaining,
                total: RACE_DURATION
            });
            
            // Update next race display
            const nextRace = raceSessions[currentRaceIndex + 1];
            if (nextRace) {
                io.emit('next-race-info', nextRace);
            }
        }
    });
    
    socket.on('change-race-mode', (mode) => {
        if (!socket.authenticated || socket.role !== 'safety') return;
        if (raceEnded || raceMode === 'finish') return;
        
        const validModes = ['safe', 'hazard', 'danger'];
        if (validModes.includes(mode)) {
            raceMode = mode;
            
            if (mode === 'danger') {
                raceActive = false;
            } else {
                raceActive = true;
            }
            
            io.emit('race-mode-changed', { mode });
        }
    });
    
    socket.on('end-session', () => {
        if (!socket.authenticated || socket.role !== 'safety') return;
        if (raceMode === 'finish') {
            endRaceSession();
        }
    });
    
    // Lap-line Observer actions
    socket.on('record-lap', ({ driverId, carNumber }) => {
        if (!socket.authenticated || socket.role !== 'observer') return;
        if (!currentRace || raceEnded) return;
        
        const driver = currentRace.drivers.find(d => d.carNumber === carNumber);
        if (driver && driver.lapStartTime) {
            const lapTime = calculateLapTime(driver);
            
            if (lapTime) {
                driver.laps.push({
                    lapNumber: driver.currentLap,
                    time: lapTime
                });
                
                // Update fastest lap
                if (!driver.fastestLap || lapTime < driver.fastestLap) {
                    driver.fastestLap = lapTime;
                }
                
                // Increment lap and reset start time
                driver.currentLap++;
                driver.lapStartTime = Date.now();
                
                // Sort drivers by fastest lap
                currentRace.drivers.sort((a, b) => {
                    if (!a.fastestLap) return 1;
                    if (!b.fastestLap) return -1;
                    return a.fastestLap - b.fastestLap;
                });
                
                io.emit('leaderboard-update', currentRace.drivers);
                socket.emit('lap-recorded', { carNumber, lapTime });
            }
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Routes for interfaces
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/front-desk', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'front-desk.html'));
});

app.get('/race-control', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'race-control.html'));
});

app.get('/lap-line-tracker', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'lap-line-tracker.html'));
});

app.get('/leader-board', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'leader-board.html'));
});

app.get('/next-race', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'next-race.html'));
});

app.get('/race-countdown', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'race-countdown.html'));
});

app.get('/race-flags', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'race-flags.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Race duration: ${RACE_DURATION} seconds (${IS_DEV ? 'dev' : 'production'} mode)`);
});