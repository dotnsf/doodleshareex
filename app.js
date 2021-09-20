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

//. env values
var settings_redis_url = 'REDIS_URL' in process.env ? process.env.REDIS_URL : settings.redis_url;
var settings_redis_server = 'REDIS_SERVER' in process.env ? process.env.REDIS_SERVER : settings.redis_server;
var settings_redis_port = 'REDIS_PORT' in process.env ? process.env.REDIS_PORT : settings.redis_port;

//. Redis（サーバーと接続する）
var redis = settings_redis_url ? ( new Redis( settings_redis_url ) ) : ( new Redis( settings_redis_port, settings_redis_server ) );   //. Redis container

//.  HTTP(WebSocket) client（クライアントと接続する）
//var client = settings_redis_url ? ( new Redis( settings_redis_url ) ) : ( new Redis( settings_redis_port, settings_redis_server ) );   //. Redis container


//. Page for guest
app.get( '/client', function( req, res ){
  var name = req.query.name;
  if( !name ){ name = '' + ( new Date() ).getTime(); }
  var room = req.query.room;
  if( !room ){ room = 'default'; }

  subscribeMessage( room );

  res.render( 'client', { name: name, room: room } );
});

//. Page for admin
app.get( '/view', function( req, res ){
  var room = req.query.room;
  if( !room ){ room = 'default'; }

  subscribeMessage( room );

  res.render( 'server', { room: room } );
});


server.on( 'upgrade', function( request, socket, head ){
  wss.handleUpgrade( request, socket, head, function( ws ){
    //. client.ejs の wsButton を押して接続した時
    //console.log( 'server.upgrade: wss.connection' /*, ws */ );
    wss.emit( 'connection', ws, request );
  });
});

//var my_channel = 'my_channel';
var rooms = [];
var clients = {};
function subscribeMessage( room ){
  if( rooms.indexOf( room ) == -1 ){
    rooms.push( room );
    clients[room] = settings_redis_url ? ( new Redis( settings_redis_url ) ) : ( new Redis( settings_redis_port, settings_redis_server ) );
    clients[room].subscribe( room );
  }
  clients[room].on( 'message', function( room, message ){
    //. client.ejs の wsSendButton を押してメッセージが送信された時（channel は実質固定？）
    //. まず ws.message が呼ばれて、続いてこっちが呼ばれる
    //console.log( 'client.message: broadcast', channel, message );  //. このサーバーに接続している全ウェブソケットクライアントにブロードキャスト
    broadcast( room, JSON.parse( message ) );
  });
}
//subscribeMessage( my_channel );  //. 'my_channel' というチャネル（＝ルーム？）にサブスクライブ

function broadcast( room, message ){
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

    //. message = room:text
    if( message.indexOf( ":" ) > -1 ){
      var n = message.indexOf( ":" );
      var room = message.substring( 0, n );
      var text = message.substring( n + 1 );

      if( rooms.indexOf( room ) == -1 ){
        subscribeMessage( room );
      }

      redis.publish( room, text );  //. Redis をサブスクライブしている全ウェブソケットにパブリッシュする
    }

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
