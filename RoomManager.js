let IO
let NamespaceCounter

function RoomManager(_IO, _Users, _NamespaceCounter) {
    IO = _IO
    NamespaceCounter =  _NamespaceCounter
    return RoomManager.prototype
}

RoomManager.prototype.returnToRoom = function(players) {
    let rooms = new Object()
    for (let i = 0; i < players.length; i++) {
        let player = players[i]
        if (player.room) {
            let users = rooms[player.room.namespace]
            if (users) users.push(player)
            else users = [player] 
        } else 
            player.socket.emit("lobby", [0, []])
    }
    let keys = Object.keys(rooms)
    for (let i = 0; i < keys.length; i++) {
        let namespace = keys[i]
        let users = rooms[namespace]
        let userIDs = users.map((user) => user.userID)
        IO.to(namespace).emit("lobby", [0, userIDs])
    }
}

RoomManager.prototype.createRoom = function(users) {
	this.namespace = ++NamespaceCounter.count
    this.users = users
    let userIDs = []
	for (let i = 0; i < users.length; i++) {
        let user = users[i]
        userIDs.push(user.userID)
        user.socket.join(this.namespace)
        user.room = this
    }
	IO.to(this.namespace).emit("lobby", [0, userIDs])
}

const Room = RoomManager.prototype.createRoom

Room.prototype.add = function(user) {
    if (this.users.includes(user)) return
    this.users.push(user)
    let userIDs = this.users.map((user) => user.userID)
    user.socket.emit("lobby", [0, userIDs])
    IO.to(this.namespace).emit("lobby", [1, user.userID])
    user.socket.join(this.namespace)
    user.room = this  
}

Room.prototype.setLeader = function(user) {
    let users = this.users
    users.splice(users.indexOf(user), 1)
    users.unshift(user)
    IO.in(this.namespace).emit("lobby", [3, user.userID])
}

Room.prototype.remove = function(user) {
    user.room = undefined
    user.socket.leave(this.namespace)
    let users = this.users
    users.splice(users.indexOf(user), 1)
    user.socket.emit("lobby", [0, []])

    if (users.length == 1) {
        let otherUser = users[0]
        otherUser.room = undefined
        otherUser.socket.leave(this.namespace)
        otherUser.socket.emit("lobby", [0, []])
    } else {
        IO.in(this.namespace).emit("lobby", [2, user.userID])
    }
}

module.exports = RoomManager;
