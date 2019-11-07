const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, {
	pingInterval: 10000,
	pingTimeout: 10000,
	cookie: false
});
const port = process.env.PORT || 80;
server.listen(port, () => {
	console.log('Server listening at port %d', port);
});

const FileManager = require('./FileManager.js');
const DatabaseManager = require('./DatabaseManager.js');
const MatchMaking = require('./MatchMaking.js');

const HashMap = require("hashmap");
const randomWords = require('random-words');

const sockets = new HashMap(); // userID : socket
const rooms = new HashMap(); // userID : room
const userSubscriptions = new HashMap(); // socket : [userIDs]

var roomIndex = 0;

io.on("connection", async function(socket) {
	if (socket.handshake.query.ver != "0.24") {
		socket.emit("update");
		socket.disconnect(true);
		return;
	}
	let userID = parseInt(socket.handshake.query.id);
	//TODO handle new user
	if (userID == null || sockets.has(userID)) {
		socket.disconnect(true);
		return;
	}
	console.log(userID + " connected | transport " + socket.conn.transport.name);
	socket.leave(socket.id);
	sockets.set(userID, socket);

	let rows = await DatabaseManager.getInvites(userID);
	let invites = [];
    for (let i = 0; i < rows.length; i++) {
        let invite = rows[i];
        invites[i] = [invite.id, invite.fromid, invite.type];
    }
	socket.emit("invite", invites);

	rows = await DatabaseManager.getFriends(userID);
	let friends = [];
    for (let i = 0; i < rows.length; i++) {
        let friendsUserID = rows[i].id;
        let friendsSocket = sockets.get(friendsUserID);
        let friendOnline = friendsSocket != null;
        friends[i] = [friendsUserID, friendOnline];
        if (friendOnline)
            friendsSocket.emit("friend", [0, userID, true]);
    }
	socket.emit("friend", friends);
	
	rows = await DatabaseManager.getMyUser(userID);
	let image = await FileManager.getFile(true, userID.toString());
	let thumbnail = await FileManager.getFile(false, userID.toString());
	socket.binary(true).emit("my_user", [rows[0].name, thumbnail, image]);

	socket.on("disconnecting", async function(reason) => {
		rows = await DatabaseManager.getFriends(userID);
		for (let i = 0; i < rows.length; i++) {
			let friendSocket = sockets.get(rows[i].id);
			if (friendSocket != null)
				friendSocket.emit("friend", [0, userID, false]);
		}
		//TODO remove from Matchmaking
		sockets.delete(userID);
		console.log(userID + " disconnected | reason " + reason);
	});
	socket.on("new", async function() => { //TODO move to handshake
		userID = DatabaseManager.createNewUser();
		sockets.set(userID, socket);
		socket.emit("new", userID);
		console.log(userID + " registered | transport " + socket.conn.transport.name);
	});
	socket.on("name", (data) => {
		DatabaseManager.setName();
		userSubscriptions.forEach(function (subscribedUsers, otherSocket) {
			if (subscribedUsers.includes(userID))
				otherSocket.emit("name", [userID, data]);
		});
	});
	socket.on("image", async (data) => {
		let thumbnailList = data[1];
		let imageBuffer = new Uint8Array(data[0]);
		let thumbnailBuffer = new Uint8Array(thumbnailList);
		await FileManager.saveFile(true, userID, imageBuffer);
		await File.Manager.saveFile(false, userID, thumbnailBuffer);
		userSubscriptions.forEach(function (subscribedUsers, otherSocket) {
			if (subscribedUsers.includes(userID))
				otherSocket.binary(true).emit("thumbnail", [userID, thumbnailList]);
		});
	});
	socket.on("get_image", async (data) => {
		let image = await FileManager.getFile(true, data.toString());
		socket.emit("image", [data, image]);
	});
	socket.on("user", (data) => {
		//TODO check subscribed users
		stmt = "SELECT * FROM users WHERE id=?";
		let subscribedUsers = userSubscriptions.get(socket);
		if (subscribedUsers == null) {
			subscribedUsers = [data[0]];
			userSubscriptions.set(socket, subscribedUsers);
		} else
			subscribedUsers.push(data[0]);
		for (let i = 1; i < data.length; i++) {
			stmt += " OR id=?"
			subscribedUsers.push(data[i]);
		}
		dbConnectionPool.query(stmt, data,
			async function (error, results, fields) {
				if (results === undefined || results.length == 0)
					return;
				let users = [];
				for (let i = 0; i < results.length; i++) {
					let user = results[i];
					let thumbnail = await FileManager.getFile(false, user.id.toString());
					users[i] = [user.id, user.name, thumbnail];
				}
				socket.emit("user", users);
			}
		);
	});
	socket.on("search_user", (data) => {
		stmt = "SELECT id FROM users WHERE id!=? AND (name LIKE ?"
		if (data.match("^[0-9]+$"))
			stmt += " OR id=?)"
		else
			stmt += ")";
		dbConnectionPool.query(stmt, [userID, "%" + data + "%", data],
			function (error, results, fields) {
				if (results === undefined)
					return;
				let userIDs = [];
				for (let i = 0; i < results.length; i++) {
					userIDs[i] = results[i].id;
				}
				socket.emit("search_user", userIDs);
			}
		);
	});
	socket.on("invite", (data) => {
		dbConnectionPool.query("INSERT INTO invites(fromid, toid, type) VAlUES (?, ?, ?)", [userID, data[0], data[1]],
			function (error, results, fields) {
				if (results === undefined || results.length == 0)
					return;
				let socketTo = sockets.get(data[0]);
				if (socketTo != null) {
					socketTo.emit("invite", [1, results.insertId, userID, data[1]]);
				}
			}
		);
	});
	socket.on("decline", (data) => {
		socket.emit("invite", [0, data]);
		dbConnectionPool.query("DELETE FROM invites WHERE id=?", [data]);
	});
	socket.on("add_friend", (data) => {
		socket.emit("invite", [0, data[0]]);
		dbConnectionPool.query("DELETE FROM invites WHERE id=?", [data[0]]);
		let queryArguments = userID < data[1] ? [userID, data[1]] : [data[1], userID];
		dbConnectionPool.query("INSERT INTO friends(userid,friendid) VAlUES (?, ?)", queryArguments,
			function (error, results, fields) {
				if (results === undefined || results.length == 0)
					return;
				let socketTo = sockets.get(data[1]);
				if (socketTo != null) {
					socketTo.emit("friend", [1, userID, true]);
					socket.emit("friend", [1, data[1], true]);
				} else
					socket.emit("friend", [1, data[1], false]);
			}
		);
	});
	socket.on("remove_friend", (data) => {
		dbConnectionPool.query("DELETE FROM friends WHERE userid=? AND friendid=? \
		OR userid=? AND friendid=?", [userID, data, data, userID]);
		let socketTo = sockets.get(data);
		if (socketTo != null)
			socketTo.emit("friend", [2, userID]);
		socket.emit("friend", [2, data]);
	});
	socket.on("accept_invite", (data) => {
		//TODO remove from MatchMaking
		socket.emit("invite", [0, data[0]]);
		dbConnectionPool.query("DELETE FROM invites WHERE id=?", [data[0]]);
		leaveRoom(userID, socket);
		let otherSocket = sockets.get(data[1]);
		if (otherSocket != null) {
			let room = rooms.get(data[1]);
			if (room == null) {
				let room = new Object();
				room.namespace = roomIndex++;
				otherSocket.join(room.namespace);
				socket.join(room.namespace);
				rooms.set(data[1], room);
				rooms.set(userID, room);
				room.users = [data[1], userID];
				room.strangers = [];
				room.players = [];
				io.to(room.namespace).emit("lobby", [0, room.users, false]);
			} else {
				if (room.users.includes(userID))
					return
				room.users.push(userID);
				socket.emit("lobby", [0, room.users, room.strangers.length > 0]);
				rooms.set(userID, room);
				io.to(room.namespace).emit("lobby", [1, userID]);
				socket.join(room.namespace);
			}
			//TODO remove from MatchMaking
		}
	});
	socket.on("leader", (data) => {
		let room = rooms.get(userID);
		let users = room.users;
		users.splice(users.indexOf(data), 1);
		users.unshift(data);
		io.in(room.namespace).emit("lobby", [3, data]);
	});
	socket.on("kick", (data) => {
		leaveRoom(data);
	});
	socket.on("chat", (data) => {
		let room = rooms.get(userID);
		socket.to(room.namespace).emit("chat", [userID, data]);
	});
	socket.on("start", (data) => {
		let room = rooms.get(userID);
		let missingUsers = 3 - room.users.length;
		//TODO implement new matchmaking
		/*if (data[0] && matchMaking.length >= missingUsers) {
			let strangers = room.strangers;
			strangers = matchMaking.splice(matchMaking.length - missingUsers, missingUsers);
			for (let i = 0; i < strangers.length; i++) {
				let strangerID = strangers[i];
				room.users.push(strangerID);
				io.to(room.namespace).emit("lobby", [1, strangerID]);
			}
			for (let i = 0; i < strangers.length; i++) {
				let strangerID = strangers[i];
				let strangerSocket = sockets.get(strangerID);
				rooms.set(strangerID, room);
				strangerSocket.join(room.namespace);
				strangerSocket.emit("lobby", [0, room.users, true]);
			}
		}*/
		room.extendTimers = data[1];
		io.in(room.namespace).emit("start", room.extendTimers);
		room.timeout = setTimeout(function () { startGame(room) }, 5500);
	});
	socket.on("cancel_start", (data) => {
		let room = rooms.get(userID);
		clearTimeout(room.timeout);
		io.in(room.namespace).emit("cancel_start");
	});
	socket.on("match", (data) => {
		//TODO implement new matchmaking
		/*let index = matchMaking.indexOf(userID);
		if (index != -1)
			return;
		if (matchMaking.length > 0) {
			let room = new Object();
			room.namespace = roomIndex++;
			room.users = matchMaking.splice(matchMaking.length - 1, 1);
			room.users.push(userID);
			for (let i = 0; i < 2; i++) {
				let otherID = room.users[i];
				let otherSocket = sockets.get(otherID);
				otherSocket.join(room.namespace);
				rooms.set(otherID, room);
			}
			room.strangers = Array.from(room.users);
			room.players = [];
			io.to(room.namespace).emit("lobby", [0, room.users, true]);
			room.extendTimers = false;
			io.in(room.namespace).emit("start", false);
			room.timeout = setTimeout(function () { startGame(room) }, 5500);
		} else {
			matchMaking.push(userID);
			socket.emit("match", true);
		}*/
	});
	socket.on("cancel_match", (data) => {
		//TODO remove from matchmaking and inform client
		socket.emit("match", false);
		let index = matchMaking.indexOf(userID);
	});
	socket.on("answer", (data) => {
		let room = rooms.get(userID);
		if (room.timeout.stopped != null) return;
		let answers = room.answers;
		if (!answers.hasOwnProperty(userID))
			io.in(room.gamespace).emit("done", userID);
		answers[userID] = data;
		let keys = Object.keys(answers);
		if (keys.length == room.players.length + 1) {
			clearTimeout(room.timeout);
			io.in(room.gamespace).emit("answers", answers);
			room.timeout = setTimeout(function () { sendVotes(room) }, room.extendTimers ? 40500 : 20500);
		}
	});
	socket.on("vote", (data) => {
		let room = rooms.get(userID);
		if (room.timeout.stopped != null) return;
		let votes = room.votes;
		if (!votes.hasOwnProperty(userID))
			io.in(room.gamespace).emit("done", userID);
		votes[userID] = data;
		let voters = Object.keys(votes);
		if (voters.length == room.players.length) {
			clearTimeout(room.timeout);
			sendVotes(room);
		}
	});
});

