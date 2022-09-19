//. app.js

var express = require( 'express' ),
    bodyParser = require( 'body-parser' ),
    crypto = require( 'crypto' ),
    ejs = require( 'ejs' ),
    fs = require( 'fs' ),
    http = require( 'http' ),
    i18n = require( 'i18n' ),
    passport = require( 'passport' ),
    Redis = require( 'ioredis' ),
    session = require( 'express-session' ),
    WebSocket = require( 'ws' ),
    app = express();

//. #34
require( 'dotenv' ).config();
  
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

//. i18n
i18n.configure({
  locales: ['ja', 'en'],
  directory: __dirname + '/locales'
});
app.use( i18n.init );

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
var settings_admin_id = 'ADMIN_ID' in process.env ? process.env.ADMIN_ID : settings.admin_id;
var settings_admin_pw = 'ADMIN_PW' in process.env ? process.env.ADMIN_PW : settings.admin_pw;

//. #26
var settings_redirect_uri = 'AUTH0_REDIRECT_URI' in process.env ? process.env.AUTH0_REDIRECT_URI : settings.auth0_redirect_uri; 
var settings_client_id = 'AUTH0_CLIENT_ID' in process.env ? process.env.AUTH0_CLIENT_ID : settings.auth0_client_id; 
var settings_client_secret = 'AUTH0_CLIENT_SECRET' in process.env ? process.env.AUTH0_CLIENT_SECRET : settings.auth0_client_secret; 
var settings_domain = 'AUTH0_DOMAIN' in process.env ? process.env.AUTH0_DOMAIN : settings.auth0_domain; 

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

//. #26
var RedisStore = require( 'connect-redis' )( session );

//. setup session
var session_params = { 
  secret: 'doodleshareex',
  resave: false,
  cookie: {
    path: '/',
    maxAge: ( 365 * 24 * 60 * 60 * 1000 )
  },
  saveUninitialized: false
};
if( redis ){
  session_params.store = new RedisStore( { client: redis } );
}
app.use( session( session_params ) );

//. Auth0
var strategy = null;
var Auth0Strategy = require( 'passport-auth0' );
if( settings_redirect_uri && settings_client_id && settings_client_secret && settings_domain ){
  strategy = new Auth0Strategy({
    domain: settings_domain,
    clientID: settings_client_id,
    clientSecret: settings_client_secret,
    callbackURL: settings_redirect_uri
  }, function( accessToken, refreshToken, extraParams, profile, done ){
    //console.log( accessToken, refreshToken, extraParams, profile );
    profile.idToken = extraParams.id_token;
    return done( null, profile );
  });
  passport.use( strategy );

  passport.serializeUser( function( user, done ){
    done( null, user );
  });
  passport.deserializeUser( function( user, done ){
    done( null, user );
  });

  app.use( passport.initialize() );
  app.use( passport.session() );

  //. login
  app.get( '/auth0/login', passport.authenticate( 'auth0', {
    scope: 'openid profile email'
  }, function( req, res ){
    res.redirect( '/auth' );
  }));

  //. logout
  app.get( '/auth0/logout', function( req, res ){
    var returnTo = req.query.returnTo; //. #28
    req.logout( function(){
      //. #28
      //. https://auth0.com/docs/product-lifecycle/deprecations-and-migrations/logout-return-to
      //res.redirect( '/' );
      res.redirect( 'https://' + settings_domain + '/v2/logout?client_id=' + settings_client_id + '&returnTo=' + returnTo );
    });
  });

  app.get( '/auth0/callback', async function( req, res, next ){
    passport.authenticate( 'auth0', function( err, user ){
      if( err ) return next( err );
      if( !user ) return res.redirect( '/auth0/login' );

      req.logIn( user, function( err ){
        if( err ) return next( err );
        res.redirect( '/auth' );
      });
    })( req, res, next );
  });

  //. access restriction
  app.all( '/auth*', function( req, res, next ){
    if( !req.user || !req.user.displayName ){
      res.redirect( '/auth0/login' );
    }else{
      next();
    }
  });
}

