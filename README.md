#  Race Management System

##  Käivitamine

1. Paigalda sõltuvused:
npm install

2. Loo .env fail:
FRONTDESK_KEY=1234
RACECONTROL_KEY=1234
LAPTRACKER_KEY=1234

3. Käivita server:
npm start

4. Ava browseris:
http://localhost:3000/front-desk

---

##  Kasutajad

###  Receptionist (Front Desk)
- Lisab race sessioneid
- Kustutab sessioneid
- Lisab drivereid ja autosid

###  Safety Official (Race Control)
- Käivitab race
- Muudab race mode:
  - Safe (green)
  - Hazard (yellow)
  - Danger (red)
  - Finish (checkered)
- Lõpetab race

###  Lap-line Observer
- Vajutab nuppu kui auto lõpetab ringi

###  Guest (Leaderboard)
- Näeb tulemusi reaalajas

---

##  Ekraanid

- /front-desk
- /race-control
- /lap-line-tracker
- /leader-board
- /next-race
- /race-countdown
- /race-flags

---

##  Funktsionaalsus

- Reaalajas andmed (Socket.IO)
- Leaderboard sorteeritud fastest lap järgi
- Countdown timer
- Race flags
- Session management
- State salvestamine (server restart ei kaota andmeid)
- Access control (koodidega)

---

##  Võrk

Server töötab:
http://[SINU-IP]:3000

Saab avada telefonist samas WiFis