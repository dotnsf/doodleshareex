//. db_cloudant.js
var express = require( 'express' ),
    multer = require( 'multer' ),
    bodyParser = require( 'body-parser' ),
    fs = require( 'fs' ),
    uuidv1 = require( 'uuid/v1' ),
    api = express();

var settings = require( '../settings' );

process.env.PGSSLMODE = 'no-verify';
var PG = require( 'pg' );
PG.defaults.ssl = true;
var database_url = 'DATABASE_URL' in process.env ? process.env.DATABASE_URL : settings.database_url; 
var pg_ca = 'PG_CA' in process.env ? process.env.PG_CA : settings.pg_ca;
var pg = null;
var pg_params = { idleTimeoutMillis: ( 3 * 86400 * 1000 ) };
if( database_url ){
  console.log( 'database_url = ' + database_url );
  pg_params.connectionString = database_url;
  if( pg_ca ){
    pg_params.ssl = { ca: fs.readFileSync( pg_ca, 'utf-8' ), rejectUnauthorized: true };
    //pg_params.ssl = { ca: pg_ca, rejectUnauthorized: true }; //. #8
  }
  pg = new PG.Pool( pg_params );
  pg.on( 'error', function( err ){
    console.log( 'error on working', err );
    if( err.code && err.code.startsWith( '5' ) ){
      try_reconnect( 1000 );
    }
  });
}

function try_reconnect( ts ){
  setTimeout( function(){
    console.log( 'reconnecting...' );
    pg = new PG.Pool( pg_params );
    pg.on( 'error', function( err ){
      console.log( 'error on retry(' + ts + ')', err );
      if( err.code && err.code.startsWith( '5' ) ){
        ts = ( ts < 10000 ? ( ts + 1000 ) : ts );
        try_reconnect( ts );
      }
    });
  }, ts );
}


api.use( multer( { dest: '../tmp/' } ).single( 'image' ) );
api.use( bodyParser.urlencoded( { extended: true } ) );
api.use( bodyParser.json() );
api.use( express.Router() );

api.post( '/image', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var conn = null;
  try{
    if( pg ){
      conn = await pg.connect();

      var imgpath = req.file.path;
      var imgtype = req.file.mimetype;
      //var imgsize = req.file.size;
      var ext = imgtype.split( "/" )[1];
      var imgfilename = req.file.filename;
      var filename = req.file.originalname;

      var image_id = uuidv1();
      var img = fs.readFileSync( imgpath );
      //var img64 = new Buffer( img ).toString( 'base64' );

      var room = req.body.room;
      var uuid = req.body.uuid;
      var comment = req.body.comment;
      var timestamp = req.body.timestamp;
      var name = req.body.name;
      var ts = ( new Date() ).getTime();

      var sql = "insert into images( id, body, contenttype, timestamp, name, comment, room, uuid, created, updated ) values( $1, $2, $3, $4, $5, $6, $7, $8, $9, $10 )";
      var query = { text: sql, values: [ image_id, img, imgtype, timestamp, name, comment, room, uuid, ts, ts ] };
      conn.query( query, function( err, result ){
        fs.unlink( imgpath, function( err ){} );
        if( err ){
          console.log( err );
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err } ) );
          res.end();
        }else{
          res.write( JSON.stringify( { status: true, id: image_id } ) );
          res.end();
        }
      });
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
      res.end();
    }
  }catch( e ){
    console.log( e );
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: e } ) );
    res.end();
  }finally{
    if( conn ){
      conn.release();
    }
  }
});

api.get( '/image', async function( req, res ){
  var conn = null;
  try{
    if( pg ){
      conn = await pg.connect();

      var id = req.query.id;
      var sql = "select * from images where id = $1";
      var query = { text: sql, values: [ id ] };
      conn.query( query, function( err, result ){
        if( err ){
          console.log( err );
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err } ) );
          res.end();
        }else{
          var image = null;
          if( result.rows.length > 0 && result.rows[0].id ){
            try{
              image = result.rows[0];
            }catch( e ){
            }
          }
  
          if( image ){
            res.contentType( image.contenttype );
            res.end( image.body, 'binary' );
          }else{
            res.status( 400 );
            res.write( JSON.stringify( { status: false, error: 'no image' } ) );
            res.end();
          }
        }
      });
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
      res.end();
    }
  }catch( e ){
    console.log( e );
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: e } ) );
    res.end();
  }finally{
    if( conn ){
      conn.release();
    }
  }
});

api.delete( '/image', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var conn = null;
  try{
    if( pg ){
      conn = await pg.connect();

      var id = req.query.id;
      var sql = "delete from images where id = $1";
      var query = { text: sql, values: [ id ] };
      conn.query( query, function( err, result ){
        if( err ){
          console.log( err );
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err } ) );
          res.end();
        }else{
          res.write( JSON.stringify( { status: true } ) );
          res.end();
        }
      });
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
      res.end();
    }
  }catch( e ){
    console.log( e );
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: e } ) );
    res.end();
  }finally{
    if( conn ){
      conn.release();
    }
  }
});


api.get( '/images', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var limit = req.query.limit ? parseInt( req.query.limit ) : 0;
  var offset = req.query.offset ? parseInt( req.query.offset ) : 0;
  var room = req.query.room ? req.query.room : 'default';

  var conn = null;
  try{
    if( pg ){
      conn = await pg.connect();

      var sql = "select * from images where room = $1 order by timestamp desc";
      if( limit ){
        sql += " limit " + limit;
      }
      if( offset ){
        sql += " start " + offset;
      }
      var query = { text: sql, values: [ room ] };
      conn.query( query, function( err, result ){
        if( err ){
          console.log( err );
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err } ) );
          res.end();
        }else{
          var images = [];
          if( result.rows.length > 0 ){
            try{
              images = result.rows;
            }catch( e ){
            }
          }
  
          var result = { status: true, limit: limit, offset: offset, images: images };
          res.write( JSON.stringify( result, null, 2 ) );
          res.end();
        }
      });
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
      res.end();
    }
  }catch( e ){
    console.log( e );
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: e } ) );
    res.end();
  }finally{
    if( conn ){
      conn.release();
    }
  }
});


function timestamp2datetime( ts ){
  if( ts ){
    var dt = new Date( ts );
    var yyyy = dt.getFullYear();
    var mm = dt.getMonth() + 1;
    var dd = dt.getDate();
    var hh = dt.getHours();
    var nn = dt.getMinutes();
    var ss = dt.getSeconds();
    var datetime = yyyy + '-' + ( mm < 10 ? '0' : '' ) + mm + '-' + ( dd < 10 ? '0' : '' ) + dd
      + ' ' + ( hh < 10 ? '0' : '' ) + hh + ':' + ( nn < 10 ? '0' : '' ) + nn + ':' + ( ss < 10 ? '0' : '' ) + ss;
    return datetime;
  }else{
    return "";
  }
}

function sortByTimestamp( a, b ){
  var r = 0;
  if( a.timestamp < b.timestamp ){
    r = -1;
  }else if( a.timestamp > b.timestamp ){
    r = 1;
  }

  return r;
}


//. api をエクスポート
module.exports = api;
