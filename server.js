var express = require('express');
var app = express();
var server = require('http').createServer(app);
var io = require('socket.io')(server, {
	pingInterval: 10000,
	pingTimeout: 10000,
	cookie: false
});
var port = process.env.PORT || 80;
server.listen(port, () => {
  console.log('Server listening at port %d', port);
});
const {
	Aborter,
	StorageURL,
	ServiceURL,
	ShareURL,
	DirectoryURL,
	FileURL,
	SharedKeyCredential,
	AnonymousCredential
} = require("@azure/storage-file");
// Enter your storage account name and shared key
const account = "taharazastorageaccount";
const accountKey = "jKLRQKYUXsRctlORL5AsFBJr9TmcG/lmQgbrYtI3Asmv5X6FlGu7rWiVY167QHW99hpN7LIgePnuar5ZfHjLKg==";
const sharedKeyCredential = new SharedKeyCredential(account, accountKey);
// Use sharedKeyCredential or anonymousCredential to create a pipeline
const pipeline = StorageURL.newPipeline(sharedKeyCredential);
const serviceURL = new ServiceURL(
	"https://"+account+".file.core.windows.net",
	pipeline
);
const shareURL = ShareURL.fromServiceURL(serviceURL, "bullshit");
var mysql = require("mysql");
var dbConnectionPool  = mysql.createPool({
	connectionLimit : 10,
	host            : "taharazamysql.mysql.database.azure.com",
	user            : "user@taharazamysql",
	password        : "4Blendb87Raptor",
	database        : "bullshit"
});
const HashMap = require("hashmap");

var sockets = new HashMap(); // userID : socket
var rooms = new HashMap(); // userID : room
var userSubscriptions = new HashMap();
var roomIndex = 0;

