require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 1. NÕUE: Juurdepääsuvõtmed keskkonnamuutujatest
const KEYS = {
    frontdesk: process.env.FRONTDESK_KEY || "1234",
    racecontrol: process.env.RACECONTROL_KEY || "1234",
    laptracker: process.env.LAPTRACKER_KEY || "1234"
};

// 2. NÕUE: Sõidu kestus vastavalt režiimile (Dev: 1min, Prod: 10min)
const IS_DEV = process.env.NODE_ENV === "development";
const RACE_DURATION = IS_DEV ? 60 : 600;

let state = {
    sessions: [],
    currentRace: null,
    raceMode: "danger",
    timer: RACE_DURATION
};

app.use(express.static(path.join(__dirname, "../public")));

// Marsruudid ilma .html lõputa (Lahendab Cannot GET vea)
const pages = ['front-desk', 'race-control', 'lap-line-tracker', 'leader-board', 'next-race'];
pages.forEach(p => {
    app.get(`/${p}`, (req, res) => res.sendFile(path.join(__dirname, `../public/${p}.html`)));
});

let timerInterval = null;

io.on("connection", (socket) => {
    socket.emit("state", state);

    // Sisselogimine rolli ja 500ms viivitusega vale parooli korral
    socket.on("login", ({ roleType, key }) => {
        const correctKey = KEYS[roleType];
        if (key === correctKey) {
            socket.emit("authSuccess");
        } else {
            setTimeout(() => {
                socket.emit("authError", "Vale juurdepääsuvõti!");
            }, 500);
        }
    });

    socket.on("addSession", (drivers) => {
        state.sessions.push({ drivers });
        io.emit("state", state);
    });

    socket.on("startRace", () => {
        if (state.sessions.length > 0 && !state.currentRace) {
            state.currentRace = state.sessions.shift();
            state.currentRace.drivers.forEach(d => {
                d.laps = 0; d.fastestLap = null; d.lastLapTime = null;
            });
            state.raceMode = "safe";
            state.timer = RACE_DURATION;

            if (timerInterval) clearInterval(timerInterval);
            timerInterval = setInterval(() => {
                if (state.timer > 0 && state.raceMode !== "finish") {
                    state.timer--;
                    io.emit("state", state);
                } else {
                    state.raceMode = "finish";
                    clearInterval(timerInterval);
                    io.emit("state", state);
                }
            }, 1000);
            io.emit("state", state);
        }
    });

    socket.on("setMode", (mode) => {
        if (state.raceMode !== "finish") {
            state.raceMode = mode;
            io.emit("state", state);
        }
    });

    socket.on("lap", (index) => {
        if (!state.currentRace || state.raceMode === "danger") return;
        const d = state.currentRace.drivers[index];
        const now = Date.now();
        if (d.lastLapTime) {
            const lapTime = (now - d.lastLapTime) / 1000;
            if (!d.fastestLap || lapTime < d.fastestLap) d.fastestLap = lapTime;
        }
        d.laps++;
        d.lastLapTime = now;
        io.emit("state", state);
    });

    socket.on("endRace", () => {
        state.currentRace = null;
        state.raceMode = "danger";
        state.timer = RACE_DURATION;
        if (timerInterval) clearInterval(timerInterval);
        io.emit("state", state);
    });
});

server.listen(3000, "0.0.0.0", () => {
    console.log(`Server töötab pordil 3000 (${IS_DEV ? 'DEV 1min' : 'PROD 10min'})`);
});