function startGame(room) {
	room.round = 0;
	room.scores = new Object();
	room.gamespace = roomIndex++;
	room.players = Array.from(room.users);
	for (let i = 0; i < room.players.length; i++) {
		let userID = room.players[i];
		room.scores[userID] = 0; //TODO keep track of score
		let socket = sockets.get(userID);
		socket.join(room.gamespace);
	}
	sendQuestion(room);
}

function endGame(room) {
	let strangers = room.strangers;
	for (let i = 0; i < strangers.length; i++)
		leaveRoom(strangers[i], undefined, room);
	console.log("game ended");
}

function sendQuestion(room) {
	dbConnectionPool.query("SELECT * FROM questions ORDER BY RAND() LIMIT 1",
		function (error, results, fields) {
			if (results === undefined || results.length == 0)
				return;
			let result = results[0];
			room.questionID = result.id;
			room.votes = new Object();
			room.answers = new Object();
			room.answers[0] = result.answer;
			room.round++;
			io.in(room.gamespace).emit("question", result.question);
			room.timeout = setTimeout(function () { sendAnswers(room) }, room.extendTimers ? 60500 : 40500);
		}
	);
}

function sendAnswers(room) {
	room.timeout.stopped = true;
	let answers = room.answers;
	let keys = Object.keys(answers);
	let missingAnswers = room.players.length - (keys.length - 1);
	dbConnectionPool.query("SELECT suggestion FROM suggestions WHERE id=? ORDER BY RAND() LIMIT ?", [room.questionID, missingAnswers],
		function (error, results, fields) {
			if (results === undefined || results.length == 0)
				return;
			let id = 0;
			for (let i = 0; i < results.length; i++)
				answers[--id] = results[i].suggestion;
			missingAnswers = missingAnswers - results.length;
			for (let i = 0; i < missingAnswers; i++)
				answers[--id] = randomWords();
			io.in(room.gamespace).emit("answers", answers);
			room.timeout = setTimeout(function () { sendVotes(room) }, room.extendTimers ? 40500 : 20500);
		}
	);
}