io.on("connection", function(socket){
	socket.leave(socket.id);
	let userID = socket.handshake.query.id;
	if (userID != null) {
		if (sockets.has(userID))
			socket.disconnect(true);
		console.log(userID + " connected | transport " + socket.conn.transport.name);
		sockets.set(userID, socket);
		dbConnectionPool.query("SELECT id, fromid, type from invites \
		WHERE toid=? ORDER BY id DESC", [userID],
			function (error, results, fields) {
				if (results === undefined)
						return;
				let invites = [];
				for (i = 0; i < results.length; i++) {
					let invite = results[i];
					invites[i] = [invite.id, invite.fromid, invite.type];
				}
				socket.emit("invite", invites);
			}
		);
		dbConnectionPool.query("SELECT users.id FROM users \
		INNER JOIN friends ON \
		friends.userid=? AND users.id=friends.friendid \
		OR friends.friendid=? AND users.id=friends.userid", [userID, userID],
			function (error, results, fields) {
				if (results === undefined)
					return;
				let friends = [];
				for (i = 0; i < results.length; i++) {
					let friendsUserID = results[i].id;
					let friendsSocket = sockets.get(friendsUserID);
					if (friendsSocket == null)
						friends[i] = [friendsUserID, 0];
					else {
						friends[i] = [friendsUserID, 1];
						friendsSocket.emit("friend", [0, userID, 1]);
					}
				}
				socket.emit("friend", friends);
			}
		);
		dbConnectionPool.query("SELECT name FROM users WHERE id = ?", [userID],
			async function (error, results, fields) {
				if (results === undefined)
						return;
				let image = await getFile(true, userID.toString());
				let thumbnail = await getFile(false, userID.toString());
				socket.binary(true).emit("my_user", [results[0].name, thumbnail, image]);
			}
		);
	}
	
	socket.on("disconnecting", (reason) => {
		dbConnectionPool.query("SELECT users.id FROM users \
		INNER JOIN friends ON \
		friends.userid=? AND users.id=friends.friendid \
		OR friends.friendid=? AND users.id=friends.userid", [userID, userID],
			function (error, results, fields) {
				if (results === undefined || results.length == 0)
					return;
				for (i = 0; i < results.length; i++) {
					let friendSocket = sockets.get(results[i].id);
					if (friendSocket != null)
						friendSocket.emit("friend", [0, userID, 0]);
				}
			}
		);
		leaveRoom(null, userID);
		userSubscriptions.delete(socket);
		sockets.delete(userID);
		console.log(userID + " disconnected | reason " + reason);
	});
	socket.on("new", () => {
		dbConnectionPool.query("INSERT INTO users VALUES (DEFAULT, DEFAULT)",
		function (error, results, fields) {
			if (results === undefined || results.length == 0)
				return;
			userID = results.insertId;
			sockets.set(userID, socket);
			socket.emit("new", userID);
			console.log(userID + " registered | transport " + socket.conn.transport.name);
		});
	});
	socket.on("name", (data) => {
		dbConnectionPool.query("UPDATE users SET name = ? WHERE id = ?", [data, userID]);
		userSubscriptions.forEach(function (subscribedUsers, otherSocket) {
			if (subscribedUsers.includes(userID))
				otherSocket.emit("name", [userID, data]);
		});
	});
	socket.on("image", async (data) => {
		let thumbnailList = data[1]; 
		let imageBuffer = new Uint8Array(data[0]);
		let thumbnailBuffer = new Uint8Array(thumbnailList);
		await saveFile(true, userID, imageBuffer);
		await saveFile(false, userID, thumbnailBuffer);
		userSubscriptions.forEach(function (subscribedUsers, otherSocket) {
			if (subscribedUsers.includes(userID))
				otherSocket.binary(true).emit("thumbnail", [userID, thumbnailList]);
		});
	});
	socket.on("get_image", async (data) => {
		let image = await getFile(true, data.toString());
		socket.emit("image", [data, image]);
	});
	socket.on("user", (data) => {
		stmt = "SELECT * FROM users WHERE id=?";
		let subscribedUsers = userSubscriptions.get(socket);
		if (subscribedUsers == null) {
			subscribedUsers = [data[0]];
			userSubscriptions.set(socket, subscribedUsers);
		} else
			subscribedUsers.push(data[0]);
		for (i = 1; i < data.length; i++) {
			stmt+= " OR id=?"
			subscribedUsers.push(data[i]);
		}
		dbConnectionPool.query(stmt, data, 
			async function (error, results, fields) {
				if (results === undefined || results.length == 0)
					return;
				let users = [];
				for (let i = 0; i < results.length; i++) {
					let user = results[i];
					let thumbnail = await getFile(false, user.id.toString());
					users[i] = [user.id, user.name, thumbnail];
				}
				socket.emit("user", users);
			}
		);
	});
	socket.on("search_user", (data) => {
		stmt = "SELECT id FROM users WHERE id!=? AND (name LIKE ?"
		if (data.match("^[0-9]+$"))
			stmt+=" OR id=?)"
		else
			stmt+=")";
		dbConnectionPool.query(stmt, [userID, "%"+data+"%", data],
			function (error, results, fields) {
				if (results === undefined)
					return;
				let userIDs = [];
				for (i = 0; i < results.length; i++) {
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
		dbConnectionPool.query("DELETE FROM invites WHERE id=?",[data]);
	});
	socket.on("add_friend", (data) => {
		socket.emit("invite", [0, data[0]]);
		dbConnectionPool.query("DELETE FROM invites WHERE id=?",[data[0]]);
		let queryArguments = userID < data[1] ? [userID, data[1]] : [data[1], userID];
		dbConnectionPool.query("INSERT INTO friends(userid,friendid) VAlUES (?, ?)",queryArguments, 
			function(error, results, fields) {
				if (results === undefined || results.length == 0)
					return;
				let socketTo = sockets.get(data[1]);
				if (socketTo != null) {
					socketTo.emit("friend", [1, userID, 1]);
					socket.emit("friend", [1, data[1], 1]);
				} else
					socket.emit("friend", [1, data[1], 0]);
			}
		);
	});
	socket.on("remove_friend", (data) => {
		dbConnectionPool.query("DELETE FROM friends WHERE userid=? AND friendid=? \
		OR userid=? AND friendid=?",[userID, data, data, userID]);
		let socketTo = sockets.get(data);
		if (socketTo != null)
			socketTo.emit("friend", [2, userID]);
		socket.emit("friend", [2, data]);
	});
	socket.on("lobby", (data) => {
		socket.emit("invite", [0, data[0]]);
		dbConnectionPool.query("DELETE FROM invites WHERE id=?",[data[0]]);
		leaveRoom(socket, userID);
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
				io.to(room.namespace).emit("lobby", [room.users]);
			} else {
				if (room.users.includes(userID))
					return
				room.users.push(userID);
				socket.emit('lobby', [room.users]);
				rooms.set(userID, room);
				io.to(room.namespace).emit('lobby', [0, userID]);
				socket.join(room.namespace);
			}
		}
	});
	socket.on("leader", (data) => {
		let room = rooms.get(userID);
		let users = room.users;
		users.splice(users.indexOf(data),1);
		users.unshift(data);
		io.in(room.namespace).emit('lobby', [2, data]);
	});
	socket.on("kick", (data) => {
		let socketToKick = sockets.get(data);
		leaveRoom(socketToKick, data);
	});
	socket.on("chat", (data) => {
		let room = rooms.get(userID);
		socket.to(room.namespace).emit("chat", [userID, data]);
	});
	socket.on("start", (data) => {
		let room = rooms.get(userID);
		io.in(room.namespace).emit("start");
		room.timeout = setTimeout(function(){startGame(room)}, 5500);
	});
	socket.on("cancel", (data) => {
		let room = rooms.get(userID);
		clearTimeout(room.timeout);
		io.in(room.namespace).emit("cancel");
	});
	socket.on("answer", (data) => {
		let room = rooms.get(userID);
		let answers = room.answers;
		answers[userID] = data;
		let keys = Object.keys(answers);
		if (keys.length == room.users.length + 1) {
			clearTimeout(room.timeout);
			io.in(room.gamespace).emit("answers", answers);
			room.timeout = setTimeout(function(){sendVotes(room)}, 15500);
		}
	});
	socket.on("vote", (data) => {
		let room = rooms.get(userID);
		let votes = room.votes;
		votes[userID] = data;
		let voters = Object.keys(votes);
		if (voters.length == room.users.length) {
			clearTimeout(room.timeout);
			sendVotes(room);
		}
	});
});

function startGame(room) {
	room.round = 0;
	room.scores = new Object();
	room.gamespace = roomIndex++;
	let userIDs = room.users;
	for (i = 0; i < userIDs.length; i++) {
		let userID = userIDs[i];
		room.scores[userID] = 0;
		let socket = sockets.get(userID);
		socket.join(room.gamespace);
	}
	sendQuestion(room);
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
			room.timeout = setTimeout(function(){sendAnswers(room)}, 30500);
		}
	);
}

