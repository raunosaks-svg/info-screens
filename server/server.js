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

app.get("/front-desk", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/front-desk.html"));
});

app.get("/race-control", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/race-control.html"));
});

app.get("/lap-line-tracker", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/lap-line-tracker.html"));
});

app.get("/leader-board", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/leader-board.html"));
});

app.get("/next-race", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/next-race.html")); 
});

app.get("/race-countdown", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/race-countdown.html"));
});

app.get("/race-flags", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/race-flags.html"));
});

// SOCKET.IO

io.on("connection", (socket) => {
    console.log("Client connected"); // Log when a client connects

    socket.on("disconnect", () => {
        console.log("Client disconnected");
    });
});

// SERVER START

const PORT = 3000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});