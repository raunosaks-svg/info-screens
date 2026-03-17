const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// static files
app.use(express.static(path.join(__dirname, "../public"))); // Serve static files from the public directory


// ROUTES

const screens = [
    "front-desk",
    "race-control",
    "lap-line-tracker",
    "leader-board",
    "next-race",
    "race-countdown",
    "race-flags"
];

screens.forEach((screen) => {
    app.get(`/${screen}`, (req, res) => {
        res.sendFile(path.join(__dirname, `../public/${screen}.html`));
    });
});

// SOCKET.IO

let raceState = {
    status: "waiting", // waiting | countdown | racing | finished
    drivers: [],
    leaderboard: [],
    countdown: 10,
    currentLap: 0,
    totalLaps: 10,
    fastestLap: null
};

io.on("connection", (socket) => {
    console.log("Client connected");

    // saada kohe kogu race state
    socket.emit("raceState", raceState);

    // update race state (nt race-control UI-st)
    socket.on("updateRace", (data) => {
        raceState = { ...raceState, ...data };

        // saada update kõigile
        io.emit("raceState", raceState);
    });

    socket.on("disconnect", () => {
        console.log("Client disconnected");
    });
});

// SERVER START

const PORT = 3000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});