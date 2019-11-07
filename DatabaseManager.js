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
    console.log(friends);
    return friends;
}

exports.getMyUser = async function(userID) {
    return await query("SELECT name FROM users WHERE id = ?", [userID]);
}

exports.createNewUser = async function() {
    let rows = await query("INSERT INTO users VALUES (DEFAULT, DEFAULT)");
    return rows.insertId;
}

exports.setName = function() {
    query("UPDATE users SET name = ? WHERE id = ?", [data, userID]);
}

function query(sql, args) {
    return new Promise((resolve, reject) => {
        dbConnectionPool.query(sql, args, (err, rows) => {
            if (err)
                return reject(err);
            resolve( rows );
        });
    });
}