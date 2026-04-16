const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const RECEPTIONIST_KEY = process.env.receptionist_key;
const OBSERVER_KEY = process.env.observer_key;
const SAFETY_KEY = process.env.safety_key;

if (!RECEPTIONIST_KEY || !OBSERVER_KEY || !SAFETY_KEY) {
    console.error('Error: Access keys must be set as environment variables');
    console.error('Required: receptionist_key, observer_key, safety_key');
    process.exit(1);
}

const IS_DEV = process.env.npm_lifecycle_event === 'dev';
const RACE_DURATION = IS_DEV ? 60 : 600;

app.use(express.static('public'));
app.use(express.json());

let raceSessions = [];
let currentRaceIndex = -1;
let currentRace = null;
let raceTimer = null;
let raceTimeRemaining = RACE_DURATION;
let raceMode = 'danger';
let raceActive = false;
let raceEnded = false;

function generateId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function assignCarsToDrivers(drivers) {
    const limitedDrivers = drivers.slice(0, 8);
    return limitedDrivers.map((driver, index) => ({
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
    return Math.round(lapTime * 1000) / 1000;
}

function broadcastNextRaceInfo() {
    let nextRace = null;
    if (currentRace) {
        const nextIndex = currentRaceIndex + 1;
        if (nextIndex < raceSessions.length) nextRace = raceSessions[nextIndex];
    } else if (raceSessions.length > 0) {
        nextRace = raceSessions[0];
    }
    io.emit('next-race-info', nextRace);
}

function broadcastUpcomingRaceToSafety() {
    let upcomingRace = null;
    if (!raceActive && !raceEnded && currentRace) {
        upcomingRace = currentRace;
    } else if (raceSessions.length > 0) {
        upcomingRace = raceSessions[0];
    }
    io.to('safety-room').emit('current-race', upcomingRace);
}

function startRaceTimer() {
    if (raceTimer) clearInterval(raceTimer);
    raceTimer = setInterval(() => {
        if (raceTimeRemaining > 0 && raceActive) {
            raceTimeRemaining--;
            io.emit('timer-update', { remaining: raceTimeRemaining, total: RACE_DURATION });
            if (raceTimeRemaining === 0) finishRace();
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

    if (currentRaceIndex < raceSessions.length - 1) {
        currentRaceIndex++;
        currentRace = raceSessions[currentRaceIndex];
        raceTimeRemaining = RACE_DURATION;
        raceEnded = false;
        io.emit('next-race-ready', currentRace);
        broadcastNextRaceInfo();
        broadcastUpcomingRaceToSafety();
    } else {
        currentRace = null;
        currentRaceIndex = -1;
        broadcastNextRaceInfo();
        broadcastUpcomingRaceToSafety();
    }
}

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('authenticate', ({ role, key }) => {
        let validKey = false;
        switch(role) {
            case 'receptionist': validKey = key === RECEPTIONIST_KEY; break;
            case 'observer': validKey = key === OBSERVER_KEY; break;
            case 'safety': validKey = key === SAFETY_KEY; break;
        }
        setTimeout(() => {
            if (validKey) {
                socket.authenticated = true;
                socket.role = role;
                if (role === 'safety') socket.join('safety-room');
                socket.emit('authenticated', { success: true });
                if (role === 'receptionist') {
                    socket.emit('race-sessions', raceSessions);
                } else if (role === 'safety') {
                    let upcomingRace = raceSessions[0] || null;
                    socket.emit('current-race', upcomingRace);
                    socket.emit('race-status', { mode: raceMode, active: raceActive, remaining: raceTimeRemaining, ended: raceEnded });
                } else if (role === 'observer' && currentRace) {
                    socket.emit('current-race-drivers', currentRace.drivers);
                    socket.emit('race-status', { mode: raceMode, ended: raceEnded });
                }
            } else {
                socket.emit('authenticated', { success: false, error: 'Invalid access key' });
            }
        }, 500);
    });

    socket.on('public-connect', () => {
        socket.authenticated = true;
        socket.role = 'public';
        if (currentRace) {
            socket.emit('leaderboard-update', currentRace.drivers);
            socket.emit('timer-update', { remaining: raceTimeRemaining, total: RACE_DURATION });
        }
        socket.emit('race-mode-changed', { mode: raceMode });
        broadcastNextRaceInfo();
    });

    socket.on('create-race-session', (sessionData) => {
        if (!socket.authenticated || socket.role !== 'receptionist') return;
        if (!sessionData.name || !sessionData.name.trim()) {
            socket.emit('error', { message: 'Session name is required' });
            return;
        }
        const drivers = (sessionData.drivers || []).slice(0, 8);
        const session = {
            id: generateId(),
            name: sessionData.name.trim(),
            time: sessionData.time,
            drivers: assignCarsToDrivers(drivers),
            created: new Date()
        };
        raceSessions.push(session);
        io.emit('race-sessions-updated', raceSessions);
        broadcastNextRaceInfo();
        broadcastUpcomingRaceToSafety();
    });

    socket.on('update-race-session', ({ sessionId, name, drivers }) => {
        if (!socket.authenticated || socket.role !== 'receptionist') return;
        const session = raceSessions.find(s => s.id === sessionId);
        if (session) {
            if (name && name.trim()) session.name = name.trim();
            if (drivers) {
                const limitedDrivers = drivers.slice(0, 8);
                session.drivers = assignCarsToDrivers(limitedDrivers);
            }
            io.emit('race-sessions-updated', raceSessions);
            if (currentRace && currentRace.id === sessionId) {
                currentRace.drivers = session.drivers;
                io.emit('leaderboard-update', currentRace.drivers);
            }
            broadcastNextRaceInfo();
            broadcastUpcomingRaceToSafety();
        }
    });

    socket.on('delete-race-session', (sessionId) => {
        if (!socket.authenticated || socket.role !== 'receptionist') return;
        raceSessions = raceSessions.filter(s => s.id !== sessionId);
        io.emit('race-sessions-updated', raceSessions);
        broadcastNextRaceInfo();
        broadcastUpcomingRaceToSafety();
    });

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
            currentRace.drivers.forEach(driver => {
                driver.currentLap = 1;
                driver.lapStartTime = Date.now();
                driver.fastestLap = null;
                driver.laps = [];
            });
            startRaceTimer();
            io.emit('race-started', currentRace);
            io.emit('race-mode-changed', { mode: raceMode });
            io.emit('timer-update', { remaining: raceTimeRemaining, total: RACE_DURATION });
            broadcastNextRaceInfo();
            broadcastUpcomingRaceToSafety();
        }
    });

    socket.on('change-race-mode', (mode) => {
        if (!socket.authenticated || socket.role !== 'safety') return;
        if (raceEnded || raceMode === 'finish') return;
        const validModes = ['safe', 'hazard', 'danger'];
        if (validModes.includes(mode)) {
            raceMode = mode;
            raceActive = (mode !== 'danger');
            io.emit('race-mode-changed', { mode });
        }
    });

    socket.on('end-session', () => {
        if (!socket.authenticated || socket.role !== 'safety') return;
        if (raceMode === 'finish') {
            endRaceSession();
        }
    });

    socket.on('record-lap', ({ carNumber }) => {
        if (!socket.authenticated || socket.role !== 'observer') return;
        if (!currentRace || raceEnded) return;
        const driver = currentRace.drivers.find(d => d.carNumber === carNumber);
        if (driver && driver.lapStartTime) {
            const lapTime = calculateLapTime(driver);
            if (lapTime) {
                driver.laps.push({ lapNumber: driver.currentLap, time: lapTime });
                if (!driver.fastestLap || lapTime < driver.fastestLap) {
                    driver.fastestLap = lapTime;
                }
                driver.currentLap++;
                driver.lapStartTime = Date.now();
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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/front-desk', (req, res) => res.sendFile(path.join(__dirname, 'public', 'front-desk.html')));
app.get('/race-control', (req, res) => res.sendFile(path.join(__dirname, 'public', 'race-control.html')));
app.get('/lap-line-tracker', (req, res) => res.sendFile(path.join(__dirname, 'public', 'lap-line-tracker.html')));
app.get('/leader-board', (req, res) => res.sendFile(path.join(__dirname, 'public', 'leader-board.html')));
app.get('/next-race', (req, res) => res.sendFile(path.join(__dirname, 'public', 'next-race.html')));
app.get('/race-countdown', (req, res) => res.sendFile(path.join(__dirname, 'public', 'race-countdown.html')));
app.get('/race-flags', (req, res) => res.sendFile(path.join(__dirname, 'public', 'race-flags.html')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Race duration: ${RACE_DURATION} seconds (${IS_DEV ? 'dev' : 'production'} mode)`);
});