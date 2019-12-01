const HashMap = require("hashmap")

const PlayerLimit = 5
const Combinations = new HashMap() // number : [Combinations]
const WaitingLists = new HashMap() // numberOfPlayers : [[users]]

for (let i = 1; i < PlayerLimit; i++) {
	Combinations.set(i, findCombinations(i))
	WaitingLists.set(i, [])
}

exports.findPlayers = function (count) {
    let combinations = Combinations.get(count)
	for (let i = 0; i < combinations.length; i++) {
        let combination = combinations[i]
        let possible = true
        let keys = Object.keys(combination)
		for (let i = 0; i < keys.length; i++) {
            let groupSize = Number(keys[i])
            let groupCount = combination[groupSize]
			let groups = WaitingLists.get(groupSize)
			if (groups.length < groupCount) {
				possible = false
				break
			}
		}
		if (possible) {
            let players = []
            let keys = Object.keys(combination)
			for (let i = 0; i < keys.length; i++) {
                let groupSize = Number(keys[i])
                let groupCount = combination[groupSize]
                for (let i = 0; i < groupCount; i++) {
                    let group = WaitingLists.get(groupSize).shift()
                    if (groupSize)
                        players.push(group)
                    else
                        players = players.concat(group)
                }
			}
			return players
		}
	}
	return undefined
}

exports.addUsers = function(users) {
	if (users.length == 1)
		exports.addUser(users[0])
	else {
		WaitingLists.get(users.length).push(users)
		for (let i = 0; i < users.length; i ++)
			users[i].socket.emit("match", true)
	}
}

exports.addUser = function(user) {
	WaitingLists.get(1).push(user)
	user.socket.emit("match", true)
}

exports.removeUsers = function(users) {
	if (users.length == 1) {
		exports.removeUser(users[0])
	} else {
		let groups = WaitingLists.get(users.length)
		let index = groups.indexOf(users)
		if (index != -1) {
			groups.splice(users, 1)
			for (let i = 0; i < users.length; i ++)
				users[i].socket.emit("match", false)
		}
	}
}

exports.removeUser = function(user) {
	let users = WaitingLists.get(1)
	let index = users.indexOf(user)
	if (index != -1) {
		users.splice(index, 1)
		user.socket.emit("match", false)
	}
}

function findCombinations(number){
	let combinationLists = []
    partition(number, number, [], combinationLists)
    let combinationObjects = []
    for (let i = 0; i < combinationLists.length; i++) {
        let combinationList = combinationLists[i]
        let combinationObject = new Object()
        for (let i = 0; i < combinationList.length; i++) {
            let num = combinationList[i]
            if (combinationObject[num]) combinationObject[num]++
            else combinationObject[num] = 1 
        }
        combinationObjects.push(combinationObject)
    }
	return combinationObjects
}

function partition(n, max, result, Combinations) {
	if (n == 0) {
		Combinations.push(result)
		return
	}
	for (let i = Math.min(max, n); i >= 1; i--) {
		let resultCopy = result.slice()
		resultCopy.push(i)
		partition(n-i, i, resultCopy, Combinations)
	}
}