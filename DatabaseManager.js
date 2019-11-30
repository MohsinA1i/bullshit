const mysql = require("mysql");
const dbConnectionPool = mysql.createPool({
	connectionLimit: 10,
	host: "taharazamysql.mysql.database.azure.com",
	user: "user@taharazamysql",
	password: "4Blendb87Raptor",
	database: "bullshit"
});

exports.close = function (){
	dbConnectionPool.end();
}

exports.getInvites = async function(userID) {
   return await query("SELECT id, fromid, type from invites WHERE toid=? ORDER BY id DESC", [userID]);
}

exports.getFriends = async function(userID) {
    let friends = await query("SELECT users.id FROM users INNER JOIN friends ON \
	friends.userid=? AND users.id=friends.friendid \
    OR friends.friendid=? AND users.id=friends.userid", [userID, userID]);
    return friends;
}

exports.getMyUser = async function(userID) {
    return await query("SELECT name FROM users WHERE id = ?", [userID]);
}

exports.createNewUser = async function() {
    let rows = await query("INSERT INTO users VALUES (DEFAULT, DEFAULT)");
    return rows.insertId;
}

exports.setName = function(userID, name) {
    query("UPDATE users SET name = ? WHERE id = ?", [name, userID]);
}

exports.searchUser = async function(userID, string) {
    stmt = "SELECT id FROM users WHERE id!=? AND (name LIKE ?"
    if (string.match("^[0-9]+$"))
        stmt += " OR id=?)"
    else
        stmt += ")";
    return await query(stmt, [userID, "%" + string + "%", string]);
}

exports.getUsers = async function(userIDs) {
    stmt = "SELECT * FROM users WHERE id=?";
    for (let i = 1; i < userIDs.length; i++)
        stmt += " OR id=?"
    return await query(stmt, userIDs);
}

exports.addInvite = async function(userID, toID, type) {
    return await query("INSERT INTO invites(fromid, toid, type) VAlUES (?, ?, ?)", [userID, toID, type]);
}

exports.removeInvite = function(inviteID) {
    query("DELETE FROM invites WHERE id=?", [inviteID]);
}

exports.addFriend = async function(userID, friendID) {
	let queryArguments = userID < friendID ? [userID, friendID] : [friendID, userID];
    return await query("INSERT INTO friends(userid, friendid) VAlUES (?, ?)", queryArguments).catch((err) => {});
}

exports.removeFriend = function(userID, friendID) {
	let queryArguments = userID < friendID ? [userID, friendID] : [friendID, userID];
    query("DELETE FROM friends WHERE userid=? AND friendid=?", queryArguments);
}

exports.getQuestion = async function() {
    return await query("SELECT * FROM questions ORDER BY RAND() LIMIT 1");
}

exports.getAnswers = async function(questionID, missingAnswers) {
    return await query("SELECT suggestion FROM suggestions WHERE id=? ORDER BY RAND() LIMIT ?", [questionID, missingAnswers]);
}

function query(stmt, args) {
    return new Promise((resolve, reject) => {
        dbConnectionPool.query(stmt, args, (err, rows) => {
            if (err)
                return reject(err);
            resolve(rows);
        });
    });
}