/*
    this javascript file is written by vince at Sat Jul 12 2017
*/

// type of BCTFrame
var FrameType = {};
FrameType.Identification    = 0;
FrameType.PeerMessage       = 1;
FrameType.Login             = 2;
FrameType.Register          = 3;
FrameType.SearchUser        = 4;
FrameType.FriendTransaction = 5;
FrameType.Unused_1   	    = 6;
FrameType.Unused_2	        = 7;
FrameType.TokenAssign       = 8;
FrameType.MessageConfigure  = 9;
FrameType.FriendListRequest = 10;
FrameType.FriendListResponse= 11;
FrameType.Error             = 12;

var FriendTransactionState = {};
FriendTransactionState.Request   = 0;
FriendTransactionState.Complete  = 1;

var FrameVersion = 1;


var net = require('net');

var mysql = require('mysql');

var colors = require('colors');

var databaseConfig = {
    host:'localhost',
    user:'root',
    password:'BarChat_Passw0rd',
    database:'BarChat'
};

var JsonSocket = require('json-socket');

var server = net.createServer();

var port = 6596;

var clients = new Array();

var messageID = 1; 

server.listen(port, function(){
    console.log('[SUCCEED]'.green +' listening on %j', server.address());
});

server.on('connection', handleServerConnection);

var databaseConnectionPool = mysql.createPool(databaseConfig);

databaseConnectionPool.on('connection', handleDatabaseConnection);


