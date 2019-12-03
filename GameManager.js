const RandomWords = require('random-words')

let IO
let NamespaceCounter
let DatabaseManager
let RoomManager

function GameManager(_IO, _NamespaceCounter, _DatabaseManager, _RoomManager) {
	IO = _IO
	NamespaceCounter = _NamespaceCounter
	DatabaseManager = _DatabaseManager
	RoomManager = _RoomManager
	return GameManager.prototype
}
	
GameManager.prototype.createGame = function(players, options) {
	this.namespace = ++NamespaceCounter.count
	this.players = players
	let playerIDs = []
	for (let i = 0; i < players.length; i++) {
		let player = players[i]
		player.game = this
		playerIDs.push(player.userID)
		player.socket.join(this.namespace)
	}
	this.options = options
	if (options.addStrangers)
		IO.to(this.namespace).emit("lobby", [0, playerIDs, options.addStrangers])
	IO.to(this.namespace).emit("start", this.options.extendTimers)
	return this
}

const Game = GameManager.prototype.createGame

Game.prototype.startGame = function() {
	this.scores = new Object()
	this.round = 0
	this.sendQuestion()
}

Game.prototype.sendQuestion = async function() {
	let rows = await DatabaseManager.getQuestion()
	let row = rows[0]
	this.questionID = row.id
	this.answers = new Object()
	this.answers[0] = row.answer
	this.round++
	IO.in(this.namespace).emit("question", row.question)
	let game = this
	this.timeout = setTimeout(function () { game.sendAnswers() }, this.options.extendTimers ? 60500 : 40500)
}

Game.prototype.addAnswer = function(userID, answer) {
	if (this.timeout.elapsed) return
	if (!this.answers.hasOwnProperty(userID))
		IO.in(this.namespace).emit("done", userID)
	this.answers[userID] = answer
	let keys = Object.keys(this.answers)
	if (keys.length == this.players.length + 1) {
		clearTimeout(this.timeout)
		IO.in(this.namespace).emit("answers", this.answers)
		this.votes = new Object()
		let game = this
		this.timeout = setTimeout(function () { game.sendVotes() }, this.options.extendTimers ? 40500 : 20500)
	}
}

Game.prototype.sendAnswers = async function() {
	this.timeout.elapsed = true

	let keys = Object.keys(this.answers)
	let missingAnswers = this.players.length - (keys.length - 1)
	let rows = await DatabaseManager.getAnswers(this.questionID, missingAnswers)
	let id = 0
	for (let i = 0; i < rows.length; i++)
		this.answers[--id] = rows[i].suggestion

	missingAnswers = missingAnswers - rows.length
	for (let i = 0; i < missingAnswers; i++)
		this.answers[--id] = RandomWords()

	IO.in(this.namespace).emit("answers", this.answers)

	this.votes = new Object()
	let game = this
	this.timeout = setTimeout(function () { game.sendVotes() }, this.options.extendTimers ? 40500 : 20500)
}

Game.prototype.addVote = function(userID, authorID) {
	if (this.timeout.elapsed) return
	if (!this.votes.hasOwnProperty(userID))
		IO.in(this.namespace).emit("done", userID)
	this.votes[userID] = authorID
	let voters = Object.keys(this.votes)
	if (voters.length == this.players.length) {
		clearTimeout(this.timeout)
		this.sendVotes()
	}
}

Game.prototype.sendVotes = function() {
	this.timeout.elapsed = true

	let votes = this.votes
	let voters = Object.keys(votes)
	let authorVoters = new Object()
	for (let i = 0; i < voters.length; i++) {
		let voterID = voters[i]
		let authorID = votes[voterID]
		if (authorVoters[authorID] == undefined)
			authorVoters[authorID] = [voterID]
		else {
			let votersList = authorVoters[authorID]
			votersList.push(voterID)
		}
	}
    IO.in(this.namespace).emit("votes", authorVoters)
    
	let duration = 4500 + this.players.length * 500
	if (authorVoters[0] == undefined) duration += 3500
	let votedAuthors = Object.keys(authorVoters)
	for (let i = 0; i < votedAuthors.length; i++)
		duration += 5000 + authorVoters[votedAuthors[i]].length * 500

	let game = this
	if (this.round == 6) {
		duration += 10000
		setTimeout(function () { game.endGame() }, duration)
	} else
		setTimeout(function () { game.sendQuestion() }, duration)
}

Game.prototype.endGame = function() {
	IO.in(this.namespace).emit("end")
    let players = this.players
    for (let i = 0; i < players.length; i++) {
		let player = players[i]
		player.game = undefined
		player.socket.leave(this.namespace)
	}
	if (this.options.addStrangers)
		RoomManager.returnToRoom(players)
}

Game.prototype.remove = function(player) {
	player.game = undefined
	player.socket.leave(this.namespace)
	let players = this.players
	players.splice(players.indexOf(player), 1)
	if (this.options.addStrangers)
		RoomManager.returnToRoom(player)

	if (players.length == 1) {
		clearTimeout(this.timeout)

		let otherPlayer = players[0]
		otherPlayer.game = undefined
		otherPlayer.socket.leave(this.namespace)
		if (this.options.addStrangers)
			RoomManager.returnToRoom(otherPlayer)
	}
}

module.exports = GameManager
