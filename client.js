//. client.js (for #42)
var fs = require( 'fs' );
var WebSocketClient = require( 'websocket' ).client;
var ws = new WebSocketClient();

//. env values
var uuid = ( 'UUID' in process.env ? process.env.UUID : generateUUID() );
var room = ( 'ROOM' in process.env ? process.env.ROOM : 'default' );
var images_folder = ( 'IMAGES_FOLDER' in process.env ? process.env.IMAGES_FOLDER : 'sample_images' );
while( images_folder.startsWith( '/' ) ){
  images_folder = images_folder.substr( 1 );
}
while( images_folder.endsWith( '/' ) ){
  images_folder = images_folder.substr( 0, images_folder.length - 1 );
}

var interval_ms = ( 'INTERVAL_MS' in process.env ? process.env.INTERVAL_MS : 1000 );
if( typeof interval_ms == 'string' ){
  try{
    interval_ms = parseInt( interval_ms );
  }catch( e ){
  }
}

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

function generateUUID(){
  id = ( new Date().getTime().toString(16) ) + Math.floor( 10000000 * Math.random() ).toString(16);

  return id;
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

  var count = 0;
  function do_request(){
    var idx = ( count ++ ) % fileList.length;
    var comment = fileList[idx].name;
    var image_data = fileList[idx].data;

    var msg = {
      uuid: uuid,
      room: room,
      name: uuid,
      comment: comment,
      timestamp: ( new Date() ).getTime(),
      image_src: image_data 
    };
    sendMsg( room, msg );

    var ms = interval_ms + Math.ceil( Math.random() * ( interval_ms / 2 ) - ( interval_ms / 4 ) );
    setTimeout( do_request, ms );
  }

  //. uuid が sendMsg() を呼び出す
  setTimeout( do_request, interval_ms );
});

ws.connect( ws_server_url, 'echo-protocol' );
