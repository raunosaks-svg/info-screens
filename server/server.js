const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);


// STATIC FILES


app.use(express.static(path.join(__dirname, "../public")));


// ROUTES (AUTOMAATNE)


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


// RACE STATE (projekti aju)


let raceState = {
    status: "waiting", // waiting | countdown | racing | finished
    drivers: [],
    leaderboard: [],
    countdown: 10,
    currentLap: 0,
    totalLaps: 5,
    fastestLap: null
};


// COUNTDOWN + RACE LOGIC


let countdownInterval = null;

// Käivitab countdowni
function startCountdown() {
    if (countdownInterval) return; // ära käivita mitu korda

    raceState.status = "countdown";
    raceState.countdown = 10;

    io.emit("raceState", raceState);

    countdownInterval = setInterval(() => {
        raceState.countdown--;

        io.emit("raceState", raceState);

        if (raceState.countdown <= 0) {
            clearInterval(countdownInterval);
            countdownInterval = null;

            startRace(); // automaatne start
        }
    }, 1000);
}

// Käivitab race'i
function startRace() {
    raceState.status = "racing";
    raceState.currentLap = 0;

    io.emit("raceState", raceState);

    simulateRace();
}

// Simuleerib race'i
function simulateRace() {
    let raceInterval = setInterval(() => {

        raceState.currentLap++;

        io.emit("raceState", raceState);

        // kui kõik ringid tehtud
        if (raceState.currentLap >= raceState.totalLaps) {
            clearInterval(raceInterval);
            finishRace();
        }

    }, 3000);
}

// Lõpetab race'i
function finishRace() {
    raceState.status = "finished";

    io.emit("raceState", raceState);
}


// SOCKET.IO


io.on("connection", (socket) => {
    console.log("Client connected");

    // saada state kohe kliendile
    socket.emit("raceState", raceState);

    // manuaalne update (vajadusel)
    socket.on("updateRace", (data) => {
        raceState = { ...raceState, ...data };
        io.emit("raceState", raceState);
    });

    //  KÄIVITA COUNTDOWN 
    socket.on("startCountdown", () => {
        startCountdown();
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