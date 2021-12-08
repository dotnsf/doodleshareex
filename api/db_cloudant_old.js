//. db_cloudant_old.js
var express = require( 'express' ),
    multer = require( 'multer' ),
    bodyParser = require( 'body-parser' ),
    fs = require( 'fs' ),
    cloudantlib = require( '@cloudant/cloudant' ),
    uuidv1 = require( 'uuid/v1' ),
    api = express();

var settings = require( '../settings' );

var db = null;
var cloudant = null;
if( settings.db_username && settings.db_password ){
  var params = { account: settings.db_username, password: settings.db_password };
  if( settings.db_url ){
    params.url = settings.db_url;
  }
  cloudant = cloudantlib( params );
  if( cloudant ){
    cloudant.db.get( settings.db_name, function( err, body ){
      if( err ){
        if( err.statusCode == 404 ){
          cloudant.db.create( settings.db_name, function( err, body ){
            if( err ){
              db = null;
            }else{
              db = cloudant.db.use( settings.db_name );
            }
          });
        }else{
          db = cloudant.db.use( settings.db_name );
        }
      }else{
        db = cloudant.db.use( settings.db_name );
      }
    });
  }
}


api.use( multer( { dest: '../tmp/' } ).single( 'image' ) );
api.use( bodyParser.urlencoded( { extended: true } ) );
api.use( bodyParser.json() );
api.use( express.Router() );

api.post( '/image', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( db ){
    var imgpath = req.file.path;
    var imgtype = req.file.mimetype;
    //var imgsize = req.file.size;
    var ext = imgtype.split( "/" )[1];
    var imgfilename = req.file.filename;
    var filename = req.file.originalname;

    var image_id = uuidv1();
    var img = fs.readFileSync( imgpath );
    var img64 = new Buffer( img ).toString( 'base64' );

    var params = {
      _id: image_id,
      filename: filename,
      type: 'image',
      timestamp: ( new Date() ).getTime(),
      name: req.body.name,
      comment: req.body.comment,
      room: req.body.room,
      uuid: req.body.uuid,
      _attachments: {
        image: {
          content_type: imgtype,
          data: img64
        }
      }
    };
    db.insert( params, image_id, function( err, body, header ){
      if( err ){
        console.log( err );
        var p = JSON.stringify( { status: false, error: err }, null, 2 );
        res.status( 400 );
        res.write( p );
        res.end();
      }else{
        var p = JSON.stringify( { status: true, id: image_id, body: body }, null, 2 );
        res.write( p );
        res.end();
      }
      fs.unlink( imgpath, function( err ){} );
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
    res.end();
  }
});

api.get( '/image', function( req, res ){
  if( db ){
    var image_id = req.query.id;
    db.attachment.get( image_id, 'image', function( err1, body1 ){
      res.contentType( 'image/png' );
      res.end( body1, 'binary' );
    });
  }else{
    res.contentType( 'application/json; charset=utf-8' );
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
    res.end();
  }
});

api.delete( '/image', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( db ){
    var id = req.query.id;

    //. Cloudant から削除
    db.get( id, null, function( err1, body1, header1 ){
      if( err1 ){
        err1.image_id = "error-1";
        res.status( 400 );
        res.write( JSON.stringify( { status: false, error: err1 } ) );
        res.end();
      }

      var rev = body1._rev;
      db.destroy( id, rev, function( err2, body2, header2 ){
        if( err2 ){
          err2.image_id = "error-2";
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err2 } ) );
          res.end();
        }

        body2.image_id = id;
        res.write( JSON.stringify( { status: true, body: body2 } ) );
        res.end();
      });
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
    res.end();
  }
});


api.get( '/images', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var limit = req.query.limit ? parseInt( req.query.limit ) : 0;
  var offset = req.query.offset ? parseInt( req.query.offset ) : 0;
  var room = req.query.room ? req.query.room : settings.defaultroom;

  if( db ){
    db.find( { selector: { room: { "$eq": room } }, fields: [ "_id", "_rev", "name", "type", "comment", "timestamp", "room", "uuid" ] }, function( err, result ){
      if( err ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, message: err }, 2, null ) );
        res.end();
      }else{
        var total = result.docs.length;
        var images = [];
        result.docs.forEach( function( doc ){
          if( doc._id.indexOf( '_' ) !== 0 && doc.type && doc.type == 'image' ){
            images.push( doc );
          }
        });

        images.sort( sortByTimestamp );

        if( offset || limit ){
          if( offset + limit > total ){
            images = images.slice( offset );
          }else{
            images = images.slice( offset, offset + limit );
          }
        }

        var result = { status: true, room: room, total: total, limit: limit, offset: offset, images: images };
        res.write( JSON.stringify( result, 2, null ) );
        res.end();
      }
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
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
