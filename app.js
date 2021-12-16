//. app.js

var express = require( 'express' ),
    bodyParser = require( 'body-parser' ),
    crypto = require( 'crypto' ),
    ejs = require( 'ejs' ),
    fs = require( 'fs' ),
    http = require( 'http' ),
    Redis = require( 'ioredis' ),
    WebSocket = require( 'ws' ),
    app = express();

var settings = require( './settings' );
var settings_usedb = 'USEDB' in process.env ? process.env.USEDB : settings.usedb;

//. DB
var dbapi = require( './api/db_' + settings_usedb );
app.use( '/db', dbapi );

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
var settings_redis_ca = 'REDIS_CA' in process.env ? process.env.REDIS_CA : settings.redis_ca;
var settings_redis_db = 'REDIS_DB' in process.env ? process.env.REDIS_DB : settings.redis_db;
var settings_redis_username = 'REDIS_USERNAME' in process.env ? process.env.REDIS_USERNAME : settings.redis_username;
var settings_redis_password = 'REDIS_PASSWORD' in process.env ? process.env.REDIS_PASSWORD : settings.redis_password;

//. Redis（サーバーと接続する）
//var redis = settings_redis_url ? ( new Redis( settings_redis_url ) ) : ( new Redis( settings_redis_port, settings_redis_server ) );   //. Redis container
var redis_params = {};
var redis_param = 0;
if( settings_redis_url ){
  redis_params = settings_redis_url;
  redis_param = -1;
}else{
  if( settings_redis_port ){
    redis_params.port = settings_redis_port;
  }
  if( settings_redis_server ){
    redis_params.host = settings_redis_server;
    redis_param = 1;
  }
  if( settings_redis_db ){
    redis_params.db = settings_redis_db;
  }
  if( settings_redis_username ){
    redis_params.username = settings_redis_username;
  }
  if( settings_redis_password ){
    redis_params.password = settings_redis_password;
  }
}
if( redis_param == 1 && settings_redis_ca ){
  if( settings_redis_ca.indexOf( '--BEGIN CERTIFICATE--' ) > -1 && settings_redis_ca.indexOf( '--END CERTIFICATE--' ) > -1 ){
    redis_params.tls = {
      rejectUnauthorized: false, //. #19
      ca: settings_redis_ca //. #8,
    };
  }else{
    redis_params.tls = {
      rejectUnauthorized: false, //. #19
      ca: fs.readFileSync( settings_redis_ca )
    };
  }
}
//console.log( { redis_params } );
var redis = ( redis_param ? new Redis( redis_params ) : null );

//. Basic Auth
app.use( '/view', async function( req, res, next ){
  var id = req.query.room;   //. req?
  if( !id ){ id = 'default'; }

  var r = await dbapi.readRoom( id );
  if( r && r.status ){
    //. ID&PWなし (or ID&PWが正しい) or 指定のIDを持つroomなし
    return next();
  }else{
    //. 指定のIDを持つroomは存在しているが ID&PW 間違い
    if( req.headers.authorization ){
      var b64auth = req.headers.authorization.split( ' ' )[1] || '';
      var [ user, pass ] = Buffer.from( b64auth, 'base64' ).toString().split( ':' );
      var enc_pass = crypto.createHash( 'sha1' ).update( pass ).digest( 'hex' );
      var r = await dbapi.readRoom( id, user, enc_pass );
      if( r && r.status ){
        //. ID&PWが正しい
        return next();
      }else{
        res.set( 'WWW-Authenticate', 'Basic realm="401"' );
        res.status( 401 ).send( 'Authentication required.' );
      }
    }else{
      res.set( 'WWW-Authenticate', 'Basic realm="401"' );
      res.status( 401 ).send( 'Authentication required.' );
    }
  }
});

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

//. 
app.get( '/savedimages', function( req, res ){
  var room = req.query.room;
  if( !room ){ room = 'default'; }
  var columns = req.query.columns;
  if( columns ){
    columns = parseInt( columns );
  }else{
    columns = 5;
  }
  res.render( 'savedimages', { room: room, columns: columns } );
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
    clients[room] = ( redis_param ? new Redis( redis_params ) : null );
    if( clients[room] ){
      clients[room].subscribe( room );
    }
  }
  if( clients[room] ){
    clients[room].on( 'message', function( room, message ){
      //. client.ejs の wsSendButton を押してメッセージが送信された時（channel は実質固定？）
      //. まず ws.message が呼ばれて、続いてこっちが呼ばれる
      //console.log( 'client.message: broadcast', channel, message );  //. このサーバーに接続している全ウェブソケットクライアントにブロードキャスト

      //. message = {"uuid":"17c3xxxxxx","room":"room1","name":"xxx","comment":"","timestamp":1638952424770,"image_src":"data:image/png;base64,iVBO..."}
      broadcast( room, JSON.parse( message ) );
    });
  }
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

      if( redis ){
        redis.publish( room, text );  //. Redis をサブスクライブしている全ウェブソケットにパブリッシュする
      }else{
        //. Redis 未使用時のブロードキャストをどうする？(#4)
        //. message = {"uuid":"17c3xxxxxx","room":"room1","name":"xxx","comment":"","timestamp":1638952424770,"image_src":"data:image/png;base64,iVBO..."}
        broadcast( room, JSON.parse( text ) );
      }
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
