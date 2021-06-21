//. app.js

var express = require( 'express' ),
    bodyParser = require( 'body-parser' ),
    ejs = require( 'ejs' ),
    fs = require( 'fs' ),
    http = require( 'http' ),
    Redis = require( 'ioredis' ),
    WebSocket = require( 'ws' ),
    app = express();

var settings = require( './settings' );

app.use( bodyParser.urlencoded( { extended: true } ) );
app.use( bodyParser.json() );
app.use( express.Router() );
app.use( express.static( __dirname + '/public' ) );

app.set( 'views', __dirname + '/views' );
app.set( 'view engine', 'ejs' );

//.  HTTP server
var server = http.createServer( app );

//. WebSocket server
var wss = new WebSocket.Server( { noServer: true } );

//. Redis
var redis = new Redis( settings.redis_port, settings.redis_server );   //. Redis container

//.  HTTP(WebSocket) client
var client = new Redis( settings.redis_port, settings.redis_server );


//. Page for guest
app.get( '/client', function( req, res ){
  var name = req.query.name;
  if( !name ){ name = '' + ( new Date() ).getTime(); }
  var room = req.query.room;
  if( !room ){ room = 'default'; }

  res.render( 'client', { name: name, room: room } );
});

//. Page for admin
app.get( '/view', function( req, res ){
  var room = req.query.room;
  if( !room ){ room = 'default'; }
  res.render( 'server', { room: room } );
});

/*
//. Redis
client.get( 'view_sockets', function( err, view_sockets ){
  if( err || !view_sockets ){
    ///client.set( 'view_sockets', '{}' );
  }
});

//. socket.io
var view_sockets = {};
io.sockets.on( 'connection', function( socket ){
  //. admin 画面の初期化時
  socket.on( 'init_admin', function( msg ){
    var room = msg.room ? msg.room : 'default';
    var ts = ( new Date() ).getTime();
    ///var view_sockets = JSON.parse( client.get( 'view_sockets' ) );
    if( !view_sockets[room] ){
      view_sockets[room] = { socket: socket, timestamp: ts };
      ///client.set( 'view_sockets', JSON.stringify( view_sockets ) );
    }else{
      //. expired の判断はしないことにする
      //if( view_sockets[room].timestamp + ( 10 * 60 * 60 * 1000 ) < ts ){ //. 10 hours
        view_sockets[room] = { socket: socket, timestamp: ts };
        ///client.set( 'view_sockets', JSON.stringify( view_sockets ) );
      //}else{
      //  console.log( 'Room: "' + room + '" is not expired yet.' );
      //}
    }
  });

  //. guest 画面の初期化時（ロード後の最初の resized 時）
  socket.on( 'init_guest', function( msg ){
    msg.socket_id = socket.id;
    var room = msg.room ? msg.room : 'default';
    ///var view_sockets = JSON.parse( client.get( 'view_sockets' ) );
    if( view_sockets[room] ){
      view_sockets[room].socket.json.emit( 'init_guest_view', msg );
    }
  });

  //. guest 画面のボタンクリック
  socket.on( 'click_guest', function( msg ){
    msg.socket_id = socket.id;
    var room = msg.room ? msg.room : 'default';
    ///var view_sockets = JSON.parse( client.get( 'view_sockets' ) );
    if( view_sockets[room] ){
      view_sockets[room].socket.json.emit( 'click_guest_view', msg );
    }
  });
});
*/


server.on( 'upgrade', function( request, socket, head ){
  wss.handleUpgrade( request, socket, head, function( ws ){
    //. client.ejs の wsButton を押して接続した時
    //console.log( 'server.upgrade: wss.connection' /*, ws */ );
    wss.emit( 'connection', ws, request );
  });
});

var my_channel = 'my_channel';
function subscribeMessage( channel ){
  client.subscribe( channel );
  client.on( 'message', function( channel, message ){
    //. client.ejs の wsSendButton を押してメッセージが送信された時（channel は実質固定？）
    //. まず ws.message が呼ばれて、続いてこっちが呼ばれる
    //console.log( 'client.message: broadcast', channel, message );  //. このサーバーに接続している全ウェブソケットクライアントにブロードキャスト
    broadcast( JSON.parse( message ) );
  });
}
subscribeMessage( my_channel );  //. 'my_channel' というチャネル（＝ルーム？）にサブスクライブ

function broadcast( message ){
  wss.clients.forEach( function( client ){
    //console.log( JSON.stringify( client ), message );     //. 個別の client を識別する id は？？
    client.send( JSON.stringify( { message: message } ) );  //. room 機能を使おうとすると、受け取る側で識別する必要がある？？
  });
}

wss.on( 'connection', function( ws, request ){
  ws.on( 'message', function( message ){
    //. client.ejs の wsSendButton を押して（ws.send() が実行されて）メッセージが送信された時（channel は関係なし）
    //. まずこっちが呼ばれて、続いて client.message が呼ばれる
    //console.log( 'ws.message: redis.publish', message );   //. <- ２回呼ばれる？？
    //console.log( message );
    redis.publish( my_channel, message );  //. Redis をサブスクライブしている全ウェブソケットにパブリッシュする
  });

  ws.on( 'close', function( code, reason ){
    //. ブラウザタブを閉じた時
    //console.log( 'ws.close: ', code, reason );
    //console.log( 'Client connection closed. (Code: %s, Reason: %s)', code, reason );
  });

  ws.on( 'error', function( error ){
    //. いつ？？
    console.log( 'ws.error: ', error );
    console.log( 'Client connection errored (%s)', error );
  });
});

const port = process.env.PORT || 8080;
server.listen( port, function (){
  console.log( 'Server start on port ' + port + ' ...' );
});
