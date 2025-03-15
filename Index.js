const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const Pino = require("pino");
const readline = require("readline");
const fs = require("fs");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

(async () => {
    const { state, saveCreds } = await useMultiFileAuthState("./auth_info");

    const startWhatsApp = async () => {
        const socket = makeWASocket({
            auth: state,
            logger: Pino({ level: "silent" }),
            connectTimeoutMs: 60000 // Extended timeout
        });

        console.log(`
▄▀▀▄ ▄▀▀▄ ▄▀▀▄
█▄▄░ █▄▄░ █▄▄░
▀▄▄▀ ▀▄▄▀ ▀▄▄▀
▀█▀ █▀▄░░█▀▄ █░█
░█░ █▄█░░█▀█ ▀▄▀
░▀░ ▀░░░░▀▀░ ░▀░
░▄▀▀ ▄▀ █▀▀▄ █ █▀▄
░░▀▄ █░ █▐█▀ █ █▄█
░▀▀░ ░▀ ▀░▀▀ ▀ ▀░░
█▀
█░
▀░
░░▀ ▄▀▄ ▄▀ ▄▀▄ █▀▄
▄░█ █▀█ █░ █░█ █▀█
▀▀▀ ▀░▀ ░▀ ░▀░ ▀▀░
        `);
        console.log("\n");

        if (!socket.authState.creds.registered) {
            console.log("Your WhatsApp session is not registered yet.");
            const phoneNumber = await new Promise((resolve) => {
                rl.question("Enter your phone number for pairing (e.g., 40756469325): ", resolve);
            });

            const pairingCode = await socket.requestPairingCode(phoneNumber);
            console.log(`Pairing Code: ${pairingCode}`);
            console.log("Please open WhatsApp and enter the pairing code under Linked Devices.");
        } else {
            console.log("Your session is already authenticated!");
        }

        socket.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === "open") {
                console.log("Connected to WhatsApp!");
                afterConnection(socket); // Proceed only after successful connection
            } else if (connection === "close") {
                console.error("Connection closed.");

                const shouldReconnect =
                    lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

                if (shouldReconnect) {
                    console.log("Attempting to reconnect...");
                    await startWhatsApp(); // Reconnect automatically
                } else {
                    console.error("You have been logged out. Restart the script to reauthenticate.");
                    process.exit(1);
                }
            }
        });

        socket.ev.on("creds.update", saveCreds);

        return socket;
    };

    const socket = await startWhatsApp();

    const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

    const afterConnection = async (socket) => {
        console.log("Where would you like to send messages?");
        console.log("[1] Contacts");
        console.log("[2] Groups");

        const choice = await askQuestion("Enter your choice (1 for Contacts, 2 for Groups): ");
        let targets = [];

        if (choice === "1") {
            const numContacts = parseInt(await askQuestion("How many contacts do you want to send messages to? "), 10);
            for (let i = 0; i < numContacts; i++) {
                const targetNumber = await askQuestion(`Enter phone number for Contact ${i + 1} (without + or spaces, e.g., 40756469325): `);
                targets.push(`${targetNumber}@s.whatsapp.net`);
            }
        } else if (choice === "2") {
            console.log("Fetching group information...");
            try {
                const groupMetadata = await socket.groupFetchAllParticipating();
                const groups = Object.values(groupMetadata);

                console.log("Here are the available groups and their IDs:");
                groups.forEach((group) => {
                    console.log(`${group.subject} - ID: ${group.id}`);
                });

                const numGroups = parseInt(await askQuestion("How many groups do you want to send messages to? "), 10);
                for (let i = 0; i < numGroups; i++) {
                    const groupJID = await askQuestion(`Enter group ID for Group ${i + 1} (e.g., 1234567890-123456@g.us): `);
                    targets.push(groupJID);
                }
            } catch (error) {
                console.error("Failed to fetch groups:", error);
                rl.close();
                process.exit(1);
            }
        } else {
            console.log("Invalid choice. Exiting.");
            rl.close();
            process.exit(1);
        }

        const filePath = await askQuestion("Enter the path to your text file (e.g., spam.txt): ");

        if (!fs.existsSync(filePath)) {
            console.error("File not found. Please check the file path and try again.");
            process.exit(1);
        }

        const messages = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);

        const delay = parseInt(await askQuestion("Enter the delay in seconds between messages: "), 10) * 1000;

        console.log("Messages will start sending now. Press CTRL+C to stop.");

        const sendMessage = async (target, message) => {
            try {
                await socket.sendMessage(target, { text: message });
                console.log(`Message sent to ${target}: "${message}"`);
            } catch (error) {
                console.error(`Failed to send message to ${target}:`, error);
            }
        };

        while (true) {
            for (const message of messages) {
                for (const target of targets) {
                    await sendMessage(target, message);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                }
            }
        }
    };
})();