//. Basic Auth
app.use( '/view', async function( req, res, next ){
  var id = req.query.room;
  if( !id ){ id = 'default'; }

  var r = await dbapi.readRoom( id );
  if( r && r.status ){
    //. 指定の id を持つ room は存在している
    if( r.room ){
      //. 認証不要
      return next();
    }else{
      //. 指定のIDを持つroomは存在しているが認証が必要
      if( req.headers.authorization ){
        var b64auth = req.headers.authorization.split( ' ' )[1] || '';
        var [ user, pass ] = Buffer.from( b64auth, 'base64' ).toString().split( ':' );
        var enc_pass = crypto.createHash( 'sha1' ).update( pass ).digest( 'hex' );
        var r = await dbapi.readRoom( id, user, enc_pass );
        if( r && r.status && r.room ){
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
  }else{
    //. 指定の id を持つ room は存在していない（=そのまま使う）
    return next();
  }
});

app.use( '/admin', async function( req, res, next ){
  var id = req.query.room;
  if( !id ){ id = 'default'; }

  var r = await dbapi.readRoom( id );
  if( r && r.status ){
    //. 指定の id を持つ room は存在している
    if( r.room ){
      //. 認証不要
      return next();
    }else{
      //. 指定のIDを持つroomは存在しているが認証が必要
      if( req.headers.authorization ){
        var b64auth = req.headers.authorization.split( ' ' )[1] || '';
        var [ user, pass ] = Buffer.from( b64auth, 'base64' ).toString().split( ':' );
        var enc_pass = crypto.createHash( 'sha1' ).update( pass ).digest( 'hex' );
        var r = await dbapi.readRoom( id, user, enc_pass );
        if( r && r.status && r.room ){
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
  }else{
    //. 指定の id を持つ room は存在していない（=そのまま使う）
    return next();
  }
});

app.use( '/', async function( req, res, next ){
  var originalUrl = req.originalUrl;
  var tmp = originalUrl.split( '?' );
  var path = tmp[0];
  if( path == '/' || path == '/screen' ){
    var id = req.query.room;
    if( !id ){ id = 'default'; }

    var r = await dbapi.readRoom( id );
    if( r && r.status ){
      //. 指定の id を持つ room は存在している
      if( r.room ){
        //. 認証不要
        return next();
      }else{
        //. 指定のIDを持つroomは存在しているが認証が必要
        if( req.headers.authorization ){
          var b64auth = req.headers.authorization.split( ' ' )[1] || '';
          var [ user, pass ] = Buffer.from( b64auth, 'base64' ).toString().split( ':' );
          var enc_pass = crypto.createHash( 'sha1' ).update( pass ).digest( 'hex' );
          var r = await dbapi.readRoom( id, user, enc_pass );
          if( r && r.status && r.room ){
            //. ID&PWが正しい
            return next();
          }else{
            var r = await dbapi.readRoom( id, id, enc_pass );
            if( r && r.status && r.room ){
              //. ID&PWが正しい
              return next();
            }else{
              res.set( 'WWW-Authenticate', 'Basic realm="401"' );
              res.status( 401 ).send( 'Authentication required.' );
            }
          }
        }else{
          res.set( 'WWW-Authenticate', 'Basic realm="401"' );
          res.status( 401 ).send( 'Authentication required.' );
        }
      }
    }else{
      //. 指定の id を持つ room は存在していない（=そのまま使う）
      return next();
    }
  }else{
    return next();
  }
});

//. Page for guest
app.get( '/', function( req, res ){
  res.render( 'index', {} );
});

app.get( '/client', function( req, res ){
  var name = req.query.name;
  if( !name ){ name = '' + ( new Date() ).getTime(); }
  var room = req.query.room;
  if( !room ){ room = 'default'; }

  subscribeMessage( room );

  res.render( 'client', { name: name, room: room } );
});

//. Page for #39
app.get( '/screen', function( req, res ){
  var name = req.query.name;
  if( !name ){ name = '' + ( new Date() ).getTime(); }
  var room = req.query.room;
  if( !room ){ room = 'default'; }
  var intervalms = 'INTERVALMS' in process.env ? parseInt( process.env.INTERVALMS ) : 2000;
  var _intervalms = req.query.intervalms;
  if( _intervalms ){
    try{
      _intervalms = parseInt( _intervalms );
    }catch( e ){
    }
  }
  if( _intervalms ){
    intervalms = _intervalms;
  }

  subscribeMessage( room );

  res.render( 'screen', { name: name, room: room, intervalms: intervalms } );
});

//. Page for admin
app.get( '/view', function( req, res ){
  var room = req.query.room;
  if( !room ){ room = 'default'; }
  var client = req.query.client;
  if( !client ){ client = ''; }
  var columns = req.query.columns;
  if( columns ){
    columns = parseInt( columns );
  }else{
    columns = 0;
  }

  subscribeMessage( room );

  res.render( 'server', { room: room, client: client, columns: columns } );
});

//. 
app.get( '/savedimages', function( req, res ){
  var room = req.query.room;
  if( !room ){ room = 'default'; }
  var columns = req.query.columns;
  if( columns ){
    try{
      columns = parseInt( columns );
    }catch( e ){
    }
  }
  if( !columns ){ columns = 0; }
  
  res.render( 'savedimages', { room: room, columns: columns } );
});

//. #20
app.get( '/auth', async function( req, res ){
  var user = null;
  if( req.user ){ 
    //. ログインが確認できた場合はそのユーザー属性を持ってメインページへ
    user = req.user;
    var user_id = user.displayName; //user.emails[0].value;
    var r = await dbapi.getUser( user_id );
    if( r && r.status && r.user ){
      user.type = r.user.type;
    }else{
      user.type = 0;
    }
    res.render( 'basicauth', { user: user } );
  }else{
    //. ログインが確認できない場合はログインページへ
    res.redirect( '/auth0/login' );
  }
});

//. #25
app.get( '/admin', async function( req, res ){
  var limit = req.query.limit;
  if( limit ){
    limit = parseInt( limit );
  }else{
    limit = 0;
  }
  var offset = req.query.offset;
  if( offset ){
    offset = parseInt( offset );
  }else{
    offset = 0;
  }

  var images = [];
  var r = await dbapi.readImages( limit, offset );
  if( r.status ){
    images = r.images;
  }
  res.render( 'admin', { limit: limit, offset: offset, images: images } );
});

server.on( 'upgrade', function( request, socket, head ){
  wss.handleUpgrade( request, socket, head, function( ws ){
    //. client.ejs の wsButton を押して接続した時
    //console.log( 'server.upgrade: wss.connection' /*, ws */ );
    wss.emit( 'connection', ws, request );
  });
});

//. #22
app.post( '/setcookie', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var value = req.body.value;
  //console.log( 'value = ' + value );
  res.setHeader( 'Set-Cookie', value );

  res.write( JSON.stringify( { status: true }, 2, null ) );
  res.end();
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
    if( Buffer.isBuffer( message ) ){
      message = ( new TextDecoder ).decode( new Uint8Array( message ) );
    }
    if( typeof message == 'string' && message.indexOf( ":" ) > -1 ){
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


//. #33 LINE Pay 用
var { v4: uuidv4 } = require( 'uuid' );
var cache = require( 'memory-cache' );

var line_pay = require( 'line-pay' );
var pay = new line_pay({
  channelId: process.env.LINE_PAY_CHANNEL_ID,
  channelSecret: process.env.LINE_PAY_CHANNEL_SECRET,
  hostname: process.env.LINE_PAY_HOSTNAME,
  isSandbox: true
});

//. 購入画面
app.use( '/pay/reserve', function( req, res ){
  //. 購入内容
  var options = JSON.parse( fs.readFileSync( './item.json' ) );
  options.orderId = uuidv4();
  options.confirmUrl = process.env.LINE_PAY_CONFIRM_URL;

  //. トランザクション ID をキーに購入内容をいったん記録して支払いページへ
  pay.reserve( options ).then( async ( response ) => {
    var reservation = options;
    reservation.transactionId = response.info.transactionId;
    console.log( `Reservation was made. Detail is following.` );
    console.log( reservation );

    if( redis ){
      await redis.set( reservation.transactionId, reservation );
    }else{
      cache.put( reservation.transactionId, reservation );
    }
    res.redirect( response.info.paymentUrl.web );
  });
});

//. 支払い画面
app.use( '/pay/confirm', async function( req, res ){
  if( !req.query.transactionId ){
    throw new Error( 'Transaction Id not found' );
  }

  //. 購入内容を取り出す
  var reservation = null;
  if( redis ){
    reservation = await redis.get( req.query.transactionId );
  }else{
    reservation = cache.get( req.query.transactionId );
  }
  if( !reservation ){
    throw new Error( 'Reservation not found' );
  }

  console.log( `Retrieved following reservation.` );
  console.log( reservation );

  //. 確認内容
  var confirmation = {
    transactionId: req.query.transactionId,
    amount: reservation.amount,
    currency: reservation.currency
  };

  console.log( `Going to confirm payment with following options` );
  console.log( confirmation );

  //. 支払い処理を実行
  pay.confirm( confirmation ).then( async function( response ){
    //. confirmation の内容（とreservation.orderId）をユーザー ID に紐づけて記録すればよい
    //. LINE Pay の取引内訳に transactionId が記録されているはず
    //.            売上結果にも transactionId と orderId が記録されているはず
    var user_id = ( req.user ? req.user.displayName : null );
    if( user_id ){
      await dbapi.addUserType( user_id );
      await dbapi.createTransaction( confirmation.transactionId, user_id, reservation.orderId, confirmation.amount, confirmation.currency );
    }

    //. 元の画面にリダイレクト
    res.redirect( '/auth' );
  });
});

const port = process.env.PORT || 8080;
server.listen( port, function (){
  console.log( 'Server start on port ' + port + ' ...' );
});
