const express = require('express');
const path = require('path');
const http = require('http'); 
const { Server } = require('socket.io'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server); 
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); 

const users = [
    { username: 'administrator', email: 'admin@mig33.com', password: 'adminpass', coins: 999999 }
];

const rooms = {
    'Jakarta': { usersList: [], maxUsers: 30, blocked: {} },
    'Medan': { usersList: [], maxUsers: 30, blocked: {} },
    'Jawa Tengah': { usersList: [], maxUsers: 30, blocked: {} },
    'Jawa Timur': { usersList: [], maxUsers: 30, blocked: {} },
    'Jawa Barat': { usersList: [], maxUsers: 30, blocked: {} },
    'Kalimantan': { usersList: [], maxUsers: 30, blocked: {} },
    'Sulawesi': { usersList: [], maxUsers: 30, blocked: {} },
    'Papua': { usersList: [], maxUsers: 30, blocked: {} },
    'Lowcard 1': { usersList: [], maxUsers: 25, blocked: {} },
    'Lowcard 2': { usersList: [], maxUsers: 25, blocked: {} },
    'migCricket': { usersList: [], maxUsers: 25, blocked: {} }
};

const userStats = {}; 
const promotedAdmins = new Set();
const merchants = {}; // Format: { 'username': timestamp_kadaluarsa }

// === KATALOG GIFT & HARGA ===
const giftCatalog = {
    'kopi': 50,
    'mawar': 100,
    'boneka': 500,
    'mobil': 1000
};

app.post('/register', (req, res) => {
    const { username, email, password } = req.body;
    if (username.toLowerCase() === 'administrator') return res.status(400).json({ message: 'Username tidak diizinkan.' });
    
    const userExists = users.find(u => u.username === username);
    if (userExists) return res.status(400).json({ message: 'Username sudah digunakan.' });
    
    users.push({ username, email, password, coins: 2000 });
    res.json({ message: 'Registrasi berhasil! Silakan login.' });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);
    if (user) res.json({ success: true, coins: user.coins });
    else res.status(401).json({ success: false, message: 'Username atau password salah!' });
});
// === VARIABEL GLOBAL LOWCARDBOT ===
const activeGames = {}; // Menyimpan status game per room
const gameRooms = ['Lowcard 1', 'Lowcard 2', 'migCricket']; // Room yang diizinkan untuk game
// === FUNGSI FORMAT KOIN (Rasio 1 : 1000) ===
function parseCoinInput(str) {
    if (!str) return NaN;
    // Ubah teks input menjadi angka desimal
    const val = parseFloat(str);
    if (isNaN(val)) return NaN;
    
    // Kalikan 1000 untuk mendapatkan nilai koin aslinya di database
    // Contoh: 0.5 * 1000 = 500 | 5 * 1000 = 5000
    return Math.floor(val * 1000); 
}

function formatCoin(num) {
    // Bagi 1000 saat akan ditampilkan di layar chat
    // Contoh: 500 / 1000 = "0.5" | 5000 / 1000 = "5"
    return (num / 1000).toString(); 
}

// Fungsi Pengacak Kartu
function getDeck() {
    const suits = ['C', 'D', 'H', 'S']; // Clubs, Diamonds, Hearts, Spades
    const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    let deck = [];
    for(let r=0; r<ranks.length; r++) {
        for(let s=0; s<suits.length; s++) {
            // Nilai rank * 4 + suit untuk menentukan pemenang secara presisi
            deck.push({ str: ranks[r]+suits[s], val: r*4 + s });
        }
    }
    return deck.sort(() => Math.random() - 0.5); // Shuffle
}

function drawCard(deck) {
    if(deck.length === 0) deck.push(...getDeck()); 
    return deck.pop();
}