function sendAnswers(room) {
	let answers = room.answers;
	let keys = Object.keys(answers);
	let missingAnswers = room.users.length - (keys.length - 1);
	dbConnectionPool.query("SELECT suggestion FROM suggestions WHERE id=? ORDER BY RAND() LIMIT ?", [room.questionID, missingAnswers],
		function (error, results, fields) {
			if (results === undefined || results.length == 0)
					return;
			let id = 0;
			for (i = 0; i < results.length; i++)
				answers[--id] = results[i].suggestion;
			io.in(room.gamespace).emit("answers", answers);
			room.timeout = setTimeout(function(){sendVotes(room)}, 15500);
		}
	);
}

function sendVotes(room) {
	let votes = room.votes;
	let voters = Object.keys(votes);
	let votesInfo = new Object();
	for (i = 0; i < voters.length; i++) {
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
	let duration = 4500 + room.users.length * 500;
	if (votesInfo[0] == null) duration += 3500;
	let votedAuthors = Object.keys(votesInfo); 
	for (i = 0; i < votedAuthors.length; i++) {
		duration += 5500 + votesInfo[votedAuthors[i]].length * 500;
	}
	if (room.round != 6)
		setTimeout(function(){sendQuestion(room)}, duration);
}

function leaveRoom(socket, userID){
	let room = rooms.get(userID);
	if (room == null)
		return;
	rooms.delete(userID);
	let users = room.users;
	users.splice(users.indexOf(userID),1);
	if (socket != null) {
		socket.leave(room.namespace);
		if (room.gamespace != null)
			socket.leave(room.gamespace);
		socket.emit('lobby', []);
	}
	if (users.length == 1) {
		rooms.delete(users[0]);
		let remainingSocket = sockets.get(users[0]);
		users = [];
		remainingSocket.leave(room.namespace);
		if (room.gamespace != null)
			remainingSocket.leave(room.gamespace);
		remainingSocket.emit('lobby', []);
	} else
		io.in(room.namespace).emit('lobby', [1, userID]);
}

async function saveFile(image, userID, content) {
	const directoryName = image ? "images" : "thumbnails";
	const directoryURL = DirectoryURL.fromShareURL(shareURL, directoryName);
	const fileURL = FileURL.fromDirectoryURL(directoryURL, userID + ".jpg");
	await fileURL.create(Aborter.none, content.length);
	await fileURL.uploadRange(Aborter.none, content, 0, content.length);
}
	
async function getFile(image, userID) {
	const directoryName = image ? "images" : "thumbnails";
	const directoryURL = DirectoryURL.fromShareURL(shareURL, directoryName);
	const fileURL = FileURL.fromDirectoryURL(directoryURL, userID + ".jpg");
	const downloadFileResponse = await fileURL.download(Aborter.none, 0).catch(()=>{});
	if (downloadFileResponse == null)
		return null;
	const bytes = await streamToData(downloadFileResponse.readableStreamBody).catch(() => console.log("Error parsing file"));
	return [...bytes];
}
	
async function streamToData(readableStream) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		readableStream.on("data", data => {
			chunks.push(data);
		});
		readableStream.on("end", () => {
			resolve(chunks[0]);
		});
		readableStream.on("error", reject);
	});
}

process.stdin.resume();//so the program will not close instantly

function exitHandler(options, exitCode) {
    if (options.cleanup) {
		io.close();
		dbConnectionPool.end();
	}
    if (exitCode || exitCode === 0) console.log(exitCode);
    if (options.exit) process.exit();
}

//do something when app is closing
process.on("exit", exitHandler.bind(null,{cleanup:true}));

//catches ctrl+c event
process.on("SIGINT", exitHandler.bind(null, {exit:true}));

// catches "kill pid" (for example: nodemon restart)
process.on("SIGUSR1", exitHandler.bind(null, {exit:true}));
process.on("SIGUSR2", exitHandler.bind(null, {exit:true}));

//catches uncaught exceptions
process.on("uncaughtException", exitHandler.bind(null, {exit:true}));