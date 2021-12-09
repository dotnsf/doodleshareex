//. db_cloudant.js
var express = require( 'express' ),
    multer = require( 'multer' ),
    bodyParser = require( 'body-parser' ),
    fs = require( 'fs' ),
    { CloudantV1 } = require( '@ibm-cloud/cloudant' ),
    uuidv1 = require( 'uuid/v1' ),
    api = express();

var settings = require( '../settings' );

var cloudant = null;
if( settings.db_username && settings.db_password && settings.db_url ){
  process.env['CLOUDANT_AUTH_TYPE'] = 'BASIC';
  process.env['CLOUDANT_USERNAME'] = settings.db_username;
  process.env['CLOUDANT_PASSWORD'] = settings.db_password;
  process.env['CLOUDANT_URL'] = settings.db_url;
  cloudant = CloudantV1.newInstance( { serviceName: 'CLOUDANT' } );
}


api.use( multer( { dest: '../tmp/' } ).single( 'image' ) );
api.use( bodyParser.urlencoded( { extended: true } ) );
api.use( bodyParser.json() );
api.use( express.Router() );

api.post( '/image', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( cloudant ){
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
    cloudant.postDocument( { db: settings.db_name, document: params } ).then( function( result ){
      var p = JSON.stringify( { status: true, id: image_id, body: result }, null, 2 );
      res.write( p );
      res.end();
    }).catch( function( err ){
      console.log( err );
      var p = JSON.stringify( { status: false, error: err }, null, 2 );
      res.status( 400 );
      res.write( p );
      res.end();
    }).finally( function(){
      fs.unlink( imgpath, function( err ){} );
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
    res.end();
  }
});

api.get( '/image', function( req, res ){
  if( cloudant ){
    var id = req.query.id;
    cloudant.getDocument( { db: settings.db_name, docId: id, attachments: true } ).then( function( result0 ){
      var att = result0.result._attachments;
      var content_type = att.image.content_type;
      var data = att.image.data;
      var image = new Buffer( data, 'base64' );
      res.contentType( content_type );
      res.end( image, 'binary' );
    }).catch( function( err0 ){
      console.log( err0 );
      var p = JSON.stringify( { status: false, error: err0 }, null, 2 );
      res.status( 400 );
      res.write( p );
      res.end();
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

  if( cloudant ){
    var id = req.query.id;

    //. Cloudant から削除
    cloudant.getDocument( { db: settings.db_name, docId: id } ).then( function( result0 ){
      var rev = result0._rev;
      cloudant.deleteDocument( { db: settings.db_name, docId: id, rev: rev } ).then( function( result ){
        res.write( JSON.stringify( { status: true, body: result } ) );
        res.end();
      }).catch( function( err ){
        console.log( err );
        var p = JSON.stringify( { status: false, error: err }, null, 2 );
        res.status( 400 );
        res.write( p );
        res.end();
      });
    }).catch( function( err0 ){
      console.log( err0 );
      var p = JSON.stringify( { status: false, error: err0 }, null, 2 );
      res.status( 400 );
      res.write( p );
      res.end();
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
  var room = req.query.room ? req.query.room : 'default';

  if( cloudant ){
    var selector = { room: { "$eq": room } };
    cloudant.postFind( { db: settings.db_name, selector: selector, fields: [  "_id", "_rev", "name", "type", "comment", "timestamp", "room", "uuid" ] } ).then( function( result ){
      //console.log( JSON.stringify( result ) );
      //console.log( result.result.docs[0] );
      var total = result.result.docs.length;
      var images = [];
      result.result.docs.forEach( function( doc ){
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
    }).catch( function( err0 ){
      console.log( err0 );
      var p = JSON.stringify( { status: false, error: err0 }, null, 2 );
      res.status( 400 );
      res.write( p );
      res.end();
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
