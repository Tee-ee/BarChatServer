var FrameType = {};
FrameType.Identification    = 0;
FrameType.PeerMessage       = 1;
FrameType.Login             = 2;
FrameType.Register          = 3;
FrameType.SearchUser        = 4;
FrameType.FriendTransaction = 5;
FrameType.Unused_1	        = 6;
FrameType.Unused_2	        = 7;
FrameType.TokenAssign       = 8;
FrameType.MessageConfigure  = 9;
FrameType.Error             = 10;

var FrameVersion = 1;

var net = require('net');

var colors = require('colors');

var JSONSocket = require('json-socket');

var port = 6596;

var host = '127.0.0.1';

var phoneNumber = '13031636571';

var socket = new JSONSocket(new net.Socket());

socket.connect(port, host);

socket.on('connect', handleConnect);

function handleConnect() {

    console.log('[SUCCEED]'.green + ' connected to server');

    identify();

    socket.on('message', handleMessage);
    socket.on('close', handleClose);

    function handleMessage(message){
        console.log('[SUCCEED]'.green + ' frame received %j', message);
        switch(message.type) {
            case FrameType.PeerMessage:
                message.data.to = message.data.from;
                message.data.from = phoneNumber;
                socket.sendMessage(message);
                break;

			case FrameType.FriendTransaction:
				console.log('[SUCCEED]'.green + 'receive friend request from %s, named %s, message:%s',message.data.from, message.data.displayName, message.data.message);
				break;
        }
    }

    function handleClose(data){
        console.log('[NOTICE]'.yellow + ' connection closed');
    }

    function identify() {
        var frame = createFrame(FrameType.Identification, {'phoneNumber':phoneNumber});
        socket.sendMessage(frame);
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
