const HashMap = require("hashmap");

const PlayerLimit = 4;
const Combinations = new HashMap(); // number : [Combinations]
const WaitingLists = new HashMap(); // players : [rooms]

for (let i = 1; i <= PlayerLimit; i++) {
	Combinations.set(i, findCombinations(i));
	WaitingLists.set(i,[]);
}

exports.findPlayers = function (numberOfplayers) {
	let partitions = Combinations.get(numberOfplayers);
	for (let i = 0; i < partitions.length; i++) {
		let partition = partitions[i];
		if (partition == null) continue;
		let players = [];
		for (let i = 0; i < partition.length; i++) {
			let roomSize = partition[i];
			rooms = WaitingLists.get(roomSize);
			if (rooms.length == 0) {
				players = null;
				for (let i = 0; i < partitions.length; i++) {
					let partition = partitions[i];
					if (partition.includes(roomSize))
						partitions[i] = null;
				}
				break;
			} else {
				let room = rooms.shift();
				players = players.concat(room.users);
			}
		}
		if (players != null)
			return players;
	}
	return null;
}

exports.add = function (room) {
	WaitingLists.get(room.users.length).push(room);
}

exports.remove = function (userID) {
	for (let i = 0; i < PlayerLimit; i++) {
		let rooms = WaitingLists.get(i);
		for (let i = 0; i < rooms.length; i++) {
			let room = rooms[i];
			if (room.users.includes(userID))
				rooms.splice(i,1);
		}
	}
}

function findCombinations(number){
	let Combinations = [];
	partition(number, number, [], Combinations);
	return Combinations;
}

function partition(n, max, result, Combinations) {
	if (n == 0) {
		Combinations.unshift(result);
		return;
	}
	for (let i = Math.min(max, n); i >= 1; i--) {
		let resultCopy = result.slice();
		resultCopy.push(i);
		partition(n-i, i, resultCopy, Combinations);
	}
}