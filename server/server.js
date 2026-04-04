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
    status: "finished", // waiting | countdown | racing | finished
    drivers: [],
    leaderboard: [],
    countdown: 10,
    currentLap: 0,
    totalLaps: 5,
    fastestLap: null
};


// COUNTDOWN + RACE LOGIC


let countdownInterval = null; //salvestab timer, alguses väärtus null

// Käivitab countdowni
function startCountdown() { //käivitab countdown
    if (countdownInterval) return; // ära käivita mitu korda

    raceState.status = "countdown";  //muudab staatuse, et oleme nüüd countdownis
    raceState.countdown = 10; //algab 10st sekundist

    io.emit("raceState", raceState); //saadab staatuse kõigile ekraanidele

    countdownInterval = setInterval(() => { //käivitab timeri, mis teeb midagi iga sekundi tagant
        raceState.countdown--; //iga sekund vähendab 

        io.emit("raceState", raceState); //ja saadab staatuse kõigile ekraanidele

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

        raceState.currentLap++; //lisab ühe ringi juurde

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


io.on("connection", (socket) => { //kui keegi avab lehe, annab teada
    console.log("Client connected");

    // saada state kohe kliendile
    socket.emit("raceState", raceState);

    // manuaalne update (vajadusel)
    socket.on("updateRace", (data) => {
        raceState = { ...raceState, ...data };
        io.emit("raceState", raceState);
    });

    //  KÄIVITA COUNTDOWN s
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