function handleServerConnection(serverConnection){
    console.log('[NOTICE]'.yellow + ' new connection incomed');
    
    var socket = new JsonSocket(serverConnection);

    assignToken(socket);

    socket.on('message', handleMessage);
    socket.on('close', handleClose);
	socket.on('error', function(err){
		console.log('[ERROR]'.red + ' ' + err);
	});

    function handleMessage(message){
        console.log('[SUCCEED]'.green + ' frame received: %j', message);

        switch (message.type) {
            case FrameType.Identification:
                identifyClient();
                break;

            case FrameType.PeerMessage:
                forwardMessage();
                break;

			case FrameType.SearchUser:
				searchUser();
				break;

			case FrameType.FriendTransaction:
				dealFriendTransaction();
				break;

			case FrameType.FriendListRequest:
				fetchFriendList();
				break;

			default:
				break;
        }

        function identifyClient() {
            var phoneNumber = message.data.phoneNumber;
            if (clients[phoneNumber]) {
                var originAddress = clients[phoneNumber]._socket.remoteAddress+' : '+clients[phoneNumber]._socket.remotePort;
                var newAddress = socket._socket.remoteAddress+' : '+socket._socket.remotePort;
                // console.log("%s %s", originAddress, newAddress);
                if (originAddress == newAddress) {
                    return;
                };
                console.log('[NOTICE]'.yellow + ' user %s has been replaced', phoneNumber);
                var originalSocket = clients[phoneNumber];
                var frame = createFrame(FrameType.Error,{"error":"you have been replaced"});
                originalSocket.sendEndMessage(frame);
            };
            console.log('[SUCCEED]'.green + ' identify user: %s', phoneNumber);
            clients[phoneNumber] = socket;
            socket.phoneNumber = phoneNumber;

            fetchUnreadMessage();
        }

        function fetchUnreadMessage() {
            // stage 应该是每个用户独立拥有的表
            var phoneNumber = message.data.phoneNumber;
            var sql = "select * from stage where toPhoneNumber = ?";
            var sql_param = [phoneNumber];

            message.data = {'success':true};

            queryDatabasePool(sql, sql_param, function(err, values, fields){
                if (err) {
                    console.log('[FAILED]'.red + ' fetch unread message for: %s \nerr: %j', phoneNumber, err);
                    message.data = {'success':false};
                    return;
                };
                for (var i = 0; i < values.length; i++) {
                    var unreadMessage       = {};
                    unreadMessage.ID        = values[i].id;
                    unreadMessage.from      = values[i].fromPhoneNumber;
                    unreadMessage.to        = values[i].toPhoneNumber;
                    unreadMessage.content   = values[i].content;
                    unreadMessage.date      = values[i].date;
                    unreadMessage.type      = values[i].messageType;
                        
                    var frame = createFrame(unreadMessage.type < 10 ? FrameType.PeerMessage : FrameType.FriendTransaction, unreadMessage);
                    socket.sendMessage(frame);
                    console.log('[SUCCEED]'.green + ' send unread message to: %s', phoneNumber);
                };
                var sql = "delete from stage where toPhoneNumber = ?";
                var sql_param = [phoneNumber];
                // 应该删除所有id小于最大fetch id的数据
                queryDatabasePool(sql, sql_param, function(err, values, fields){
                    if (err) {
                        console.log('[FAILED]'.red + ' delete unread message for: %s \nerr: %j', phoneNumber, err);
                        message.data = {'success':false};
                        return;
                    };

                    console.log('[SUCCEED]'.green + ' delete unread message for: %s', phoneNumber);

                    //将identification返回给client表示fetch完毕让client刷新UI

                    socket.sendMessage(message);
                    if (message.data.success == true) {
                        console.log('[SUCCEED]'.green + ' fetch unread messages for: %s', phoneNumber);
                    } else {
                        console.log('[FAILED]'.red + ' fetch unread messages for: %s', phoneNumber);
                    };
                });
            });
        }

        function forwardMessage() {
            var from = message.data.from;
            var to = message.data.to;

            var tempID = message.data.ID;
            message.data.ID = messageID;
            messageID++;

            if (clients[from]) {
                configureMessage(tempID, message.data.ID);
            };

            if (clients[to]) {
                var socket = clients[to];
                socket.sendMessage(message);
                console.log('[SUCCEED]'.green + ' forward message: %j', message.data);
            } else {
                stageMessage();
            };
        }

		function searchUser() {
			var phoneNumber = message.data.phoneNumber;
			var sql = 'select userName, gender, photo from users where phoneNumber = ?';
			var sql_param = [phoneNumber];
			queryDatabasePool(sql, sql_param, function(err, values, fields){
				if (err) {
					console.log('[FAILED]'.red + ' search user %s, err: %j', phoneNumber, err);
					message.data = {success:false};
					socket.sendMessage(message);
					return;
				}
				if (values.length > 0) {
					message.data.userName = values[0].userName;
					message.data.gender = values[0].gender;
					message.data.photo = values[0].photo;
				} else {
					message.data.type = 0;
				};
				socket.sendMessage(message);
				console.log('[SUCCEED]'.green + ' search user %s', phoneNumber);
			});
		}
// friend transaction can be merged into message
		function dealFriendTransaction() {
			var toPhoneNumber = message.data.to;
            message.data.ID = messageID;
            messageID++;
            var transactionState = message.data.type;
            if (transactionState == FriendTransactionState.Request) {
                if (clients[toPhoneNumber]) {
                    var socket = clients[toPhoneNumber];
                    socket.sendMessage(message);
                    console.log('[SUCCEED]'.green + 'forward friend transaction to %s', toPhoneNumber);
                };
            } else {
                stageMessage();
            };
		}

        function configureMessage(tempID, currentID) {
            var data = {'tempID':tempID, 'currentID':currentID};
            var frame = createFrame(FrameType.MessageConfigure, data);
            var socket = clients[message.data.from];
            socket.sendMessage(frame);
            console.log('[SUCCEED]'.green + ' configure message: %j', frame.data);
        }

        function stageMessage() {
            sql = 'insert into stage (id, fromPhoneNumber, toPhoneNumber, content, messageType, date) values (?,?,?,?,?,?)';
            sql_params = [message.data.ID, message.data.from, message.data.to, message.data.content, message.data.type, message.data.date];
            queryDatabasePool(sql, sql_params, function(err, values, fields){
            if (err) {
                console.log('[FAILED]'.red + ' add message to stage: %j \nerr: %j', message.data, err);
                return;
            };
            console.log('[SUCCEED]'.green + ' add message to stage: %j, database: %j', message.data, values);
            });
        }
		
		function fetchFriendList() {
			var phoneNumber = message.data.phoneNumber;
			var tableName = 'f' + phoneNumber;
			var sql = `select ${tableName}.phoneNumber, users.userName, users.gender, users.photo from users `;
			sql += `inner join ${tableName} on users.phoneNumber = ${tableName}.phoneNumber`;
			queryDatabasePool(sql, [], function(err, values, fields){
				if (err){
					console.log('[FAILED]'.red + 'fetch friend list for %s', phoneNumber);
					return;
				};

				var frame = createFrame(FrameType.FriendListResponse, values);
				socket.sendMessage(frame);
				console.log('[SUCCEED]'.green + ' fetch friend list for %s', phoneNumber);
			});
		}
    }

    function handleClose(data){

        console.log('[NOTICE]'.yellow + ' user: %s disconnected', socket.phoneNumber);
        clients[socket.phoneNumber] = null;
    }

    function assignToken() {
        var frame = createFrame(FrameType.TokenAssign,{"token":"0"});
        socket.sendMessage(frame);
        console.log('[SUCCEED]'.green + ' assign token: %j', frame.data);
    }
}

function createFrame(type, data, token, version) {
    var frame = {};
    frame.type = type;
    frame.data = data;
    frame.token = arguments[2] ? arguments[2]:"";
    frame.version = arguments[3] ? arguments[3]:FrameVersion;
    return frame;
}

function handleDatabaseConnection(databaseConnection){
    console.log('[SUCCEED]'.green + ' new database connection created');
    databaseConnection.query('SET SESSION auto_increment_increment=1'); 
}

function queryDatabasePool(sql, sql_params, callback){
    sql_params = arguments[2]? arguments[1]:null;
    callback = arguments[2]? arguments[2]:arguments[1];
    databaseConnectionPool.getConnection(function(err, connection){
        if (err) {
            console.log('[FAILED]'.red + ' database pool get connection');
            callback(err, null, null);
        } else {
            connection.query(sql, sql_params, function(q_err, vals, fields){
                connection.release();
                callback(q_err, vals, fields);
            });
        }
    });
}