io.on('connection', (socket) => {
    console.log('User terkoneksi:', socket.id);
    socket.joinedRooms = new Set();
    socket.emit('updateRooms', rooms);

    // === IDENTIFIKASI USER UNTUK STATUS ONLINE ===
    socket.on('identify', (username) => {
        socket.username = username;
        initStats(username);
        io.emit('updateFriendsList'); // Beritahu orang lain bahwa user ini online
    });

    // === LOGIKA FITUR FRIENDS ===
    socket.on('searchUser', (query, callback) => {
        const myName = socket.username;
        if (!myName) return callback({ success: false, message: "Sesi tidak valid." });
        
        const target = users.find(u => u.username.toLowerCase() === query.toLowerCase());
        if (target) {
            if (target.username === myName) return callback({ success: false, message: "Tidak bisa menambahkan diri sendiri." });
            
            initStats(myName); initStats(target.username);
            
            if (userStats[myName].friends.includes(target.username)) return callback({ success: false, message: "Kalian sudah berteman." });
            if (userStats[target.username].friendRequests.includes(myName)) return callback({ success: false, message: "Permintaan sudah dikirim." });
            if (userStats[myName].friendRequests.includes(target.username)) return callback({ success: false, message: "User ini sudah mengirimkan permintaan padamu. Cek daftar request!" });
            
            callback({ success: true, username: target.username });
        } else {
            callback({ success: false, message: "User tidak ditemukan." });
        }
    });

    socket.on('sendFriendRequest', (target) => {
        const myName = socket.username;
        initStats(target);
        if (!userStats[target].friendRequests.includes(myName) && !userStats[target].friends.includes(myName)) {
            userStats[target].friendRequests.push(myName);
            // Kirim notifikasi real-time jika target sedang online
            const targetSocket = [...io.sockets.sockets.values()].find(s => s.username === target);
            if (targetSocket) targetSocket.emit('newFriendRequest');
        }
    });

    socket.on('acceptFriendRequest', (requester) => {
        const myName = socket.username;
        userStats[myName].friendRequests = userStats[myName].friendRequests.filter(u => u !== requester);
        
        if (!userStats[myName].friends.includes(requester)) userStats[myName].friends.push(requester);
        initStats(requester);
        if (!userStats[requester].friends.includes(myName)) userStats[requester].friends.push(myName);
        
        io.emit('updateFriendsList'); // Refresh daftar teman untuk merender indikator online
    });

    socket.on('declineFriendRequest', (requester) => {
        const myName = socket.username;
        userStats[myName].friendRequests = userStats[myName].friendRequests.filter(u => u !== requester);
        socket.emit('updateFriendsList');
    });
    // Hapus Teman
    socket.on('deleteFriend', (targetFriend) => {
        const myName = socket.username;
        if (!myName) return;
        
        initStats(myName);
        initStats(targetFriend);

        // Hapus nama target dari daftar teman kita
        userStats[myName].friends = userStats[myName].friends.filter(u => u !== targetFriend);
        
        // Hapus nama kita dari daftar teman target
        userStats[targetFriend].friends = userStats[targetFriend].friends.filter(u => u !== myName);
        
        // Refresh daftar teman untuk semua orang yang terlibat
        io.emit('updateFriendsList'); 
    });

    socket.on('getFriendsData', (callback) => {
        const myName = socket.username;
        if(!myName) return;
        initStats(myName);
        
        const requests = userStats[myName].friendRequests;
        // Map teman dan cek status online mereka
        const friends = userStats[myName].friends.map(friendName => {
            const isOnline = [...io.sockets.sockets.values()].some(s => s.username === friendName);
            return { username: friendName, isOnline: isOnline };
        });
        callback({ requests, friends });
    });
    // === FITUR PRIVATE MESSAGE (PM) ===
    socket.on('sendPM', (data) => {
        const sender = socket.username;
        const target = data.target;
        const msg = data.text;
        
        if (!sender || !target || !msg) return;

        // Cari identitas socket milik target jika dia sedang online
        const targetSocket = [...io.sockets.sockets.values()].find(s => s.username === target);
        
        const pmData = { sender: sender, target: target, text: msg };

        // 1. Kirim pesan ke target (jika dia online)
        if (targetSocket) {
            targetSocket.emit('receivePM', pmData);
        }
        
        // 2. Kirim kembali ke pengirim agar muncul di layarnya sendiri
        socket.emit('receivePM', pmData);
    });

    // Bantuan inisialisasi stats
    const initStats = (name) => {
        if (!userStats[name]) userStats[name] = { xp: 0, level: 1, lastMsgTime: 0, likes: 0, gifts: 0, status: 'is somewhere', birth: 'Unknown', gender: 'Unknown', friends: [], friendRequests: [] };
    };

    socket.on('joinRoom', (data, callback) => {
        const roomName = data.roomName;
        const username = data.username;
        const room = rooms[roomName];
        
        if (room) {
            if (room.blocked[username]) {
                const blockData = room.blocked[username];
                if (Date.now() < blockData.expire) {
                    const timeLeft = Math.ceil((blockData.expire - Date.now()) / 1000);
                    let timeMsg = timeLeft + " detik";
                    if (blockData.type === 'ban') {
                        timeMsg = Math.floor(timeLeft / 3600) + " jam " + Math.floor((timeLeft % 3600) / 60) + " menit";
                    }
                    return callback({ success: false, message: `Kamu di-${blockData.type.toUpperCase()} dari room ini. Tunggu ${timeMsg} lagi.` });
                } else {
                    delete room.blocked[username]; 
                }
            }

            const isOwner = (username === 'administrator');
            const isAdmin = isOwner || promotedAdmins.has(username);

            if (!isAdmin && room.usersList.length >= room.maxUsers && !room.usersList.includes(username)) {
                callback({ success: false, message: `Maaf, room ${roomName} sudah penuh!` });
            } else {
                socket.join(roomName);
                socket.joinedRooms.add(roomName);
                socket.username = username; 
                
                initStats(username);
                const userLevel = userStats[username].level;

                if (!isAdmin && !room.usersList.includes(username)) {
                    room.usersList.push(username); 
                    
                    socket.emit('receiveMessage', { room: roomName, username: roomName, text: `Welcome to Room ${roomName}`, isSystemWelcome: true });
                    socket.emit('receiveMessage', { room: roomName, username: roomName, text: `This room is managed by Administrator`, isSystemWelcome: true });
                    io.to(roomName).emit('receiveMessage', { room: roomName, username: roomName, text: `${username} [${userLevel}] has entered`, isSystem: true });
                }
                
                io.emit('updateRooms', rooms); 
                io.to(roomName).emit('updateRoomUsersList', { room: roomName, users: room.usersList }); 
                
                callback({ success: true, usersList: room.usersList });
            }
        } else {
            callback({ success: false, message: 'Room tidak ditemukan.' });
        }
    });

    socket.on('sendMessage', (data) => {
        const { roomName, msg } = data;
        const username = socket.username;
        const now = Date.now();
        
        const isOwner = (username === 'administrator');
        const isAdmin = isOwner || promotedAdmins.has(username);

        if (socket.joinedRooms.has(roomName) && username) {
            
            if (msg.startsWith('/')) {
                const parts = msg.split(' ');
                const cmd = parts[0].toLowerCase();
                const target = parts[1];

                // Perintah Admin (Kick/Ban/Promote)
                if (isOwner && (cmd === '/admin' || cmd === '/unadmin')) {
                    if (!target) return socket.emit('systemMessage', { room: roomName, text: `Format salah. Gunakan: ${cmd} username` });
                    if (cmd === '/admin') {
                        promotedAdmins.add(target);
                        io.to(roomName).emit('systemMessage', { room: roomName, text: `*** ${target} telah diangkat menjadi Administrator! ***` });
                    } else {
                        promotedAdmins.delete(target);
                        io.to(roomName).emit('systemMessage', { room: roomName, text: `*** Hak Administrator ${target} telah dicabut. ***` });
                    }
                    return; 
                }
                // === FITUR MERCHANT (HANYA OWNER) ===
                if (isOwner && (cmd === '/merchant' || cmd === '/unmerchant')) {
                    if (cmd === '/merchant') {
                        const days = parseInt(parts[2]);
                        // Cek apakah format benar: /merchant nama 30
                        if (!target || isNaN(days) || days <= 0) return socket.emit('systemMessage', { room: roomName, text: "Format salah. Gunakan: /merchant username hari (contoh: /merchant budi 30)" });
                        
                        // Hitung waktu kadaluarsa (hari x 24 jam x 60 menit x 60 detik x 1000 milidetik)
                        const expireTime = Date.now() + (days * 24 * 60 * 60 * 1000);
                        merchants[target] = expireTime;
                        
                        io.to(roomName).emit('systemMessage', { room: roomName, text: `*** 👑 ${target} telah diangkat menjadi Merchant selama ${days} hari! ***` });
                    } else { // Perintah /unmerchant
                        if (!target) return socket.emit('systemMessage', { room: roomName, text: "Format salah. Gunakan: /unmerchant username" });
                        
                        delete merchants[target];
                        io.to(roomName).emit('systemMessage', { room: roomName, text: `*** Status Merchant ${target} telah dicabut oleh Administrator. ***` });
                    }
                    return; 
                }

                if (isAdmin && (cmd === '/kick' || cmd === '/ban')) {
                    if (!target) return socket.emit('systemMessage', { room: roomName, text: `Format salah. Gunakan: ${cmd} username` });
                    if (target === 'administrator') return socket.emit('systemMessage', { room: roomName, text: "Tidak bisa menendang Owner!" });
                    if (promotedAdmins.has(target) && !isOwner) return socket.emit('systemMessage', { room: roomName, text: "Sesama Admin tidak bisa saling menendang!" });
                    
                    const room = rooms[roomName];
                    const isBan = cmd === '/ban';
                    const duration = isBan ? (24 * 60 * 60 * 1000) : (60 * 1000); 
                    
                    room.blocked[target] = { type: isBan ? 'ban' : 'kick', expire: Date.now() + duration };

                    const targetSocket = [...io.sockets.sockets.values()].find(s => s.username === target && s.joinedRooms.has(roomName));
                    if (targetSocket) {
                        targetSocket.emit('forceLeave', { room: roomName, message: `Kamu telah di-${isBan ? 'BANNED (1 Hari)' : 'KICK (1 Menit)'} oleh Administrator!` });
                        room.usersList = room.usersList.filter(name => name !== target);
                        targetSocket.leave(roomName);
                        targetSocket.joinedRooms.delete(roomName);
                    }
                    io.to(roomName).emit('updateRoomUsersList', { room: roomName, users: room.usersList });
                    io.to(roomName).emit('receiveMessage', { room: roomName, username: roomName, text: `${target} has been ${isBan ? 'banned' : 'kicked'} by administrator (${username})`, isSystem: true });
                    return;
                }
               
                 // === FITUR TRANSFER KOIN ===
                if (cmd === '/transfer') {
                    const targetUser = parts[1];
                    const rawAmount = parts[2];
                    
                    // Gunakan parseCoinInput (mengubah nilai seperti 0.5 menjadi 500, atau 1 menjadi 1000)
                    const transferAmount = parseCoinInput(rawAmount);

                    if (!targetUser || isNaN(transferAmount) || transferAmount <= 0) {
                        return socket.emit('systemMessage', { room: roomName, text: "Gunakan: /transfer username nominal (contoh: /transfer budi 0.5)" });
                    }

                    const senderDb = users.find(u => u.username === username);
                    const receiverDb = users.find(u => u.username === targetUser);

                    if (!receiverDb) {
                        return socket.emit('systemMessage', { room: roomName, text: "User tidak ditemukan!" });
                    }

                    if (senderDb.coins < transferAmount) {
                        return socket.emit('systemMessage', { room: roomName, text: `Koin kamu tidak cukup! Butuh ${formatCoin(transferAmount)} koin.` });
                    }

                    // Proses pemindahan koin backend
                    senderDb.coins -= transferAmount;
                    receiverDb.coins += transferAmount;

                    // Update layar pengirim dan penerima
                    socket.emit('updateCoins', senderDb.coins);
                    const receiverSocket = [...io.sockets.sockets.values()].find(s => s.username === targetUser);
                    if (receiverSocket) receiverSocket.emit('updateCoins', receiverDb.coins);

                    io.to(roomName).emit('receiveMessage', { 
                        room: roomName, 
                        username: 'System', 
                        isSystem: true, 
                        text: `${username} berhasil mentransfer ${formatCoin(transferAmount)} koin ke ${targetUser}.` 
                    });
                    return;
                }

                // === FITUR MENGIRIM GIFT (KOPI & BUNGA) ===
                if (cmd === '/gift') {
                    const targetUser = parts[1];
                    const giftType = parts[2] ? parts[2].toLowerCase() : ''; 
                    
                    // Validasi: Hanya izinkan kopi atau bunga
                    if (!targetUser || (giftType !== 'kopi' && giftType !== 'bunga')) {
                        return socket.emit('systemMessage', { room: roomName, text: "Gunakan: /gift [username] [kopi/bunga] (Harga tetap: 0.5 koin)" });
                    }

                    // Harga ditetapkan permanen 500 (yang akan tampil sebagai 0.5 di layar)
                    const giftCost = 500; 

                    const senderDb = users.find(u => u.username === username);
                    const receiverDb = users.find(u => u.username === targetUser);

                    if (!receiverDb) {
                        return socket.emit('systemMessage', { room: roomName, text: "User tidak ditemukan!" });
                    }

                    if (senderDb.coins < giftCost) {
                        return socket.emit('systemMessage', { room: roomName, text: `Koin kamu tidak cukup! Butuh 0.5 koin.` });
                    }

                    // Potong koin pengirim
                    senderDb.coins -= giftCost;
                    
                    // Tambahkan 1 ke statistik gift penerima di database
                    receiverDb.gifts = (receiverDb.gifts || 0) + 1; 

                    // Setor uang pembelian gift ke Administrator
                    const adminDb = users.find(u => u.username === 'administrator');
                    if (adminDb) adminDb.coins += giftCost;

                    // Update layar pengirim
                    socket.emit('updateCoins', senderDb.coins);
                    
                    // Tentukan emoji berdasarkan pilihan
                    const giftEmoji = giftType === 'kopi' ? '☕ (Secangkir Kopi)' : '🌹 (Setangkai Bunga)';

                    io.to(roomName).emit('receiveMessage', { 
                        room: roomName, 
                        username: 'System', 
                        isSystem: true, 
                        text: `${username} memberikan gift ${giftEmoji} kepada ${targetUser}! 🎉` 
                    });
                    return;
                }

                // === FITUR LOWCARDBOT ===
            if (cmd === '/lowcardbot') {
                    if (!gameRooms.includes(roomName)) return socket.emit('systemMessage', { room: roomName, text: "LowCardBot hanya bisa dimainkan di Game Room (contoh: Lowcard 1)!" });
                    
                    // PERBAIKAN: Gunakan parseCoinInput agar bisa membaca 1K atau 1M
                    const cost = parseCoinInput(parts[1]);
                    if (isNaN(cost) || cost <= 0) return socket.emit('systemMessage', { room: roomName, text: "Gunakan: /lowcardbot nominal (contoh: /lowcardbot 500K atau 1M)" });

                    if (!activeGames[roomName]) activeGames[roomName] = { state: 'idle' };
                    if (activeGames[roomName].state !== 'idle') return socket.emit('systemMessage', { room: roomName, text: "Game sedang berlangsung di room ini!" });

                    activeGames[roomName] = { state: 'waiting_start', cost: cost, creationFee: 100, initiator: username, players: [], pot: 0, round: 1, draws: {}, timer: null };

                    // PERBAIKAN: Gunakan formatCoin agar pesan di chat lebih ringkas
                    io.to(roomName).emit('receiveMessage', { room: roomName, username: 'LowCardBot', text: `Play now: !start to enter. Cost: ${formatCoin(cost)} for custom entry, !start` });
                    return;
                }
            } // <--- PASTIKAN KURUNG TUTUP BLOK (/) TETAP ADA DI SINI

            if (msg === '!start' && activeGames[roomName] && activeGames[roomName].state === 'waiting_start') {
                const game = activeGames[roomName];
                const userDb = users.find(u => u.username === username);
                
                // Hitung total bayar (Join Cost + Creation Fee)
                const totalStartCost = game.cost + game.creationFee;
                if (userDb.coins < totalStartCost) return socket.emit('systemMessage', { room: roomName, text: `Koin kamu tidak cukup! Butuh ${totalStartCost} koin.` });

                game.state = 'pending_5s';
                // Pesan PVT pending 5 detik
                io.to(roomName).emit('receiveMessage', { room: roomName, username: 'LowCardBot', text: `[PVT] ${username}: Charges apply ${formatCoin(game.creationFee)} create/enter pot. !n to cancel. 5 seconds` });

                game.timer = setTimeout(() => {
                    if (game.state !== 'pending_5s') return;
                    
                    // Potong koin user pembuat game (contoh: 1000 + 100 = 1100 koin)
                    userDb.coins -= totalStartCost;
                    
                    // Setor pajak 100 koin ke Administrator
                    const adminDb = users.find(u => u.username === 'administrator');
                    if (adminDb) adminDb.coins += game.creationFee;

                    const targetSocket = [...io.sockets.sockets.values()].find(s => s.username === username);
                    if(targetSocket) targetSocket.emit('updateCoins', userDb.coins);

                    game.players.push(username);
                    // Yang masuk ke hadiah Pot HANYA koin join (contoh: 1000 koin)
                    game.pot += game.cost; 
                    game.state = 'joining';

                    // Pesan game dimulai
                    io.to(roomName).emit('receiveMessage', { room: roomName, username: 'LowCardBot', text: `[PVT] ${username} added to game. Charges apply. ${formatCoin(game.cost)}` });
                    io.to(roomName).emit('receiveMessage', { room: roomName, username: 'LowCardBot', text: `LowCard started. !j to join. Cost ${formatCoin(game.cost)}. 30 seconds` });
                    game.timer = setTimeout(() => { startGameRound(roomName); }, 30000);
                }, 5000);
                return;
            }

            if (msg === '!n' && activeGames[roomName] && activeGames[roomName].state === 'pending_5s') {
                const game = activeGames[roomName];
                if (username === game.initiator) {
                    clearTimeout(game.timer);
                    game.state = 'idle';
                    io.to(roomName).emit('receiveMessage', { room: roomName, username: 'LowCardBot', text: `Game cancelled by ${username}.` });
                }
                return;
            }

            if (msg === '!j' && activeGames[roomName] && activeGames[roomName].state === 'joining') {
                const game = activeGames[roomName];
                if (game.players.includes(username)) return socket.emit('systemMessage', { room: roomName, text: "Kamu sudah join di game ini!" });

                const userDb = users.find(u => u.username === username);
                if (userDb.coins < game.cost) return socket.emit('systemMessage', { room: roomName, text: `Koin kamu tidak cukup! Butuh ${game.cost} koin.` });

                // Potong koin user yang join HANYA sebesar tarif join (contoh: 1000)
                userDb.coins -= game.cost;
                
                const targetSocket = [...io.sockets.sockets.values()].find(s => s.username === username);
                if(targetSocket) targetSocket.emit('updateCoins', userDb.coins);

                game.players.push(username);
                game.pot += game.cost; // Tambahkan ke pot hadiah

                io.to(roomName).emit('receiveMessage', { room: roomName, username: 'LowCardBot', text: `${username} joined the game.` });
                return;
            }
            if (msg === '!d' && activeGames[roomName] && activeGames[roomName].state === 'drawing') {
                const game = activeGames[roomName];
                if (!game.players.includes(username)) return io.to(roomName).emit('receiveMessage', { room: roomName, username: 'LowCardBot', text: `[PVT] ${username}: you're not in the game.` });
                if (game.draws[username]) return; 

                const card = drawCard(game.deck);
                game.draws[username] = card;
                io.to(roomName).emit('receiveMessage', { room: roomName, username: 'LowCardBot', text: `${username}: (${card.str})` });
                return;
            }


            initStats(username);
            if (!isAdmin && now - userStats[username].lastMsgTime < 2000) {
                socket.emit('systemMessage', { room: roomName, text: "*** Peringatan: Jangan spam pesan! ***" });
                return; 
            }
            userStats[username].lastMsgTime = now;

            if (!isAdmin) {
                userStats[username].xp += 10;
                const xpTarget = userStats[username].level * 50; 
                if (userStats[username].xp >= xpTarget) {
                    userStats[username].level += 1;
                    userStats[username].xp = 0; 
                    io.to(roomName).emit('systemMessage', { room: roomName, text: `*** 🎉 Selamat! ${username} telah naik ke level ${userStats[username].level}! ***` });
                    socket.emit('updateLevel', userStats[username].level);
                }
            }

            // Cek apakah user adalah merchant dan belum kadaluarsa
            let isMerchant = false;
            if (merchants[username]) {
                if (Date.now() > merchants[username]) {
                    delete merchants[username]; // Hapus jika sudah lebih dari 30 hari
                } else {
                    isMerchant = true; // Tandai sebagai merchant
                }
            }

            io.to(roomName).emit('receiveMessage', { 
                room: roomName, 
                username: username, 
                text: msg, 
                isAdmin: isAdmin,
                isMerchant: isMerchant // Bawa tanda ini ke layar client
            });
        }
    });

    // Profil API
    socket.on('updateProfile', (data) => {
        const username = socket.username;
        if (username) {
            initStats(username);
            userStats[username].status = data.status;
            userStats[username].birth = data.birth;
            userStats[username].gender = data.gender;
        }
    });
// === MENERIMA KLIK LIKE DARI USER (HANYA BISA 1X) ===
    socket.on('sendLike', (targetUsername, callback) => {
        const myName = socket.username; // Deteksi siapa yang sedang menekan tombol
        if (!myName) return callback({ success: false, message: "Sesi tidak valid." });

        const targetDb = users.find(u => u.username === targetUsername);
        if (targetDb) {
            // Pastikan database target memiliki catatan 'Siapa saja yang sudah like'
            if (!targetDb.likedBy) {
                targetDb.likedBy = [];
            }

            // Cek apakah namamu sudah ada di dalam daftar yang me-like profil ini
            if (targetDb.likedBy.includes(myName)) {
                // Jika sudah, tolak permintaannya
                return callback({ success: false, message: "Kamu sudah memberikan Like pada profil ini!" });
            }

            // Jika belum pernah, catat namanya dan tambahkan poinnya
            targetDb.likedBy.push(myName);
            targetDb.likes = (targetDb.likes || 0) + 1;
            
            callback({ success: true });
        } else {
            callback({ success: false, message: "User tidak ditemukan." });
        }
    });
    // === MENGIRIM DATA STATISTIK KE PROFIL ===
    socket.on('getProfileData', (targetUsername, callback) => {
        const userDb = users.find(u => u.username === targetUsername);
        if (userDb) {
            callback({ success: true, gifts: userDb.gifts || 0, likes: userDb.likes || 0 });
        } else {
            callback({ success: false });
        }
    });

    socket.on('getProfile', (targetUser, callback) => {
        initStats(targetUser);
        callback(userStats[targetUser]); 
    });

    socket.on('likeUser', (targetUser) => {
        initStats(targetUser);
        userStats[targetUser].likes += 1; 
        io.emit('updateLikes', { username: targetUser, likes: userStats[targetUser].likes });
    });

    const removeUserFromRoom = (roomName) => {
        if (socket.joinedRooms.has(roomName) && socket.username) {
            const room = rooms[roomName];
            if (room) {
                const isAdmin = socket.username === 'administrator' || promotedAdmins.has(socket.username);
                
                if (!isAdmin) {
                    room.usersList = room.usersList.filter(name => name !== socket.username);
                }
                
                socket.leave(roomName);
                socket.joinedRooms.delete(roomName);
                
                if (!isAdmin) {
                    const userLevel = userStats[socket.username] ? userStats[socket.username].level : 1;
                    io.to(roomName).emit('receiveMessage', { room: roomName, username: roomName, text: `${socket.username} [${userLevel}] has left`, isSystem: true });
                }
                
                io.emit('updateRooms', rooms); 
                io.to(roomName).emit('updateRoomUsersList', { room: roomName, users: room.usersList }); 
            }
        }
    };

    socket.on('leaveRoom', (roomName) => { removeUserFromRoom(roomName); });
    // === LOGOUT MANUAL ===
    socket.on('logout', () => {
        // Keluarkan dari semua room
        socket.joinedRooms.forEach(roomName => { removeUserFromRoom(roomName); });
        
        // Hapus identitasnya di server agar terbaca Offline
        socket.username = null; 
        
        // Beritahu ke semua daftar teman bahwa dia sudah offline
        io.emit('updateFriendsList'); 
    });
    socket.on('disconnect', () => {
        socket.joinedRooms.forEach(roomName => { removeUserFromRoom(roomName); });
        io.emit('updateFriendsList'); // TAMBAHKAN BARIS INI
        console.log('User terputus:', socket.id);
    });
    // === FUNGSI BANTUAN LOWCARDBOT ===
    function startGameRound(roomName) {
        const game = activeGames[roomName];
        
        // JIKA PEMAIN KURANG DARI 2 (TIDAK ADA YANG JOIN)
        if(game.players.length < 2) {
            io.to(roomName).emit('receiveMessage', { room: roomName, username: 'LowCardBot', text: `Not enough players. Game cancelled. Cost refunded.` });
            
            const adminDb = users.find(u => u.username === 'administrator');
            
            game.players.forEach(playerName => {
                const playerDb = users.find(u => u.username === playerName);
                if (playerDb) {
                    let refundAmount = game.cost; // Dasar refund adalah uang join (contoh: 1000)
                    
                    // Jika pemain ini adalah orang yang ngetik !start, kembalikan juga pajak 100 koinnya
                    if (playerName === game.initiator) {
                        refundAmount += game.creationFee; // Total refund: 1000 + 100 = 1100
                        if (adminDb) adminDb.coins -= game.creationFee; // Tarik kembali pajak dari saldo Admin
                    }
                    
                    playerDb.coins += refundAmount; // Kembalikan ke saldo pemain
                    
                    // Update tampilan koin di layar pemain
                    const pSocket = [...io.sockets.sockets.values()].find(s => s.username === playerName);
                    if (pSocket) pSocket.emit('updateCoins', playerDb.coins);
                }
            });
            
            game.state = 'idle';
            return;
        }

        // Jika pemain cukup, lanjutkan undian
        game.state = 'drawing';
        game.deck = getDeck();
        game.draws = {};
        io.to(roomName).emit('receiveMessage', { room: roomName, username: 'LowCardBot', text: `ROUND #${game.round}: Players, !d to DRAW. 15 seconds.` });

        game.timer = setTimeout(() => { endGameRound(roomName); }, 15000);
    }

    function endGameRound(roomName) {
        const game = activeGames[roomName];
        io.to(roomName).emit('receiveMessage', { room: roomName, username: 'LowCardBot', text: `TIME'S UP! Tallying cards...` });

        // Auto draw untuk user yang lupa/tidak ketik !d
        game.players.forEach(p => {
            if(!game.draws[p]) {
                const card = drawCard(game.deck);
                game.draws[p] = card;
                io.to(roomName).emit('receiveMessage', { room: roomName, username: 'LowCardBot', text: `Bot draws - ${p}: (${card.str})` });
            }
        });

        setTimeout(() => { evaluateRound(roomName); }, 2000);
    }

    function evaluateRound(roomName) {
        const game = activeGames[roomName];
        let minVal = Infinity;
        let losers = [];

        // Cari kartu terkecil
        for (const [p, card] of Object.entries(game.draws)) {
            if(card.val < minVal) {
                minVal = card.val;
                losers = [p];
            } else if (card.val === minVal) {
                losers.push(p); // Tie (Seri) di kartu terkecil
            }
        }

        if(losers.length > 1) {
            io.to(roomName).emit('receiveMessage', { room: roomName, username: 'LowCardBot', text: `Tied players (${losers.length}): ${losers.join(', ')}` });
            io.to(roomName).emit('receiveMessage', { room: roomName, username: 'LowCardBot', text: `Tied players have the lowest cards. Eliminating...` });
        }

        // Eliminasi pemain dengan nilai terkecil
        game.players = game.players.filter(p => !losers.includes(p));
        losers.forEach(l => {
            // Kita gunakan username khusus 'Lowcard win' untuk memicu warna merah di Client
            io.to(roomName).emit('receiveMessage', { room: roomName, username: 'Lowcard win', text: `${l} has left (Eliminated)` }); 
        });

        // Cek Pemenang
        if (game.players.length === 1) {
            const winner = game.players[0];
            
            // === FITUR 3: Potongan 2% (Pajak Rumah / Admin) ===
            const adminCut = Math.floor(game.pot * 0.02); // Hitung potongan 5%
            const winnerPrize = game.pot - adminCut; // Hadiah bersih untuk pemenang
            
            // Setor pajak 2% ke Administrator diam-diam
            const adminDb = users.find(u => u.username === 'administrator');
            if (adminDb) adminDb.coins += adminCut;

            //io.to(roomName).emit('receiveMessage', { room: roomName, username: 'LowCardBot', text: `LowCardBot game over! ${winner} WINS ${winnerPrize} coins! CONGRATS!` });
            io.to(roomName).emit('receiveMessage', { room: roomName, username: 'LowCardBot', text: `LowCardBot game over! ${winner} WINS ${formatCoin(winnerPrize)} coins! CONGRATS!` });
            const winnerDb = users.find(u => u.username === winner);
            if(winnerDb) {
                winnerDb.coins += winnerPrize; // Tambahkan hadiah bersih ke pemenang
                const winnerSocket = [...io.sockets.sockets.values()].find(s => s.username === winner);
                if(winnerSocket) winnerSocket.emit('updateCoins', winnerDb.coins);
            }
            game.state = 'idle';
        } else if (game.players.length === 0) {
            io.to(roomName).emit('receiveMessage', { room: roomName, username: 'LowCardBot', text: `All players eliminated! Nobody wins the pot.` });
            game.state = 'idle';
        } else {
            // === FITUR 1: Tampilkan sisa pemain ===
            io.to(roomName).emit('receiveMessage', { room: roomName, username: 'LowCardBot', text: `Players are: ${game.players.join(', ')}` });
            
            game.round++;
            io.to(roomName).emit('receiveMessage', { room: roomName, username: 'LowCardBot', text: `Next round in 5 seconds!` });
            setTimeout(() => { startGameRound(roomName); }, 5000);
        }
    }
});

server.listen(PORT, () => {
    console.log(`Server mig33 clone berjalan lancar di http://localhost:${PORT}`);
});