function sendVotes(room) {
	room.timeout.stopped = true;
	let votes = room.votes;
	let voters = Object.keys(votes);
	let votesInfo = new Object();
	for (let i = 0; i < voters.length; i++) {
		let voterID = voters[i];
		let authorID = votes[voterID];
		if (votesInfo[authorID] == null)
			votesInfo[authorID] = [voterID];
		else {
			let votesList = votesInfo[authorID];
			votesList.push(voterID);
		}
	}
	io.in(room.gamespace).emit("answers", votesInfo);
	let duration = 4500 + room.players.length * 500;
	if (votesInfo[0] == null) duration += 3500;
	let votedAuthors = Object.keys(votesInfo);
	for (let i = 0; i < votedAuthors.length; i++) {
		duration += 5000 + votesInfo[votedAuthors[i]].length * 500;
	}
	if (room.round == 1) {
		duration += 10000;
		setTimeout(function () { endGame(room) }, duration);
	} else
		setTimeout(function () { sendQuestion(room) }, duration);
}

function leaveRoom(userID, socket, room, disconnecting) {
	room = room || rooms.get(userID);
	if (room == null) return;
	socket = socket || sockets.get(userID);
	unregisterRoom(userID, socket, room, disconnecting);

	let users = room.users;
	users.splice(users.indexOf(userID), 1);
	if (users.length == 1) {
		unregisterRoom(users[0], undefined, room, disconnecting);
		delete(room);
	} else {
		let strangers = room.strangers;
		let index = strangers.indexOf(userID);
		if (index != -1) {
			strangers.splice(index, 1);
			if (strangers.length == 0) io.in(room.namespace).emit("public_lobby", false);
		}

		let players = room.players;
		index = players.indexOf(userID);
		if (index != -1) {
			players.splice(index, 1);
			if (players.length == 1) clearTimeout(room.timeout);
		}

		io.in(room.namespace).emit("lobby", [2, userID]);
	}
}

function unregisterRoom(userID, socket, room, disconnecting) {
	socket = socket || sockets.get(userID);

	rooms.delete(userID);

	if (!disconnecting) {
		socket.leave(room.namespace);
		if (room.gamespace != null) socket.leave(room.gamespace);
		socket.emit("lobby", [0, []]);
	}
}

process.stdin.resume();//so the program will not close instantly

function exitHandler(options, exitCode) {
	if (options.cleanup) {
		io.close();
		DatabaseManager.close();
	}
	if (exitCode || exitCode === 0) console.log(exitCode);
	if (options.exit) process.exit();
}

//do something when app is closing
process.on("exit", exitHandler.bind(null, { cleanup: true }));

//catches ctrl+c event
process.on("SIGINT", exitHandler.bind(null, { exit: true }));

// catches "kill pid" (for example: nodemon restart)
process.on("SIGUSR1", exitHandler.bind(null, { exit: true }));
process.on("SIGUSR2", exitHandler.bind(null, { exit: true }));

//catches uncaught exceptions
process.on("uncaughtException", exitHandler.bind(null, { exit: true }));