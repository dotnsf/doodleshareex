//. ws_client.js (for #41)
var fs = require( 'fs' );
var WebSocketClient = require( 'websocket' ).client;
var ws = new WebSocketClient();

//. env values
var room = ( 'ROOM' in process.env ? process.env.ROOM : 'default' );
var images_folder = ( 'IMAGES_FOLDER' in process.env ? process.env.IMAGES_FOLDER : 'sample_images' );
while( images_folder.startsWith( '/' ) ){
  images_folder = images_folder.substr( 1 );
}
while( images_folder.endsWith( '/' ) ){
  images_folder = images_folder.substr( 0, images_folder.length - 1 );
}
var client_num = ( 'CLIENT_NUM' in process.env ? process.env.CLIENT_NUM : 10 );
if( typeof client_num == 'string' ){
  try{
    client_num = parseInt( client_num );
  }catch( e ){
  }
}

var interval_ms = ( 'INTERVAL_MS' in process.env ? process.env.INTERVAL_MS : 1000 );
if( typeof interval_ms == 'string' ){
  try{
    interval_ms = parseInt( interval_ms );
  }catch( e ){
  }
}
var interval_ms_client = interval_ms / client_num;

var ws_server_url = ( 'SERVER_URL' in process.env ? process.env.SERVER_URL : 'ws://localhost:8080' );
while( ws_server_url.endsWith( '/' ) ){
  ws_server_url = ws_server_url.substr( 0, ws_server_url.length - 1 );
}

//. 画像をまとめて読み込む
var fileList = [];
fs.readdir( './' + images_folder, function( err, files ){
  if( err ) throw err;
  files.filter( function( file ){
    var filepath = './' + images_folder + '/' + file;
    return fs.statSync( filepath ).isFile() && /.*\.png$/.test( file );
  }).forEach( function( file ){
    var b64 = base64_encode( './' + images_folder + '/' + file );
    fileList.push( { name: file, data: 'data:image/png;base64,' + b64 } );
  });
});

function base64_encode( filepath ){
  var bitmap = fs.readFileSync( filepath );
  return new Buffer( bitmap ).toString( 'base64' );
}


ws.on( 'connectFailed', function( err ){
  console.log( 'Connect Error: ' + err.toString() );
});
ws.on( 'connect', function( connection ){
  console.log( 'WebSocket Client Connected' );

  function sendMsg( room, msg ){
    if( connection.connected ){
      var data = room + ': ' + JSON.stringify( msg );
      connection.sendUTF( data );
    }
  }

  //. 等間隔にランダムな uuid が sendMsg() を呼び出す
  setInterval( function(){
    var idx = Math.floor( Math.random() * fileList.length );
    var comment = fileList[idx].name;
    var image_data = fileList[idx].data;

    var uuid = '' + Math.floor( Math.random() * client_num );
    var msg = {
      uuid: uuid,
      room: room,
      name: uuid,
      comment: comment,
      timestamp: ( new Date() ).getTime(),
      image_src: image_data 
    };
    sendMsg( room, msg );

  }, interval_ms_client );
});

ws.connect( ws_server_url, 'echo-protocol' );
