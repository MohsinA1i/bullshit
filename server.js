const Express = require('express')
const App = Express()
const Server = require('http').createServer(App)
const IO = require('socket.io')(Server, {
	pingInterval: 10000,
	pingTimeout: 10000,
	cookie: false
})
const Port = process.env.PORT || 80
Server.listen(Port, () => {
	console.log('Server listening at port %d', Port)
})

const HashMap = require("hashmap")

const Users = new HashMap() // userID : {userID, socket, room, game}
let NamespaceCounter = { count : 0 }
const UserSubscriptions = new HashMap() // socket : [userIDs]

const FileManager = require('./FileManager.js')
const DatabaseManager = require('./DatabaseManager.js')
const MatchMaking = require('./MatchMaking.js')
const RoomManager = require('./RoomManager')(IO, NamespaceCounter)
const GameManager = require('./GameManager.js')(IO, NamespaceCounter, DatabaseManager, RoomManager)

IO.on("connection", async (socket) => {
	if (socket.handshake.query.ver != "0.24") {
		socket.emit("update")
		socket.disconnect(true)
		return
	}
	let User = {socket : socket}
	User.userID = parseInt(socket.handshake.query.id)
	if (User.userID == undefined || Users.has(User.userID)) {
		socket.disconnect(true)
		return
	}
	console.log(User.userID + " connected | transport " + socket.conn.transport.name)
	socket.leave(socket.id)
	Users.set(User.userID, User)

	socket.on("disconnecting", async (reason) => {
		rows = await DatabaseManager.getFriends(User.userID)
		for (let i = 0; i < rows.length; i++) {
			let friend = Users.get(rows[i].id)
			if (friend)
				friend.socket.emit("friend", [3, User.userID, false])
		}
		MatchMaking.removeUser(User)
		Users.delete(User.userID)
		console.log(User.userID + " disconnected | reason " + reason)
	});
	socket.on("new", async () => {
		User.userID = DatabaseManager.createNewUser()
		Users.set(User.userID, User)
		socket.emit("new", User.userID)
		console.log(User.userID + " registered | transport " + socket.conn.transport.name)
	});
	socket.on("name", (data) => {
		DatabaseManager.setName(User.userID, data)
		UserSubscriptions.forEach((subscribedUsers, otherSocket) => {
			if (subscribedUsers.includes(User.userID))
				otherSocket.emit("name", [User.userID, data])
		})
	});
	socket.on("image", async (data) => {
		let thumbnailList = data[1]
		let imageBuffer = new Uint8Array(data[0])
		let thumbnailBuffer = new Uint8Array(thumbnailList)
		await FileManager.saveFile(true, User.userID, imageBuffer)
		await FileManager.saveFile(false, User.userID, thumbnailBuffer)
		UserSubscriptions.forEach(function (subscribedUsers, otherSocket) {
			if (subscribedUsers.includes(User.userID))
				otherSocket.binary(true).emit("thumbnail", [User.userID, thumbnailList])
		})
	});
	socket.on("get_image", async (data) => {
		let image = await FileManager.getFile(true, data.toString())
		socket.emit("image", [data, image])
	});
	socket.on("user", async (data) => {
		let subscribedUsers = UserSubscriptions.get(socket)
		if (subscribedUsers == undefined) {
			subscribedUsers = data
			UserSubscriptions.set(socket, subscribedUsers)
		} else {
			subscribedUsers = subscribedUsers.concat(data)
		}
		let rows = await DatabaseManager.getUsers(data)
		let users = []
		for (let i = 0; i < rows.length; i++) {
			let user = rows[i]
			let thumbnail = await FileManager.getFile(false, user.id.toString())
			users[i] = [user.id, user.name, thumbnail]
		}
		socket.emit("user", users)
	});
	socket.on("search_user", async (data) => {
		let rows = await DatabaseManager.searchUser(User.userID, data)
		let userIDs = []
		for (let i = 0; i < rows.length; i++) {
			userIDs[i] = rows[i].id
		}
		socket.emit("search_user", userIDs)
	});
	socket.on("invite", async (data) => {
		let rows = await DatabaseManager.addInvite(User.userID, data[0], data[1])
		let recipient = Users.get(data[0])
		if (recipient)
			recipient.socket.emit("invite", [1, rows.insertId, User.userID, data[1]])
	});
	socket.on("decline", (data) => {
		socket.emit("invite", [0, data])
		DatabaseManager.removeInvite(data)
	});
	socket.on("add_friend", async (data) => {
		socket.emit("invite", [0, data[0]])
		DatabaseManager.removeInvite(data[0])
		let success = await DatabaseManager.addFriend(User.userID, data[1])
		if (success) {
			let friend = Users.get(data[1])
			if (friend) {
				friend.socket.emit("friend", [1, User.userID, true])
				socket.emit("friend", [1, data[1], true])
			} else
				socket.emit("friend", [1, data[1], false])
		}
	});
	socket.on("remove_friend", (data) => {
		DatabaseManager.removeFriend(User.userID, data)
		let friend = Users.get(data)
		if (friend)
			friend.socket.emit("friend", [2, User.userID])
		friend.socket.emit("friend", [2, data])
	});
	socket.on("join", (data) => {
		let inviteID = data[0]
		DatabaseManager.removeInvite(inviteID)
		socket.emit("invite", [0, inviteID])
		let otherUser = Users.get(data[1])
		if (otherUser) {
			MatchMaking.removeUser(User)
			if (User.game) User.game.remove(User)
			if (User.room) User.room.remove(User)
			if (otherUser.room) otherUser.room.add(User)
			else new RoomManager.createRoom([User, otherUser])
		}
	});
	socket.on("leader", (data) => {
		let user = User.room.users.find((user) => user.userID == data)
		User.room.setLeader(user)
	});
	socket.on("kick", (data) => {
		let user = User.room.users.find((user) => user.userID == data)
		User.room.remove(user)
	});
	socket.on("chat", (data) => {
		let namespace = User.game ? User.game.namespace : User.room.namespace
		socket.to(namespace).emit("chat", [User.userID, data])
	});
	socket.on("start", (data) => {
		let players = User.room ? User.room.users : [User] 
		if (!User.room || data[0]) {
			let strangers = MatchMaking.findPlayers(5 - players.length)
			if (strangers)
				players = players.concat(strangers)
			else {
				MatchMaking.addUsers(players)
				return
			}
		}
		new GameManager.createGame(players, data[1])
	});
	socket.on("answer", (data) => {
		User.game.addAnswer(User.userID, data)
	});
	socket.on("vote", (data) => {
		User.game.addVote(User.userID, data)
	});

	let rows = await DatabaseManager.getInvites(User.userID)
	let invites = []
    for (let i = 0; i < rows.length; i++) {
        let invite = rows[i]
        invites[i] = [invite.id, invite.fromid, invite.type]
    }
	socket.emit("invite", invites)

	rows = await DatabaseManager.getFriends(User.userID)
	let friends = []
    for (let i = 0; i < rows.length; i++) {
        let friendsUserID = rows[i].id
        let friend = Users.get(friendsUserID)
        friends[i] = [friendsUserID, friend != undefined]
        if (friend)
            friend.socket.emit("friend", [3, User.userID, true])
    }
	socket.emit("friend", [0, friends])
	
	rows = await DatabaseManager.getMyUser(User.userID)
	let image = await FileManager.getFile(true, User.userID.toString())
	let thumbnail = await FileManager.getFile(false, User.userID.toString())
	socket.binary(true).emit("my_user", [rows[0].name, thumbnail, image])
});

process.stdin.resume()//so the program will not close instantly

function exitHandler(options, exitCode) {
	if (options.cleanup) {
		IO.close()
		DatabaseManager.close()
	}
	if (exitCode || exitCode === 0) console.log(exitCode)
	if (options.exit) process.exit()
}

//do something when app is closing
process.on("exit", exitHandler.bind(undefined, { cleanup: true }))

//catches ctrl+c event
process.on("SIGINT", exitHandler.bind(undefined, { exit: true }))

// catches "kill pid" (for example: nodemon restart)
process.on("SIGUSR1", exitHandler.bind(undefined, { exit: true }))
process.on("SIGUSR2", exitHandler.bind(undefined, { exit: true }))

//catches uncaught exceptions
process.on("uncaughtException", exitHandler.bind(undefined, { exit: true }))